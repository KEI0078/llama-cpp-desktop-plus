// renderer/boot.js
// 在 #settings-page 加载后，绑定"返回聊天"和"保存配置"按钮，并暴露 initSettingsPage 给 app.js 调用

import { initSettingsPage, refreshSettings } from './settings/settings.js';

let initialized = false;

function bindSettingsPageButtons() {
  const backBtn = document.getElementById('settings-back-btn');
  const saveBtn = document.getElementById('settings-save-btn');
  const sp = document.getElementById('settings-page');
  const app = document.getElementById('app');

  if (backBtn) {
    backBtn.onclick = () => {
      if (sp) sp.style.display = 'none';
      if (app) app.style.display = '';
    };
  }

  if (saveBtn) {
    saveBtn.onclick = async () => {
      if (window.llamaDesktop && window.llamaDesktop.saveConfig) {
        try {
          // 触发主进程保存（让主进程整合 config.toml）
          saveBtn.disabled = true;
          saveBtn.textContent = '保存中...';
          await window.llamaDesktop.saveConfig({});
          saveBtn.textContent = '✓ 已保存';
          setTimeout(() => {
            saveBtn.textContent = '保存配置';
            saveBtn.disabled = false;
          }, 2000);
        } catch (err) {
          saveBtn.textContent = '✗ 保存失败';
          setTimeout(() => {
            saveBtn.textContent = '保存配置';
            saveBtn.disabled = false;
          }, 2000);
          console.error('[Settings] 保存失败:', err);
        }
      }
    };
  }
}

window.initSettingsPage = async () => {
  if (initialized) return;
  initialized = true;

  bindSettingsPageButtons();

  const container = document.getElementById('settings-body');
  if (!container) {
    console.error('[Boot] 找不到 #settings-body');
    return;
  }

  try {
    await initSettingsPage(container);
    console.log('[Boot] 独立设置页初始化完成');
  } catch (err) {
    console.error('[Boot] 独立设置页初始化失败:', err);
    container.innerHTML = `<div style="padding: 24px; color: #f87171;">加载参数失败：${err.message}</div>`;
  }
};

window.refreshSettingsPage = () => {
  initialized = false;
  refreshSettings();
  window.initSettingsPage();
};
