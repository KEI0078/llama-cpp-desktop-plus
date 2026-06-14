// 参数控件组件（param-control）
// 参考 cn.LammaForms ParamControlFactory.CreateParamControl
// 根据 param.type 渲染不同控件

/**
 * 创建单个参数的 UI 控件
 * @param {Object} param - 参数定义
 * @param {Object} options
 * @param {any} options.value - 当前值
 * @param {boolean} options.enabled - 是否启用（勾选）
 * @param {Function} options.onValueChange - 值变化回调 (param, newValue) => void
 * @param {Function} options.onEnabledChange - 启用状态变化回调 (param, enabled) => void
 * @returns {HTMLElement} 行容器
 */
export function createParamControl(param, { value, enabled, onValueChange, onEnabledChange }) {
  const row = document.createElement('div');
  row.className = 'param-row';
  row.dataset.paramName = param.name;

  // 启用勾选框
  const enableCheckbox = document.createElement('input');
  enableCheckbox.type = 'checkbox';
  enableCheckbox.className = 'param-enable';
  enableCheckbox.checked = enabled;
  enableCheckbox.addEventListener('change', () => {
    if (onEnabledChange) onEnabledChange(param, enableCheckbox.checked);
    updateEnabled();
  });

  // 标签
  const label = document.createElement('label');
  label.className = 'param-label';
  label.textContent = param.name;
  if (param.tooltip || param.description) {
    label.title = param.tooltip || param.description;
  }

  // 控件容器
  const controlWrap = document.createElement('div');
  controlWrap.className = 'param-control';

  // 根据类型渲染不同的输入控件
  const input = renderInput(param, value, (newValue) => {
    if (onValueChange) onValueChange(param, newValue);
  });

  controlWrap.appendChild(input);

  // 组装行
  row.appendChild(enableCheckbox);
  row.appendChild(label);
  row.appendChild(controlWrap);

  // 应用启用状态
  function updateEnabled() {
    if (enableCheckbox.checked) {
      row.classList.remove('param-disabled');
    } else {
      row.classList.add('param-disabled');
    }
    // 禁用/启用输入控件
    const inputs = controlWrap.querySelectorAll('input, select, button');
    inputs.forEach((el) => {
      if (el !== enableCheckbox) el.disabled = !enableCheckbox.checked;
    });
  }
  updateEnabled();

  return row;
}

/**
 * 根据类型渲染输入控件
 */
function renderInput(param, value, onValueChange) {
  switch (param.type) {
    case 'numeric':
      return renderNumeric(param, value, onValueChange);
    case 'text':
      return renderText(param, value, onValueChange);
    case 'checkbox':
      return renderCheckbox(param, value, onValueChange);
    case 'file':
      return renderFile(param, value, onValueChange);
    case 'enum':
      return renderEnum(param, value, onValueChange);
    case 'multiselect':
      return renderMultiSelect(param, value, onValueChange);
    default:
      // fallback 为文本
      return renderText(param, value, onValueChange);
  }
}

function renderNumeric(param, value, onValueChange) {
  const wrap = document.createElement('div');
  wrap.className = 'param-input-numeric';

  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'param-input';
  input.value = value ?? param.default ?? 0;
  if (param.min !== undefined) input.min = String(param.min);
  if (param.max !== undefined) input.max = String(param.max);
  if (param.step !== undefined) input.step = String(param.step);
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    if (!isNaN(v)) onValueChange(v);
  });

  wrap.appendChild(input);
  if (param.unit) {
    const unit = document.createElement('span');
    unit.className = 'param-unit';
    unit.textContent = param.unit;
    wrap.appendChild(unit);
  }
  return wrap;
}

function renderText(param, value, onValueChange) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'param-input';
  input.value = value ?? param.default ?? '';
  input.placeholder = param.placeholder || '';
  if (param.maxLength) input.maxLength = param.maxLength;
  input.addEventListener('input', () => onValueChange(input.value));
  return input;
}

function renderCheckbox(param, value, onValueChange) {
  const wrap = document.createElement('label');
  wrap.className = 'param-input-checkbox';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = value ?? param.default ?? false;
  input.addEventListener('change', () => onValueChange(input.checked));

  const text = document.createElement('span');
  text.textContent = param.checkboxLabel || '启用';

  wrap.appendChild(input);
  wrap.appendChild(text);
  return wrap;
}

function renderFile(param, value, onValueChange) {
  const wrap = document.createElement('div');
  wrap.className = 'param-input-file';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'param-input';
  input.value = value ?? param.default ?? '';
  input.placeholder = param.placeholder || '选择文件...';
  input.addEventListener('input', () => onValueChange(input.value));

  const browseBtn = document.createElement('button');
  browseBtn.type = 'button';
  browseBtn.className = 'param-browse-btn';
  browseBtn.textContent = '浏览...';
  browseBtn.addEventListener('click', async () => {
    if (window.llamaDesktop && window.llamaDesktop.pickFile) {
      const result = await window.llamaDesktop.pickFile({
        properties: ['openFile'],
        filters: param.fileFilters || [{ name: 'All Files', extensions: ['*'] }],
      });
      if (result && result.filePath) {
        input.value = result.filePath;
        onValueChange(result.filePath);
      }
    }
  });

  wrap.appendChild(input);
  wrap.appendChild(browseBtn);
  return wrap;
}

function renderEnum(param, value, onValueChange) {
  const select = document.createElement('select');
  select.className = 'param-input';

  if (param.options) {
    for (const opt of param.options) {
      const option = document.createElement('option');
      option.value = String(opt.value);
      option.textContent = opt.label;
      if ((value ?? param.default) === opt.value) option.selected = true;
      select.appendChild(option);
    }
  }

  select.addEventListener('change', () => onValueChange(select.value));
  return select;
}

function renderMultiSelect(param, value, onValueChange) {
  // 多选下拉（用逗号分隔字符串）
  const wrap = document.createElement('div');
  wrap.className = 'param-input-multiselect';

  if (param.options) {
    const currentValues = String(value ?? param.default ?? '').split(',').map((s) => s.trim());

    for (const opt of param.options) {
      const cb = document.createElement('label');
      cb.className = 'multiselect-item';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = currentValues.includes(String(opt.value));
      checkbox.addEventListener('change', () => {
        const selected = Array.from(wrap.querySelectorAll('input[type=checkbox]'))
          .filter((c) => c.checked)
          .map((c) => c.value);
        onValueChange(selected.join(','));
      });

      const span = document.createElement('span');
      span.textContent = opt.label;

      cb.appendChild(checkbox);
      cb.appendChild(span);
      cb.appendChild(document.createTextNode(' '));
      wrap.appendChild(cb);
    }
  }
  return wrap;
}
