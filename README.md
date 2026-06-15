<div align="center">
  <img src="assets/llama-cpp.png" width="88" alt="Llama.cpp Desktop Plus logo" />

  <h1>Llama.cpp Desktop Plus</h1>

  <p>
    基于 <a href="https://github.com/Qiao-920/llama-cpp-desktop">Qiao-920/llama-cpp-desktop</a> 的增强版本。
    <br />
    整合 cn.LammaForms 的 6 大差异化功能，保持 Qiao 现代 UI 的同时补全专业工具链。
  </p>

  <p>
    <img alt="Windows" src="https://img.shields.io/badge/Windows-10%20%2F%2011-506f51?style=flat-square" />
    <img alt="Electron" src="https://img.shields.io/badge/Electron-41-506f51?style=flat-square" />
    <img alt="llama.cpp" src="https://img.shields.io/badge/llama.cpp-local-506f51?style=flat-square" />
    <img alt="License" src="https://img.shields.io/badge/license-MIT-151713?style=flat-square" />
  </p>
</div>

## 与原版的差异

| 功能 | Qiao 原版 | Plus 增强版 |
|------|-----------|-----------|
| 参数管理 | 8 个基础 tab（采样/惩罚/开发者等） | + 7 分类常用参数整合进概述→运行参数，下拉选择/提示说明更完整 |
| MTP 支持 | ❌ 不支持 | ✅ `--model-draft` + `--spec-type draft-mtp`，自动识别 MTP/mtp 文件名 |
| GPU 信息 | ❌ 无 | ✅ 从 llama.cpp 输出实时解析显卡型号/显存，概述卡片展示 |
| 测试工具 | ❌ 无 | ✅ 上下文批量测速、CPU 多线程测试、llama-bench 基准，带停止按钮和实时日志 |
| 模型扫描 | ❌ 手动选路径 | ✅ 扫描目录自动识别主模型/mmproj/MTP，智能分类填入 |
| 脚本配置 | ❌ 无 | ✅ 保存/加载启动脚本、模型配置一键保存/加载 |
| 参数解析 | 自动（保存时） | ✅ 手动"解析参数"按钮，随时刷新启动命令 |
| MCP | 预留空位 | 预留 |
| 模型配置切换 | ❌ 无 | ✅ 保存/加载 .json，一键切换不同模型参数 |

## ✨ 增强功能一览

### 🔧 参数管理
- 7 个分类的常用参数整合进【概述】→运行参数（form-grid two 两列布局）
- CPU线程数、批处理大小、上下文大小等下**拉选择**替代手动输入
- 参数悬停 **tooltip** 显示说明

### 🚀 MTP 多 Token 预测
- `--model-draft` + `--spec-type draft-mtp` + `--spec-draft-n-max 2` 自动追加
- 文件名智能识别：`MTP`（大写）= 模型内置 | `mtp`（小写）= 单独加载

### 🖥️ GPU 实时解析
- 从 llama.cpp 输出实时解析显卡型号、显存
- 支持两种输出格式（ggml_cuda_init / 旧版 CUDA）
- 概述→已检测的显卡卡片展示

### 📊 测试工具（【日志】→快速测速）
- **上下文批量测速**：4K~1M 勾选遍历，对比 Prompt/Generation 速度
- **CPU 多线程测试**：1~16 线程勾选遍历，找最优线程数
- **llama-bench 基准**：调用 llama-bench 做硬件性能测试
- **停止按钮**：可强制中断正在运行的测试
- **模型配置保存/加载**：存为 .json，一键切换不同模型参数
- **参数解析按钮**：手动刷新启动命令

## v1.1.0 新增（2026-06-16）

### 🌙 暗夜主题（Apple 暗色模式）
- 纯黑 `#000` 主背景 + 深灰卡片 `#1c1c1e` + 系统蓝 `#0a84ff`
- 顶部栏 ☀️/🌙 透明 PNG 按钮切换，暗夜自动反相
- macOS `titleBarStyle: 'hiddenInset'` 隐藏红黄绿按钮
- Windows `titleBarOverlay` 动态切换（日间浅色/暗夜深色）

### 💬 会话管理
- 置顶 📌 / 归档 📦 / 导出 .md + .txt / 删除
- 归档会话默认折叠，侧边栏底部「📦 N」按钮切换
- IPC 文件存储 + localStorage 双重同步

### 🛑 停止 AI 生成
- 发送按钮在生成过程中变为红色 ■ 停止按钮
- `AbortController` 中断 fetch 流式请求，标记 `[已停止生成]`

### 📋 终端日志
- 全部 / 运行(stdout) / 服务端(stderr) 三栏过滤
- 固定 `max-width: 920px` + `min-height: 420px`
- 服务端日志从【设置→测试】tab 迁移到终端页

### 📐 设置面板优化
- 所有字段加 hint 悬停注释
- 11 个数字字段改为下拉菜单（Temperature/Top-K/Top-P/Min-P/Threads/Batch 等）
- Device 选项修复为 llama.cpp 真值（dev0/dev1/none）

### 🐛 关键修复
- 所有 render() 统一 `preserveChatScroll` / `jumpToBottom`，不再回顶部
- Composer grid→flex，发送时不再跳跃
- 80+ 处硬编码颜色 → CSS 变量（暗夜自适应）
- 日志行距修复（单行模板 + display:block）

## 快速开始

1. 配置 llama.cpp 路径和模型文件（【模型】→模型与模板）
2. 点「扫描模型目录」自动检测，或手动选择
3. 点「保存并启动」
4. 使用内置聊天，或接入 Hermes / OpenClaw 等客户端

## 开发运行

```bash
cd "llama-cpp-desktop-plus-source code"
npm install
npm start
```

## 打包

```bash
# 国内需 electron 镜像
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" npm run dist
```

产物：`dist/Llama.cpp-Desktop-Plus-{日期}.exe`（便携版）和 `-Setup.exe`（安装版）。

## 项目结构

```text
desktop/      Electron 主进程（IPC + 测速引擎 + GPU 解析 + MTP）
renderer/     桌面端界面（Qiao 原生组件 + 新增卡片/表格/日志）
renderer/params/  参数配置文件（llama-params.json + turboquant-params.json）
```

## 开源说明

本仓库基于 [Qiao-920/llama-cpp-desktop](https://github.com/Qiao-920/llama-cpp-desktop)（MIT 协议）进行增强开发。

- ✅ 保留原版全部功能（聊天/日志/终端/托盘/OpenAI 兼容 API）
- ✅ 新增功能不破坏原版架构
- ⚠️ 不包含 llama.cpp 二进制文件、GGUF 模型文件

原作者：[Qiao-920](https://github.com/Qiao-920)

## License

MIT
