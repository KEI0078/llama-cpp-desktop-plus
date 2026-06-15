# 更新日志

## v1.1.0（2026-06-16）

### 🆕 新增功能

#### 🌙 暗夜主题（Apple 暗色模式）
- 纯黑 `#000` + 深灰 `#1c1c1e` + 系统蓝 `#0a84ff`
- 80+ 处硬编码颜色替换为 CSS 变量
- 顶部栏 ☀️/🌙 PNG 透明按钮切换
- macOS `hiddenInset` 隐藏红黄绿按钮
- Windows `titleBarOverlay` 动态切换（日间 `#f8faf8` / 暗夜 `#000`）

#### 💬 会话管理
- **置顶** 📌 / **归档** 📦 / **导出** .md/.txt / **删除**
- 归档会话默认折叠，侧边栏底部「📦 N」按钮切换查看
- IPC 文件存储 + localStorage 双重同步

#### 🛑 停止 AI 生成
- chatBusy 时发送按钮变为红色 ■ 停止按钮
- `AbortController` 中断 fetch 流式请求
- 提示 `[已停止生成]` 标记

#### 📋 终端日志过滤
- 全部 / 运行(stdout) / 服务端(stderr) 切换
- 服务端日志从设置【测试】tab 迁移到终端页

#### 📐 设置面板优化
- 所有参数字段加 hint 悬停注释
- 11 个数字字段改为下拉菜单（Temperature/Top-K/Top-P/Min-P/Threads/Batch 等）
- Device 选项修复为 llama.cpp 真值（dev0/dev1/none）

#### 📱 UI 优化
- 顶部栏靠左布局（`flex-start`）
- 回到聊天按钮与说明文字对齐
- 终端日志区固定 `max-width: 920px` + `min-height: 420px`
- Composer 改为 flex 布局，发送时不再跳跃
- 全部 render() 统一 `preserveChatScroll`，不再回顶部

### 🐛 Bug 修复

| 问题 | 根因 | 修复 |
|------|------|------|
| 日志行距过大 | 模板字面量缩进在 flex 中被当 item | 单行模板 + `display: block` |
| 日志有横线 | `terminal-row` 用 `grid + border` | 改 flex + 无 border |
| 标题栏色块 | backgroundColor 与 --bg 色差 | 统一 `#f8faf8` |
| macOS 红黄绿按钮 | `titleBarStyle: 'hidden'` 不够 | 改 `'hiddenInset'` |
| 终端区高度太小 | `.terminal-screen .terminal-console` 有 `min-height: 0` 覆盖 | 加 `min-height: 420px` |
| 发送/重发回到顶部 | render() 无参数触发"不在底部保持原位" | 改 `jumpToBottom: true` |
| 点击导出无反应 | mainWindow 可能为 null | 加 try-catch + fallback |
| Device 无效参数 | 下拉用 cuda/vulkan 等错误值 | 改用 dev0/dev1/none + 过滤空值 |

### 📦 打包

```bash
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" npm run dist
```

产物：
- `Llama.cpp-Desktop-Plus-v1.1.0-2026-06-16.exe`（便携版，87 MB）
- `Llama.cpp-Desktop-Plus-Setup-v1.1.0-2026-06-16.exe`（安装版，87 MB）

---

## v1.0.0（2026-06-14）

### 🆕 新增功能

#### 参数管理
- 整合 cn.LammaForms 11 分类参数面板，7 个常用分类平铺到【概述】→运行参数
- 下拉选择替代数值输入：CPU线程数、批处理大小、评估批次大小、上下文大小(4K~5M)、主GPU(动态检测)、Top-K、并行请求数、K/V缓存类型、推理格式、Device、Threads batch
- 参数悬停 tooltip 说明
- 功能开关统一用 switchField 渲染

#### MTP 多 Token 预测
- `--model-draft` + `--spec-type draft-mtp` + `--spec-draft-n-max 2` 自动追加
- 文件名智能识别：大写 `MTP` = 模型内置 | 小写 `mtp` = 独立加载

