const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('llamaDesktop', {
  // Qiao 原版接口（保留）
  getState: () => ipcRenderer.invoke('llama:get-state'),
  saveConfig: payload => ipcRenderer.invoke('llama:save-config', payload),
  startServer: payload => ipcRenderer.invoke('llama:start-server', payload),
  stopServer: () => ipcRenderer.invoke('llama:stop-server'),
  testHealth: payload => ipcRenderer.invoke('llama:test-health', payload),
  chatCompletion: payload => ipcRenderer.invoke('llama:chat-completion', payload),
  streamChat: payload => ipcRenderer.invoke('llama:chat-stream', payload),
  getModelInfo: payload => ipcRenderer.invoke('llama:get-model-info', payload),
  pickFile: options => ipcRenderer.invoke('llama:pick-file', options?.properties ? options : { filters: options }),
  pickAttachments: payload => ipcRenderer.invoke('llama:pick-attachments', payload),
  revealPath: filePath => ipcRenderer.invoke('llama:reveal-path', { filePath }),
  openUrl: url => ipcRenderer.invoke('llama:open-url', { url }),

  // v1.0：独立设置页新增接口
  getUiState: () => ipcRenderer.invoke('llama:get-ui-state'),
  saveUiState: payload => ipcRenderer.invoke('llama:save-ui-state', payload),
  onParamChange: payload => ipcRenderer.invoke('llama:on-param-change', payload),
  showToast: payload => ipcRenderer.invoke('llama:show-toast', payload),

  // v1.0：GPU 信息
  getGpuInfo: () => ipcRenderer.invoke('llama:get-gpu-info'),
  clearGpuInfos: () => ipcRenderer.invoke('llama:clear-gpu-infos'),

  // v1.0：参数配置文件（Electron 下无法 fetch）
  getParamsJson: file => ipcRenderer.invoke('llama:get-params-json', { file }),

  // v1.0：保存启动脚本
  saveStartupScript: payload => ipcRenderer.invoke('llama:save-startup-script', payload),

  // v1.0：上下文批量测速
  runBenchmark: payload => ipcRenderer.invoke('llama:run-benchmark', payload),

  // v1.0：取消测速
  cancelBenchmark: () => ipcRenderer.invoke('llama:cancel-benchmark'),

  // v1.0：扫描模型
  scanModels: () => ipcRenderer.invoke('llama:scan-models'),

  // v1.0：多线程测速 + llama-bench
  runMtBenchmark: payload => ipcRenderer.invoke('llama:run-mt-benchmark', payload),
  runLlamaBench: payload => ipcRenderer.invoke('llama:run-llama-bench', payload),

  // v1.0：加载脚本 + 模型配置
  loadStartupScript: () => ipcRenderer.invoke('llama:load-startup-script'),
  saveModelConfig: payload => ipcRenderer.invoke('llama:save-model-config', payload),
  loadModelConfig: () => ipcRenderer.invoke('llama:load-model-config'),

  // 事件订阅
  onEvent: callback => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('llama:event', handler)
    return () => ipcRenderer.removeListener('llama:event', handler)
  },
})
