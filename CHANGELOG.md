# 更新日志

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