#### GPU 实时解析
- 从 llama.cpp 输出实时解析显卡型号/显存（2 种格式兼容）
- 概述→已检测的显卡 卡片展示
- 持久化缓存（gpu-cache.json），关闭应用后不丢失

#### 测速工具（【日志】→快速测速）
- 上下文批量测速（4K~1M 勾选遍历，对比 Prompt/Generation t/s）
- CPU 多线程测试（1~16 线程勾选遍历）
- llama-bench 基准测试
- 停止按钮（kill 子进程）
- 实时日志窗口 + 结果表格

#### 模型扫描
- 扫描目录下所有 .gguf，智能分类（主模型 / mmproj / MTP）
- 主模型文件过滤（优先选 >1.2GB）
- 自动填入路径，未找到则清空

#### 脚本与配置
- 保存/加载启动脚本（.bat）
- 模型配置保存/加载（.json，一键切换）
- 解析参数按钮 + 复制命令按钮

#### 日志系统
- 三栏切换：全部 / 运行(stdout) / 服务端(stderr)
- 单行流布局（flex）
- ⬇ 最新按钮 + ✕ 清空按钮

#### UI 优化
- 设置面板滚动位置保持
- Toast 消息底部水平居中
- 底部上下文使用率指示器（已用/总量/百分比/颜色）
- 聊天消息 token 数显示
- 模型芯片按钮已移除

### 🐛 Bug 修复

| 问题 | 根因 | 修复 |
|------|------|------|
| 参数重复几十次 | 自动生成参数不断追加到 extra_args | 改为 buildServerArgs 内直接生成 |
| GPU 层数无效 | buildServerArgs 读 Qiao 字段，用户设置在 p_ 前缀字段 | 添加 `\|\|`/`??` fallback |
| `-k` 参数报错 | llama-cli 专用参数被传给 llama-server | clientOnly 跳过 |
| `--tri-budget` 报错 | TurboQuant 专用参数 | clientOnly 跳过 |
| G 盘硬编码路径 | Qiao 源码中写死 `G:\` 路径 | 替换为 E 盘路径 |
| 点击按钮回到顶部 | innerHTML 重建后旧元素引用失效 | 重建后重新 querySelector |
| Toast 遮挡按钮 | 右下角定位与按钮重叠 | 改为底部居中 |

### 🛠️ 技术改进

- 参数→命令数据流重构：buildServerArgs + buildExtraArgsFromConfig 双通道
- 20+ 个 IPC 接口
- clientOnly 跳过列表防止参数重复
- GPU 信息持久化缓存机制
- electron-builder 打包（portable + NSIS）

### 📦 打包

```bash
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" npm run dist
```

产物：
- `Llama.cpp-Desktop-Plus.exe`（便携版，87 MB）
- `Llama.cpp-Desktop-Plus-Setup.exe`（安装版，87 MB）

---

## 与 Qiao 原版对比

| 维度 | Qiao 原版 | Plus 增强版 |
|------|-----------|-----------|
| 参数管理 | 8 个基础 tab | + 7 分类常用参数平铺 + 下拉选择 + tooltip |
| MTP | ❌ | ✅ `--model-draft` + `--spec-type` |
| GPU 信息 | ❌ | ✅ 实时解析 + 持久化缓存 |
| 测速工具 | ❌ | ✅ 3 个工具 + 停止 + 实时日志 |
| 模型扫描 | ❌ 手动选路径 | ✅ 自动扫描 + 分类 + 过滤 |
| 脚本配置 | ❌ | ✅ 保存/加载/解析/复制 |
| 日志 | 单一日志 | 三栏切换 + 刷新/清空 + 单行流 |
| 上下文指示 | ❌ | ✅ 底部状态栏实时显示 |
| 模型配置切换 | ❌ | ✅ .json 一键切换 |
| 导航 tab | 4 个 | 概述→模型→开发者→MCP→日志 |
