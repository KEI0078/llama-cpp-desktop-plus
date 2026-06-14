// 折叠面板组件（accordion）
// 参考 cn.LammaForms ParamControlFactory.CreateCategoryPanel
// 点击标题栏展开/折叠内容

export class Accordion {
  /**
   * 创建一个可折叠面板
   * @param {Object} options
   * @param {string} options.title - 面板标题
   * @param {string} options.icon - 图标（emoji 或文字）
   * @param {string} options.categoryId - 分类 ID（用于持久化折叠状态）
   * @param {HTMLElement} options.contentEl - 要放进内容区的元素
   * @param {boolean} options.defaultExpanded - 默认是否展开（默认 true）
   * @param {Function} options.onToggle - 切换回调
   * @returns {HTMLElement} 面板根元素（class="accordion"）
   */
  constructor({ title, icon = '', categoryId, contentEl, defaultExpanded = true, onToggle = null }) {
    this.title = title;
    this.icon = icon;
    this.categoryId = categoryId;
    this.onToggle = onToggle;
    this.isExpanded = defaultExpanded;

    this.root = document.createElement('div');
    this.root.className = 'accordion';
    this.root.dataset.categoryId = categoryId;

    // 标题栏
    this.header = document.createElement('div');
    this.header.className = 'accordion-header';
    this.header.tabIndex = 0;
    this.header.setAttribute('role', 'button');
    this.header.setAttribute('aria-expanded', String(this.isExpanded));

    // 图标
    if (icon) {
      this.iconEl = document.createElement('span');
      this.iconEl.className = 'accordion-icon';
      this.iconEl.textContent = icon;
      this.header.appendChild(this.iconEl);
    }

    // 标题
    this.titleEl = document.createElement('span');
    this.titleEl.className = 'accordion-title';
    this.titleEl.textContent = title;
    this.header.appendChild(this.titleEl);

    // 箭头
    this.arrowEl = document.createElement('span');
    this.arrowEl.className = 'accordion-arrow';
    this.arrowEl.textContent = this.isExpanded ? '▼' : '▶';
    this.header.appendChild(this.arrowEl);

    // 内容区
    this.body = document.createElement('div');
    this.body.className = 'accordion-body';
    if (!this.isExpanded) this.body.hidden = true;
    if (contentEl) this.body.appendChild(contentEl);

    this.root.appendChild(this.header);
    this.root.appendChild(this.body);

    // 绑定事件
    this.header.addEventListener('click', () => this.toggle());
    this.header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  toggle() {
    this.isExpanded = !this.isExpanded;
    this.body.hidden = !this.isExpanded;
    this.arrowEl.textContent = this.isExpanded ? '▼' : '▶';
    this.header.setAttribute('aria-expanded', String(this.isExpanded));
    if (this.onToggle) this.onToggle(this.isExpanded);
  }

  expand() {
    if (!this.isExpanded) this.toggle();
  }

  collapse() {
    if (this.isExpanded) this.toggle();
  }

  setExpanded(expanded) {
    if (expanded !== this.isExpanded) this.toggle();
  }
}

/**
 * 在指定容器中渲染一组分类（折叠面板）
 * @param {Object[]} categories - 分类数组
 * @param {HTMLElement} container - 容器
 * @param {Function} buildCategoryContent - 接收 category，返回 HTMLElement
 * @param {Object} stateManager - 折叠状态管理器（如有）
 * @returns {Accordion[]} - 创建的面板列表
 */
export function renderAccordions(categories, container, buildCategoryContent, stateManager = null) {
  container.innerHTML = '';
  const accordions = [];
  for (const category of categories) {
    const contentEl = buildCategoryContent(category);
    if (!contentEl) continue;

    const isExpanded = stateManager
      ? stateManager.getExpanded(category.id) ?? true
      : true;

    const acc = new Accordion({
      title: category.name,
      icon: category.icon || '',
      categoryId: category.id,
      contentEl,
      defaultExpanded: isExpanded,
      onToggle: (expanded) => {
        if (stateManager) stateManager.setExpanded(category.id, expanded);
      },
    });
    container.appendChild(acc.root);
    accordions.push(acc);
  }
  return accordions;
}
