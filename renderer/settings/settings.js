// 独立设置页（settings.js）
// 11 分类的折叠面板 + 参数控件 + 状态管理

import { renderAccordions } from '../components/accordion.js';
import { createParamControl } from '../components/param-control.js';

/**
 * 设置页状态
 * - uiState: 折叠状态（categoryId -> bool）
 * - paramState: 参数值（categoryId.paramName -> { enabled, value }）
 */
const state = {
  uiState: {
    expanded: {},     // categoryId -> bool
    enabled: {},      // categoryId.paramName -> bool
    values: {},       // categoryId.paramName -> any
  },
  initialized: false,
};

// Debounce 工具：避免键入时频繁 IPC
let saveTimer = null;
function debouncedSaveUiState() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveUiState();
    saveTimer = null;
  }, 250);
}

/**
 * 初始化独立设置页
 * @param {HTMLElement} container - 容器元素
 */
export async function initSettingsPage(container) {
  if (state.initialized) return;

  // 1) 加载 UI 状态（从 system.json）
  await loadUiState();

  // 2) 加载 11 个分类
  const { loadAllCategories } = await import('./params-loader.js');
  const categories = await loadAllCategories();

  // 3) 渲染折叠面板
  const stateManager = {
    getExpanded: (id) => state.uiState.expanded[id],
    setExpanded: (id, expanded) => {
      state.uiState.expanded[id] = expanded;
      debouncedSaveUiState();
    },
  };

  const accordions = renderAccordions(
    categories,
    container,
    (category) => buildCategoryContent(category),
    stateManager,
  );

  state.initialized = true;
  state.accordions = accordions;

  console.log(`[Settings] 初始化完成，渲染了 ${accordions.length} 个分类`);
}

/**
 * 构建单个分类的内容区
 */
function buildCategoryContent(category) {
  const wrap = document.createElement('div');
  wrap.className = 'param-category-content';

  for (const param of category.params || []) {
    const key = `${category.id}.${param.name}`;
    const enabled = state.uiState.enabled[key] ?? false;
    const value = state.uiState.values[key] ?? param.default;

    const row = createParamControl(param, {
      value,
      enabled,
      onValueChange: (p, newValue) => {
        state.uiState.values[`${category.id}.${p.name}`] = newValue;
        onParamChange(category, p, newValue, true);
      },
      onEnabledChange: (p, newEnabled) => {
        state.uiState.enabled[`${category.id}.${p.name}`] = newEnabled;
        onParamChange(category, p, value, false);
      },
    });

    wrap.appendChild(row);
  }
  return wrap;
}

/**
 * 参数变化 → 通知主进程
 */
function onParamChange(category, param, value, isValueChange) {
  // 1) 立即保存到 system.json（UI 状态）— debounced
  debouncedSaveUiState();

  // 2) 通知主进程：参数变化
  if (window.llamaDesktop && window.llamaDesktop.onParamChange) {
    window.llamaDesktop
      .onParamChange({
        category: category.source,
        categoryId: category.id,
        paramName: param.name,
        flag: param.flag,
        value,
        isValueChange,
      })
      .then((response) => {
        if (response && response.needRestart) {
          showRestartHint(param.name);
        }
      })
      .catch((err) => {
        console.error('[Settings] 通知参数变化失败:', err);
      });
  }
}

/**
 * 显示"需要重启"提示
 */
function showRestartHint(paramName) {
  // 通过 toast 或状态栏提示
  console.warn(`[Settings] 参数 ${paramName} 需要重启服务才能生效`);
  if (window.llamaDesktop && window.llamaDesktop.showToast) {
    window.llamaDesktop.showToast({
      type: 'warning',
      message: `参数 ${paramName} 需要重启服务才能生效`,
    });
  }
}

/**
 * 加载 UI 状态（从 system.json）
 */
async function loadUiState() {
  if (window.llamaDesktop && window.llamaDesktop.getUiState) {
    try {
      const uiState = await window.llamaDesktop.getUiState();
      if (uiState) {
        state.uiState = {
          expanded: uiState.expanded || {},
          enabled: uiState.enabled || {},
          values: uiState.values || {},
        };
      }
    } catch (err) {
      console.warn('[Settings] 加载 UI 状态失败:', err);
    }
  }
}

/**
 * 保存 UI 状态到 system.json
 */
function saveUiState() {
  if (window.llamaDesktop && window.llamaDesktop.saveUiState) {
    window.llamaDesktop
      .saveUiState(state.uiState)
      .catch((err) => console.warn('[Settings] 保存 UI 状态失败:', err));
  }
}

/**
 * 重新加载（用于热重载等场景）
 */
export function refreshSettings() {
  state.initialized = false;
  state.accordions = null;
}
