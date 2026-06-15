import { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, shell } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const preloadPath = path.join(__dirname, 'preload.cjs')
const rendererPath = path.join(rootDir, 'renderer', 'index.html')
const iconPath = path.join(rootDir, 'assets', 'llama-cpp.ico')
const trayIconPath = path.join(rootDir, 'assets', 'llama-cpp-tray.png')
const authoredBaseDir = 'E:\\llama.cpp\\llama-b9601-bin-win-cuda-13.3-x64'
const authoredServerPath = 'E:\\llama.cpp\\llama-b9601-bin-win-cuda-13.3-x64\\llama-server.exe'
const authoredServerDir = path.dirname(authoredServerPath)

let mainWindow = null
let tray = null
let appIsQuitting = false
let firstHideNoticeShown = false
let serverChild = null
let stoppingServer = false
let runtimeStatus = {
  state: 'stopped',
  message: '服务未启动',
  pid: null,
  url: 'http://127.0.0.1:8080',
  startedAt: null,
}
let logs = []

function defaultBaseDir() {
  const candidates = [
    authoredBaseDir,
    path.resolve(rootDir, '..'),
    path.dirname(process.execPath),
    path.resolve(path.dirname(process.execPath), '..'),
  ]
  return candidates.find(candidate => existsSync(path.join(candidate, 'config.toml'))) || authoredBaseDir
}

function defaultConfigPath() {
  return path.join(defaultBaseDir(), 'config.toml')
}

function defaultLauncherPath() {
  return path.join(defaultBaseDir(), 'llama-server-launcher.exe')
}

function defaultStatePath() {
  return path.join(app.getPath('userData'), 'desktop-state.json')
}

// v1.0：系统 UI 状态（独立设置页用）
function defaultSystemPath() {
  return path.join(app.getPath('userData'), 'system.json')
}

// v1.0：判断参数是否需要重启才能生效
let _benchmarkCancel = false
// v1.0：GPU 信息缓存路径
function gpuCachePath() { return path.join(app.getPath('userData'), 'gpu-cache.json') }
// 采样类参数理论上可通过 llama-server 的 /props API 热改，
// 但稳定起见，全部先按"需重启"处理，让 stop+start 时应用新值
const HOT_RELOADABLE_PARAMS = new Set([
  'temp', 'top_k', 'top_p', 'min_p', 'presence_penalty', 'repeat_penalty',
])
function needRestartForParam(paramName) {
  if (!paramName) return true
  return !HOT_RELOADABLE_PARAMS.has(paramName)
}

function defaultConfig() {
  return {
    launch_mode: 'direct',
    launcher_path: defaultLauncherPath(),
    config_path: defaultConfigPath(),
    llama_bin_dir: authoredServerDir,
    llama_server_path: authoredServerPath,
    model: '',
    mmproj: '',
    mtp: '',  // v1.0：MTP 多 token 预测 draft 模型
    host: '0.0.0.0',
    port: 8080,
    ctx_size: 32768,
    n_predict: -1,
    n_gpu_layers: 99,
    chat_template_kwargs: '{"enable_thinking": false}',
    request_timeout_ms: 600000,
    temp: 0.8,
    top_k: 20,
    top_p: 0.95,
    min_p: 0,
    presence_penalty: 1.5,
    repeat_penalty: '',
    threads: '',
    threads_batch: '',
    batch_size: '',
    ubatch_size: '',
    cpu_moe: false,
    n_cpu_moe: '',
    device: '',
    split_mode: 'layer',
    tensor_split: '',
    main_gpu: '',
    extra_args: '',
    show_thinking: true,
    expand_thinking: false,
    show_raw_output: false,
    verbose: true,
    log_verbosity: 3,
    webui: true,
    embeddings: false,
    continuous_batching: true,
  }
}

function parseQuantization(fileName) {
  const text = String(fileName || '')
  const match = text.match(/\.(q\d[^.]*)\.gguf$/i) || text.match(/\.(iq\d[^.]*)\.gguf$/i)
  return match?.[1]?.toUpperCase() || '未标注'
}

function parseParameterScale(fileName) {
  const match = String(fileName || '').match(/(\d+(?:\.\d+)?)B/i)
  return match ? `${match[1]}B` : '未标注'
}

function parseFamily(fileName) {
  return String(fileName || '')
    .replace(/\.gguf$/i, '')
    .replace(/\.(q\d[^.]*)$/i, '')
    .replace(/\.(iq\d[^.]*)$/i, '')
}

async function fetchJson(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2800) })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

function humanParams(value) {
  const number = Number(value || 0)
  if (!Number.isFinite(number) || number <= 0) return ''
  if (number >= 1_000_000_000) return `${(number / 1_000_000_000).toFixed(2)}B`
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(2)}M`
  return String(number)
}

function sendEvent(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }
  mainWindow.webContents.send('llama:event', payload)
}

function setStatus(next) {
  runtimeStatus = { ...runtimeStatus, ...next }
  sendEvent({ type: 'status', status: runtimeStatus })
  updateTrayMenu()
}

function stripAnsi(value) {
  return String(value || '')
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\[[0-9;]*m/g, '')
}

function compactLogLine(source, line) {
  const text = String(line || '').trim()
  const lower = text.toLowerCase()
  const isError = lower.includes('error') || lower.includes('fail') || lower.includes('exception')
  const routinePatterns = [
    'que start_loop: waiting for new tasks',
    'que start_loop: processing new tasks',
    'srv update_slots: all slots are idle',
    'srv update_slots: run slots completed',
    'srv update_slots: update slots',
  ]

  if (!isError && routinePatterns.some(pattern => lower.includes(pattern))) {
    return null
  }

  if (lower.includes('http: streamed chunk: data:')) {
    if (lower.includes('[done]')) {
      return 'stream chunk: [DONE]'
    }
    return null
  }

  if (!isError && (
    lower.startsWith('parsed message:') ||
    lower.startsWith('parsed chat message:') ||
    lower.startsWith('response:') ||
    lower.startsWith('assistant:') ||
    lower.startsWith('prompt:') ||
    text.includes('"prompt":') ||
    text.includes('<|im_start|>') ||
    text.includes('<!DOCTYPE html')
  )) {
    return null
  }

  if (text.length > 420) {
    return `${text.slice(0, 260)} ... [truncated ${text.length - 260} chars]`
  }

  return text
}

function addLog(source, chunk) {
  const text = stripAnsi(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk))
  const entries = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => compactLogLine(source, line))
    .filter(Boolean)
    .map(line => ({ at: new Date().toISOString(), source, line }))

  if (entries.length === 0) {
    return
  }

  logs = [...logs, ...entries].slice(-1200)
  for (const entry of entries) {
    if (entry.line.includes('server is listening')) {
      setStatus({ state: 'running', message: '服务正在监听', pid: serverChild?.pid || null })
    }
    if (entry.line.toLowerCase().includes('error')) {
      setStatus({ message: entry.line })
    }
    // v1.0：解析 GPU 信息
    if (tryParseGpuInfo(entry.line)) {
      sendEvent({ type: 'gpu-infos', gpuInfos: getGpuInfos() })
    }
  }
  sendEvent({ type: 'logs', logs })
}

// v1.0：GPU 信息解析（移植自 cn.LammaForms TryParseGpuInfo）
// 从 llama.cpp 输出行中解析 CUDA 设备信息
const gpuInfoList = []
function getGpuInfos() { return [...gpuInfoList] }
function clearGpuInfos() { gpuInfoList.length = 0 }

/**
 * 尝试从一行 llama.cpp 输出中解析 GPU 信息
 * 支持两种格式：
 *   1) Device 0: NVIDIA GeForce RTX 3080 Laptop GPU, compute capability 8.6, VMM: yes, VRAM: 16383 MiB
 *   2) using device CUDA0 (name) (pci) - X MiB free
 */
function tryParseGpuInfo(line) {
  if (!line || typeof line !== 'string') return false
  const trimmed = line.trimStart()

  // 模式1（主要）: ggml_cuda_init 设备行
  const pattern1 = /^Device\s+(\d+):\s*(.+?),\s*compute\s+capability\s+\S+,\s*VMM:\s*\w+,\s*VRAM:\s*(\d+)\s*MiB/
  const m1 = trimmed.match(pattern1)
  if (m1) {
    const devId = parseInt(m1[1], 10)
    const name = m1[2].trim()
    const vramMB = parseInt(m1[3], 10)
    if (gpuInfoList.some(g => g.deviceId === devId)) return true
    gpuInfoList.push({
      deviceId: devId,
      name,
      pciBusId: '',
      freeMemoryMB: vramMB,
    })
    return true
  }

  // 模式2（兼容旧版本）: using device CUDA0 (name) (pci) - X MiB free
  const pattern2a = /using\s+device\s+CUDA(\d+)\s+\((.+?)\)\s+\((.+?)\)\s*-\s*(\d+)\s+MiB\s+free/i
  const m2a = trimmed.match(pattern2a)
  if (m2a) {
    const devId = parseInt(m2a[1], 10)
    const name = m2a[2].trim()
    const pciBusId = m2a[3].trim()
    const freeMB = parseInt(m2a[4], 10)
    if (gpuInfoList.some(g => g.deviceId === devId)) return true
    gpuInfoList.push({ deviceId: devId, name, pciBusId, freeMemoryMB: freeMB })
    writeFile(gpuCachePath(), JSON.stringify(gpuInfoList), 'utf8').catch(() => {})
    return true
  }
  const pattern2b = /using\s+device\s+CUDA:?(\d+).*?\(([^)]+)\).*?\(([^)]+)\).*?(\d+)\s+MiB/i
  const m2b = trimmed.match(pattern2b)
  if (m2b) {
    const devId = parseInt(m2b[1], 10)
    const name = m2b[2].trim()
    const pciBusId = m2b[3].trim()
    const freeMB = parseInt(m2b[4], 10)
    if (gpuInfoList.some(g => g.deviceId === devId)) return true
    gpuInfoList.push({ deviceId: devId, name, pciBusId, freeMemoryMB: freeMB })
    writeFile(gpuCachePath(), JSON.stringify(gpuInfoList), 'utf8').catch(() => {})
    return true
  }

  return false
}

function stripTomlComment(line) {
  let inString = false
  let escaped = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (char === '#' && !inString) {
      return line.slice(0, index)
    }
  }
  return line
}

function parseTomlValue(value) {
  const text = value.trim()
  if (!text) {
    return ''
  }
  if (text.startsWith('"') && text.endsWith('"')) {
    try {
      return JSON.parse(text)
    } catch {
      return text.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    }
  }
  if (text === 'true') {
    return true
  }
  if (text === 'false') {
    return false
  }
  if (/^[+-]?\d+$/.test(text)) {
    return Number.parseInt(text, 10)
  }
  if (/^[+-]?\d+\.\d+$/.test(text)) {
    return Number.parseFloat(text)
  }
  return text
}

function parseToml(raw) {
  const result = {}
  for (const originalLine of raw.split(/\r?\n/)) {
    const line = stripTomlComment(originalLine).trim()
    if (!line || line.startsWith('[')) {
      continue
    }
    const equalIndex = line.indexOf('=')
    if (equalIndex < 0) {
      continue
    }
    const key = line.slice(0, equalIndex).trim()
    const value = line.slice(equalIndex + 1)
    result[key] = parseTomlValue(value)
  }
  return result
}

function toNumber(value, fallback = '') {
  if (value === '' || value === null || value === undefined) {
    return fallback
  }
  const next = Number(value)
  return Number.isFinite(next) ? next : fallback
}

function normalizeConfig(values, state = {}) {
  const base = defaultConfig()
  const merged = { ...base, ...state, ...values }
  const launchMode = merged.launch_mode === 'launcher' ? 'launcher' : 'direct'
  const llamaBinDir = hasValue(merged.llama_bin_dir)
    ? String(merged.llama_bin_dir)
    : path.dirname(String(merged.llama_server_path || base.llama_server_path))
  return {
    ...merged,
    launch_mode: launchMode,
    llama_bin_dir: llamaBinDir,
    llama_server_path: path.join(llamaBinDir, 'llama-server.exe'),
    port: toNumber(merged.port, base.port),
    ctx_size: toNumber(merged.ctx_size, base.ctx_size),
    n_predict: toNumber(merged.n_predict, base.n_predict),
    n_gpu_layers: toNumber(merged.n_gpu_layers, base.n_gpu_layers),
    request_timeout_ms: toNumber(merged.request_timeout_ms, base.request_timeout_ms),
    temp: toNumber(merged.temp, base.temp),
    top_k: toNumber(merged.top_k, base.top_k),
    top_p: toNumber(merged.top_p, base.top_p),
    min_p: toNumber(merged.min_p, base.min_p),
    presence_penalty: toNumber(merged.presence_penalty, base.presence_penalty),
    log_verbosity: toNumber(merged.log_verbosity, base.log_verbosity),
    extra_args: String(merged.extra_args || ''),
    show_thinking: merged.show_thinking !== false,
    expand_thinking: Boolean(merged.expand_thinking),
    show_raw_output: Boolean(merged.show_raw_output),
    verbose: Boolean(merged.verbose),
    webui: Boolean(merged.webui),
    embeddings: Boolean(merged.embeddings),
    continuous_batching: Boolean(merged.continuous_batching),
    cpu_moe: Boolean(merged.cpu_moe),
  }
}

function tomlString(value) {
  return `"${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function optionalNumberLine(key, value) {
  if (value === '' || value === null || value === undefined) {
    return null
  }
  return `${key} = ${value}`
}

function buildToml(config) {
  const lines = [
    '# config.toml',
    '# Generated by Llama.cpp Desktop.',
    '',
    '# desktop launch mode: direct or launcher',
    `launch_mode = ${tomlString(config.launch_mode || 'direct')}`,
    '',
    '# llama-server.exe 的绝对路径',
    `llama_server_path = ${tomlString(config.llama_server_path)}`,
    '',
    '# 模型路径',
    `model = ${tomlString(config.model)}`,
  ]

  if (config.mmproj) {
    lines.push('', '# 多模态投影文件', `mmproj = ${tomlString(config.mmproj)}`)
  } else {
    lines.push('', '# mmproj = "G:\\\\llama.cpp\\\\models\\\\your-model\\\\mmproj.gguf"')
  }

  if (config.mtp) {
    lines.push('', '# v1.0：MTP 多 token 预测 draft 模型', `mtp = ${tomlString(config.mtp)}`)
  } else {
    lines.push('', '# mtp = "G:\\\\llama.cpp\\\\models\\\\your-model\\\\mtp-draft.gguf"')
  }

  lines.push(
    '',
    '# 服务器设置',
    `host = ${tomlString(config.host)}`,
    `port = ${config.port}`,
    '',
    '# 常用参数',
    `ctx_size = ${config.ctx_size}`,
    `n_predict = ${config.n_predict}`,
    `n_gpu_layers = ${config.n_gpu_layers}`,
    `request_timeout_ms = ${config.request_timeout_ms}`,
    '',
    '# 对话模板参数',
    `chat_template_kwargs = ${tomlString(config.chat_template_kwargs)}`,
    '',
    '# 采样设置',
    `temp = ${config.temp}`,
    `top_k = ${config.top_k}`,
    `top_p = ${config.top_p}`,
    `min_p = ${config.min_p}`,
    `presence_penalty = ${config.presence_penalty}`,
  )

  const repeatPenalty = optionalNumberLine('repeat_penalty', config.repeat_penalty)
  if (repeatPenalty) {
    lines.push(repeatPenalty)
  }

  lines.push('', '# 系统设置')
  for (const [key, value] of [
    ['threads', config.threads],
    ['threads_batch', config.threads_batch],
    ['batch_size', config.batch_size],
    ['ubatch_size', config.ubatch_size],
  ]) {
    const line = optionalNumberLine(key, value)
    lines.push(line || `# ${key} = `)
  }

  lines.push('', '# 混合专家模型设置')
  if (config.cpu_moe) {
    lines.push('cpu_moe = true')
  } else {
    lines.push('# cpu_moe = true')
  }
  const nCpuMoe = optionalNumberLine('n_cpu_moe', config.n_cpu_moe)
  lines.push(nCpuMoe || '# n_cpu_moe = 15')

  lines.push('', '# GPU 设置')
  if (config.device) {
    lines.push(`device = ${tomlString(config.device)}`)
  } else {
    lines.push('# device = ""')
  }
  if (config.split_mode) {
    lines.push(`split_mode = ${tomlString(config.split_mode)}`)
  }
  if (config.tensor_split) {
    lines.push(`tensor_split = ${tomlString(config.tensor_split)}`)
  } else {
    lines.push('# tensor_split = "3,1"')
  }
  const mainGpu = optionalNumberLine('main_gpu', config.main_gpu)
  lines.push(mainGpu || '# main_gpu = 0')

  lines.push(
    '',
    '# 日志与功能',
    `verbose = ${config.verbose ? 'true' : 'false'}`,
    `log_verbosity = ${config.log_verbosity}`,
    `webui = ${config.webui ? 'true' : 'false'}`,
    `embeddings = ${config.embeddings ? 'true' : 'false'}`,
    `continuous_batching = ${config.continuous_batching ? 'true' : 'false'}`,
    '',
    '# 额外 llama-server 参数，会追加到最终启动命令末尾',
    `extra_args = ${tomlString(config.extra_args)}`,
    `show_thinking = ${config.show_thinking ? 'true' : 'false'}`,
    `expand_thinking = ${config.expand_thinking ? 'true' : 'false'}`,
    `show_raw_output = ${config.show_raw_output ? 'true' : 'false'}`,
    '',
  )

  return lines.join('\n')
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

async function writeDesktopState(config) {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(
    defaultStatePath(),
    JSON.stringify(
      {
        config_path: config.config_path,
        launch_mode: config.launch_mode,
        launcher_path: config.launcher_path,
        config,
      },
      null,
      2,
    ),
    'utf8',
  )
}

// v1.0：加载/保存 system.json（独立设置页的 UI 状态）
async function loadSystemState() {
  return await readJson(defaultSystemPath(), {
    expanded: {},
    enabled: {},
    values: {},
  })
}

async function saveSystemState(state) {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(
    defaultSystemPath(),
    JSON.stringify(state || {}, null, 2),
    'utf8',
  )
  return true
}

async function loadConfig() {
  const state = await readJson(defaultStatePath(), {})
  const configPath = state.config_path || defaultConfigPath()
  let parsed = {}
  if (existsSync(configPath)) {
    try {
    parsed = parseToml(await readFile(configPath, 'utf8'))
    } catch (error) {
      addLog('desktop', `读取配置失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const config = normalizeConfig({ ...parsed, ...(state.config || {}) }, {
    config_path: configPath,
    launch_mode: state.launch_mode || state.config?.launch_mode || parsed.launch_mode || 'direct',
    launcher_path: state.launcher_path || defaultLauncherPath(),
  })
  runtimeStatus.url = localUrl(config)
  return config
}

async function saveConfig(config) {
  const normalized = normalizeConfig(config)
  if (normalized.launch_mode === 'launcher') {
    await mkdir(path.dirname(normalized.config_path), { recursive: true })
    await writeFile(normalized.config_path, buildToml(normalized), 'utf8')
  }
  await writeDesktopState(normalized)
  runtimeStatus.url = localUrl(normalized)
  return normalized
}

// v1.0：把 system.json 的 UI 参数合并到 extra_args
const PARAMS_JSON_PATHS = [
  path.join(rootDir, 'renderer', 'params', 'llama-params.json'),
  path.join(rootDir, 'renderer', 'params', 'turboquant-params.json'),
]
async function loadFlagMap() {
  const map = new Map()
  for (const p of PARAMS_JSON_PATHS) {
    try {
      const data = JSON.parse(await readFile(p, 'utf8'))
      for (const cat of data.categories || []) {
        for (const param of cat.params || []) {
          if (param.shortName && param.flag) map.set(param.shortName, param.flag)
        }
      }
    } catch { /* ignore */ }
  }
  return map
}
async function buildExtraArgsFromConfig(config) {
  const flagMap = await loadFlagMap()
  // llama-server 不支持的参数，跳过
  const clientOnly = new Set(['keep', 'prompt', 'tri-budget', 'tri-interval', 'tri-keep-first', 'attn-rot-k', 'attn-rot-v', 'reasoning-format', 'reasoning-budget', 'n-gpu-layers', 'ngl', 'n-predict', 'ctx-size', 'ctx_size', 'temp', 'top-k', 'top-p', 'min-p', 'presence-penalty', 'repeat-penalty', 'threads', 'threads-batch', 'batch-size', 'ubatch-size'])
  const extra = []
  for (const [key, val] of Object.entries(config || {})) {
    if (!key.startsWith('p_')) continue
    const shortName = key.slice(2) // "p_threads" → "threads"
    if (clientOnly.has(shortName)) continue
    const flag = flagMap.get(shortName)
    if (!flag) continue
    if (val === undefined || val === null || val === '') continue
    if (typeof val === 'boolean') { if (val) extra.push(flag); continue }
    extra.push(flag, String(val))
  }
  return extra.join(' ')
}

function localUrl(config) {
  const host = config.host && config.host !== '0.0.0.0' ? config.host : '127.0.0.1'
  return `http://${host}:${config.port}`
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== ''
}

function splitExtraArgs(raw) {
  const text = String(raw || '').replace(/\r?\n/g, ' ').trim()
  if (!text) {
    return []
  }

  const args = []
  let current = ''
  let quote = ''

  for (const char of text) {
    if (quote) {
      if (char === quote) {
        quote = ''
      } else {
        current += char
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current)
        current = ''
      }
      continue
    }
    current += char
  }

  if (quote) {
    throw new Error('自定义附加参数里有未闭合的引号')
  }
  if (current) {
    args.push(current)
  }
  return args
}

function pushArg(args, flag, value) {
  if (hasValue(value)) {
    args.push(flag, String(value))
  }
}

async function buildServerArgs(config) {
  const args = []
  pushArg(args, '--model', config.model)
  pushArg(args, '--mmproj', config.mmproj)
  pushArg(args, '--model-draft', config.mtp)
  if (config.mtp) {
    pushArg(args, '--spec-type', 'draft-mtp')
    pushArg(args, '--spec-draft-n-max', config.spec_draft_n_max ?? 2)
  }
  pushArg(args, '--host', config.host)
  pushArg(args, '--port', config.port)
  pushArg(args, '--ctx-size', config.ctx_size)
  pushArg(args, '--n-predict', config.n_predict)
  pushArg(args, '--n-gpu-layers', config.n_gpu_layers || config['p_n-gpu-layers'])
  pushArg(args, '--chat-template-kwargs', normalizeChatTemplateKwargsText(config.chat_template_kwargs))
  pushArg(args, '--temp', config.temp ?? config['p_temp'])
  pushArg(args, '--top-k', config.top_k ?? config['p_top-k'])
  pushArg(args, '--top-p', config.top_p ?? config['p_top-p'])
  pushArg(args, '--min-p', config.min_p ?? config['p_min-p'])
  pushArg(args, '--presence-penalty', config.presence_penalty ?? config['p_presence-penalty'])
  pushArg(args, '--repeat-penalty', config.repeat_penalty ?? config['p_repeat-penalty'])
  pushArg(args, '--threads', config.threads || config['p_threads'])
  pushArg(args, '--threads-batch', config.threads_batch || config['p_threads-batch'])
  pushArg(args, '--batch-size', config.batch_size || config['p_batch-size'])
  pushArg(args, '--ubatch-size', config.ubatch_size || config['p_ubatch-size'])
  pushArg(args, '--device', config.device)
  pushArg(args, '--split-mode', config.split_mode)
  pushArg(args, '--tensor-split', config.tensor_split)
  pushArg(args, '--main-gpu', config.main_gpu)
  pushArg(args, '--n-cpu-moe', config.n_cpu_moe)
  pushArg(args, '--log-verbosity', config.log_verbosity)

  if (config.cpu_moe) args.push('--cpu-moe')
  if (config.verbose) args.push('--verbose')
  args.push(config.webui ? '--webui' : '--no-webui')
  if (config.embeddings) args.push('--embeddings')
  args.push(config.continuous_batching ? '--cont-batching' : '--no-cont-batching')

  // v1.0：自动合并 p_ 前缀参数（不走 extra_args，避免重复累积）
  const autoArgs = await buildExtraArgsFromConfig(config)
  args.push(...splitExtraArgs(autoArgs))

  args.push(...splitExtraArgs(config.extra_args))

  return args
}

function quoteCommandPart(value) {
  const text = String(value || '')
  if (!text) {
    return '""'
  }
  return /[\s"]/u.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text
}

async function buildLaunchDetails(config) {
  const directMode = config.launch_mode !== 'launcher'
  const command = directMode ? config.llama_server_path : config.launcher_path
  try {
    const args = directMode ? await buildServerArgs(config) : []
    return {
      mode: directMode ? 'direct' : 'launcher',
      command,
      args,
      cwd: directMode ? path.dirname(config.llama_server_path) : path.dirname(config.config_path),
      preview: [command, ...args].map(quoteCommandPart).join(' '),
      error: '',
    }
  } catch (error) {
    return {
      mode: directMode ? 'direct' : 'launcher',
      command,
      args: [],
      cwd: directMode ? path.dirname(config.llama_server_path) : path.dirname(config.config_path),
      preview: quoteCommandPart(command),
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function stripWrappingQuotes(text) {
  const value = String(text || '').trim()
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1).trim()
    }
  }
  return value
}

function normalizeChatTemplateKwargsText(raw) {
  let text = stripWrappingQuotes(raw)
  if (!text) {
    return ''
  }
  text = text.replace(/^--chat-template-kwargs\s+/i, '').trim()
  text = stripWrappingQuotes(text)
  if (text.includes('\\"')) {
    text = text.replace(/\\"/g, '"')
  }
  return text
}

function parseChatTemplateKwargs(raw) {
  const text = String(raw || '').trim()
  if (!text) {
    return null
  }
  const normalized = normalizeChatTemplateKwargsText(text)
  let parsed
  try {
    parsed = JSON.parse(normalized)
  } catch (error) {
    throw new Error(`Chat Template Kwargs must be valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Chat Template Kwargs must be a JSON object, for example {"enable_thinking": false}')
  }
  return parsed
}

function requestTimeoutSignal(config) {
  const ms = Math.max(30000, toNumber(config.request_timeout_ms, 600000))
  return AbortSignal.timeout(ms)
}

function messageTextContent(content) {
  if (Array.isArray(content)) {
    return content
      .filter(item => item && item.type === 'text')
      .map(item => String(item.text || '').trim())
      .filter(Boolean)
      .join('\n\n')
  }
  return String(content || '').trim()
}

function prepareChatMessages(rawMessages) {
  const systemTexts = []
  const messages = []

  for (const message of Array.isArray(rawMessages) ? rawMessages : []) {
    if (!message || message.localOnly) continue
    if (!['user', 'assistant', 'system'].includes(message.role)) continue

    const text = String(message.content || '')
    const attachments = Array.isArray(message.attachments) ? message.attachments : []
    const textBlocks = attachments
      .filter(item => item.kind === 'text' && item.text)
      .map(item => `\n\n--- Attachment: ${item.name} ---\n${item.text}`)
    const fileBlocks = attachments
      .filter(item => item.kind !== 'text' && item.kind !== 'image')
      .map(item => `\n\n[Attachment: ${item.name}; ${item.mime || 'file'}; path: ${item.path}]`)
    const imageAttachments = attachments.filter(item => item.kind === 'image' && item.dataUrl)
    const mergedText = `${text}${textBlocks.join('')}${fileBlocks.join('')}`.trim()

    let next
    if (imageAttachments.length > 0) {
      next = {
        role: message.role,
        content: [
          {
            type: 'text',
            text: mergedText || 'Please analyze these images.',
          },
          ...imageAttachments.map(item => ({
            type: 'image_url',
            image_url: { url: item.dataUrl },
          })),
        ],
      }
    } else {
      next = {
        role: message.role,
        content: mergedText,
      }
    }

    if (!Array.isArray(next.content) && !String(next.content || '').trim()) continue
    if (message.role === 'system') {
      const systemText = messageTextContent(next.content)
      if (systemText) systemTexts.push(systemText)
      continue
    }
    messages.push(next)
  }

  return systemTexts.length
    ? [{ role: 'system', content: systemTexts.join('\n\n') }, ...messages]
    : messages
}

function buildChatRequestBody(config, messages, stream) {
  const body = {
    model: path.basename(config.model || 'local-model'),
    messages,
    temperature: toNumber(config.temp, 0.8),
    top_p: toNumber(config.top_p, 0.95),
    max_tokens: config.n_predict === -1 ? undefined : toNumber(config.n_predict, undefined),
    stream,
  }
  const templateKwargs = parseChatTemplateKwargs(config.chat_template_kwargs)
  if (templateKwargs) {
    body.chat_template_kwargs = templateKwargs
  }
  return body
}

function validation(config) {
  return {
    configExists: config.launch_mode !== 'launcher' || existsSync(config.config_path),
    launcherExists: config.launch_mode !== 'launcher' || existsSync(config.launcher_path),
    serverExists: existsSync(config.llama_server_path),
    modelExists: existsSync(config.model),
    mmprojExists: !config.mmproj || existsSync(config.mmproj),
    mtpExists: !config.mtp || existsSync(config.mtp),  // v1.0
  }
}

function mimeForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  return {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.toml': 'text/plain',
    '.yaml': 'text/yaml',
    '.yml': 'text/yaml',
    '.csv': 'text/csv',
    '.log': 'text/plain',
    '.py': 'text/x-python',
    '.js': 'text/javascript',
    '.ts': 'text/typescript',
    '.tsx': 'text/typescript',
    '.html': 'text/html',
    '.css': 'text/css',
  }[ext] || 'application/octet-stream'
}

function isTextLike(filePath) {
  return [
    '.txt',
    '.md',
    '.json',
    '.toml',
    '.yaml',
    '.yml',
    '.csv',
    '.log',
    '.py',
    '.js',
    '.ts',
    '.tsx',
    '.html',
    '.css',
    '.c',
    '.cpp',
    '.h',
    '.hpp',
  ].includes(path.extname(filePath).toLowerCase())
}

function isImageLike(filePath) {
  return ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(path.extname(filePath).toLowerCase())
}

function isAudioLike(filePath) {
  return ['.mp3', '.wav', '.flac', '.m4a', '.ogg'].includes(path.extname(filePath).toLowerCase())
}

function isPdfLike(filePath) {
  return path.extname(filePath).toLowerCase() === '.pdf'
}

async function buildAttachment(filePath) {
  const stat = await import('node:fs/promises').then(fs => fs.stat(filePath))
  const attachment = {
    path: filePath,
    name: path.basename(filePath),
    size: stat.size,
    mime: mimeForFile(filePath),
    kind: isImageLike(filePath) ? 'image' : isAudioLike(filePath) ? 'audio' : isPdfLike(filePath) ? 'pdf' : isTextLike(filePath) ? 'text' : 'file',
  }

  if (attachment.kind === 'image' && stat.size <= 10 * 1024 * 1024) {
    const raw = await readFile(filePath)
    attachment.dataUrl = `data:${attachment.mime};base64,${raw.toString('base64')}`
  }

  if (attachment.kind === 'text' && stat.size <= 256 * 1024) {
    attachment.text = await readFile(filePath, 'utf8')
  }

  return attachment
}

function contentFromStreamPayload(data) {
  const choice = data?.choices?.[0]
  return choice?.delta?.content || choice?.message?.content || data?.content || ''
}

async function appState() {
  const config = await loadConfig()
  return {
    config,
    status: runtimeStatus,
    logs,
    validation: validation(config),
    launch: await buildLaunchDetails(config),
  }
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow()
    return
  }
  mainWindow.setSkipTaskbar(false)
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.show()
  mainWindow.focus()
}

function statusLabel() {
  return {
    stopped: '未启动',
    starting: '启动中',
    running: '运行中',
    stopping: '停止中',
    error: '需要处理',
  }[runtimeStatus.state] || runtimeStatus.state
}

function updateTrayMenu() {
  if (!tray) {
    return
  }

  tray.setToolTip(`Llama.cpp Desktop - ${statusLabel()} - ${runtimeStatus.url}`)
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: '打开 Llama.cpp Desktop',
      click: showMainWindow,
    },
    {
      label: `${statusLabel()}  ${runtimeStatus.url}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: '打开 OpenAI Base URL',
      click: () => shell.openExternal(`${runtimeStatus.url}/v1`),
    },
    {
      label: '停止服务',
      enabled: Boolean(serverChild && serverChild.exitCode === null),
      click: async () => {
        if (serverChild && serverChild.exitCode === null) {
          stoppingServer = true
          setStatus({ state: 'stopping', message: '正在停止服务' })
          await taskkill(serverChild.pid)
        }
      },
    },
    { type: 'separator' },
    {
      label: '退出并停止服务',
      click: () => {
        appIsQuitting = true
        app.quit()
      },
    },
  ]))
}

function createTray() {
  if (tray) {
    return
  }

  const image = nativeImage.createFromPath(trayIconPath)
  tray = new Tray(image.isEmpty() ? nativeImage.createFromPath(iconPath) : image)
  tray.on('click', showMainWindow)
  tray.on('double-click', showMainWindow)
  updateTrayMenu()
}

// v1.1：根据当前配置设置窗口标题栏颜色（与主底色融为一体）
function getInitialTitleBarOverlay() {
  try {
    const fs = require('node:fs')
    const state = JSON.parse(fs.readFileSync(defaultStatePath(), 'utf8') || '{}')
    const dark = state.dark_theme ?? state.config?.dark_theme
    return dark
      ? { color: '#000000', symbolColor: '#ffffff' }   /* 暗夜：与 --bg 一致 */
      : { color: '#f8faf8', symbolColor: '#151713' }   /* 日间：与 --bg 一致 */
  } catch (e) {
    return { color: '#f8faf8', symbolColor: '#151713' }
  }
}

async function applyTitleBarOverlay() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    const state = await readJson(defaultStatePath(), {})
    const dark = state.dark_theme ?? state.config?.dark_theme
    mainWindow.setTitleBarOverlay(dark
      ? { color: '#000000', symbolColor: '#ffffff' }
      : { color: '#f8faf8', symbolColor: '#151713' }
    )
  } catch (e) { /* ignore */ }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    title: 'Llama.cpp Desktop',
    backgroundColor: '#F7F7F4',
    icon: iconPath,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      ...getInitialTitleBarOverlay(),
      height: 36,
    },
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  })

  // v1.1：先设置暗色标题栏（深紫黑），等待 ready-to-show 后再根据配置调整
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    applyTitleBarOverlay()
  })

  mainWindow.on('close', event => {
    if (appIsQuitting) {
      return
    }

    event.preventDefault()
    mainWindow.hide()
    mainWindow.setSkipTaskbar(true)
    if (!firstHideNoticeShown) {
      firstHideNoticeShown = true
      tray?.displayBalloon?.({
        title: 'Llama.cpp Desktop 仍在运行',
        content: '窗口已隐藏到系统托盘，本地服务会继续监听。',
      })
    }
  })

  mainWindow.loadFile(rendererPath)
  Menu.setApplicationMenu(null)
}

async function taskkill(pid) {
  await new Promise(resolve => {
    const child = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    })
    child.once('exit', resolve)
    child.once('error', resolve)
  })
}

function registerIpc() {
  ipcMain.handle('llama:get-state', async () => appState())

  ipcMain.handle('llama:save-config', async (_event, payload) => {
    const config = await saveConfig(payload.config)
    addLog('desktop', `配置已保存：${config.config_path}`)
    return {
      config,
      validation: validation(config),
      status: runtimeStatus,
      logs,
      launch: await buildLaunchDetails(config),
    }
  })

  ipcMain.handle('llama:start-server', async (_event, payload) => {
    if (serverChild && serverChild.exitCode === null) {
      return appState()
    }

    const config = await saveConfig(payload.config)
    const directMode = config.launch_mode !== 'launcher'
    if (!directMode && !existsSync(config.launcher_path)) {
      throw new Error(`找不到启动器：${config.launcher_path}`)
    }
    if (!existsSync(config.llama_server_path)) {
      throw new Error(`找不到 llama-server.exe：${config.llama_server_path}`)
    }
    if (!existsSync(config.model)) {
      throw new Error(`找不到模型文件：${config.model}`)
    }
    const launch = await buildLaunchDetails(config)
    if (launch.error) {
      throw new Error(launch.error)
    }

    logs = []
    stoppingServer = false
    setStatus({
      state: 'starting',
      message: '正在启动服务',
      pid: null,
      url: localUrl(config),
      startedAt: new Date().toISOString(),
    })
    const serverDir = path.dirname(config.llama_server_path)
    const command = launch.command
    const args = launch.args
    const cwd = launch.cwd
    addLog('desktop', `启动方式：${directMode ? 'direct llama-server.exe' : 'launcher'}`)
    addLog('desktop', `llama-server：${config.llama_server_path}`)
    if (directMode) {
      addLog('desktop', `参数：${args.join(' ')}`)
      addLog('desktop', `完整命令：${launch.preview}`)
      addLog('desktop', `关键参数：ctx=${config.ctx_size}, gpu_layers=${config.n_gpu_layers}, batch=${config.batch_size || 'auto'}, ubatch=${config.ubatch_size || 'auto'}, threads=${config.threads || 'auto'}`)
    }
    addLog('desktop', `启动器：${config.launcher_path}`)
    addLog('desktop', `配置：${config.config_path}`)

    serverChild = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NO_COLOR: '1',
        Path: `${serverDir};${process.env.Path || process.env.PATH || ''}`,
      },
    })

    setStatus({ pid: serverChild.pid })
    serverChild.stdout?.on('data', chunk => addLog('stdout', chunk))
    serverChild.stderr?.on('data', chunk => addLog('stderr', chunk))
    serverChild.once('error', error => {
      addLog('desktop', `启动失败：${error.message}`)
      setStatus({ state: 'error', message: error.message, pid: null })
    })
    serverChild.once('exit', code => {
      const message = stoppingServer ? '服务已停止' : `服务进程已退出：${code ?? 'unknown'}`
      addLog('desktop', message)
      serverChild = null
      setStatus({
        state: stoppingServer ? 'stopped' : 'error',
        message,
        pid: null,
      })
      stoppingServer = false
    })

    return appState()
  })

  ipcMain.handle('llama:stop-server', async () => {
    if (serverChild && serverChild.exitCode === null) {
      stoppingServer = true
      setStatus({ state: 'stopping', message: '正在停止服务' })
      await taskkill(serverChild.pid)
    }
    return appState()
  })

  // v1.0：获取独立设置页的 UI 状态
  ipcMain.handle('llama:get-ui-state', async () => {
    return await loadSystemState()
  })

  // v1.0：保存独立设置页的 UI 状态
  ipcMain.handle('llama:save-ui-state', async (_event, payload) => {
    await saveSystemState(payload || {})
    return { ok: true }
  })

  // v1.0：参数变化通知（前端 → 主进程）
  // 主进程判断是否需要重启，并把最新值存到 system.json
  ipcMain.handle('llama:on-param-change', async (_event, payload) => {
    const { paramName, value, isValueChange } = payload || {}
    if (!paramName) {
      return { ok: false, needRestart: false, reason: 'missing paramName' }
    }
    const needRestart = needRestartForParam(paramName)
    addLog(
      'desktop',
      `参数变化：${paramName} = ${JSON.stringify(value)}（${isValueChange ? '值' : '启用'}）${
        needRestart ? ' · 需要重启' : ' · 可热改'
      }`,
    )
    return { ok: true, needRestart, paramName }
  })

  // v1.0：显示 toast（在状态栏）
  ipcMain.handle('llama:show-toast', async (_event, payload) => {
    addLog('desktop', `[${payload?.type || 'info'}] ${payload?.message || ''}`)
    return { ok: true }
  })

  // v1.0：获取/清除 GPU 信息
  ipcMain.handle('llama:get-gpu-info', async () => {
    const gpuInfos = getGpuInfos()
    if (gpuInfos.length) return { gpuInfos }
    try { const cached = JSON.parse(await readFile(gpuCachePath(), 'utf8')); return { gpuInfos: cached || [] } }
    catch { return { gpuInfos: [] } }
  })

  ipcMain.handle('llama:clear-gpu-infos', async () => {
    clearGpuInfos()
    try { await writeFile(gpuCachePath(), '[]', 'utf8') } catch { /* ignore */ }
    return { ok: true }
  })

  // v1.0：加载参数配置文件（Electron 下 fetch 无法读 file:// 协议文件）
  ipcMain.handle('llama:get-params-json', async (_event, payload) => {
    const { file } = payload || {}
    if (!file) return { categories: [] }
    const filePath = path.join(rootDir, 'renderer', 'params', file)
    try {
      return JSON.parse(await readFile(filePath, 'utf8'))
    } catch {
      return { categories: [] }
    }
  })

  // v1.0：保存启动脚本
  ipcMain.handle('llama:save-startup-script', async (_event, payload) => {
    const { command } = payload || {}
    if (!command) return { ok: false }
    const result = await dialog.showSaveDialog({
      title: '保存启动脚本',
      defaultPath: 'start-llama-server.bat',
      filters: [{ name: '批处理脚本', extensions: ['bat'] }, { name: 'Shell 脚本', extensions: ['sh'] }],
    })
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }
    const isBat = result.filePath.endsWith('.bat')
    const lines = isBat
      ? [`@echo off`, `chcp 65001 >nul`, ``, command, `pause`]
      : [`#!/bin/bash`, ``, command]
    await writeFile(result.filePath, lines.join('\n'), 'utf8')
    return { ok: true, filePath: result.filePath }
  })

  // v1.0：加载启动脚本（读取文件内容）
  ipcMain.handle('llama:load-startup-script', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择启动脚本',
      filters: [{ name: '批处理/Shell 脚本', extensions: ['bat', 'sh', 'cmd'] }],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths?.[0]) return { ok: false }
    const content = await readFile(result.filePaths[0], 'utf8')
    // 提取命令（去头尾）
    const lines = content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('@') && !l.startsWith('#') && !l.startsWith('chcp') && !l.startsWith('pause') && !l.startsWith('exit'))
    const cmd = lines.join(' ')
    return { ok: true, content: cmd }
  })

  // v1.0：模型配置保存/加载
  ipcMain.handle('llama:save-model-config', async (_event, payload) => {
    const { config } = payload || {}
    if (!config) return { ok: false }
    const result = await dialog.showSaveDialog({
      title: '保存模型配置',
      defaultPath: 'model-config.json',
      filters: [{ name: '配置文件', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return { ok: false }
    await writeFile(result.filePath, JSON.stringify(config, null, 2), 'utf8')
    return { ok: true, filePath: result.filePath }
  })

  ipcMain.handle('llama:load-model-config', async () => {
    const result = await dialog.showOpenDialog({
      title: '加载模型配置',
      filters: [{ name: '配置文件', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths?.[0]) return { ok: false }
    const content = await readFile(result.filePaths[0], 'utf8')
    return { ok: true, config: JSON.parse(content) }
  })

  // v1.0：CPU 多线程测速
  ipcMain.handle('llama:run-mt-benchmark', async (event, payload) => {
    const { model, cliDir, threadList } = payload || {}
    if (!model || !cliDir || !threadList?.length) return { results: [] }
    const cliPath = path.join(cliDir, 'llama-cli.exe')
    if (!existsSync(cliPath)) return { error: `找不到 ${cliPath}` }
    _benchmarkCancel = false

    const results = []
    let currentChild = null
    for (let i = 0; i < threadList.length; i++) {
      if (_benchmarkCancel) { if (currentChild && !currentChild.killed) currentChild.kill(); break }
      const t = threadList[i]
      await new Promise(resolve => {
        currentChild = spawn(cliPath, ['-t', String(t), '-m', model, '-c', '4096', '-p', 'hello', '-n', '128', '--no-display-prompt'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
        const chunks = []
        currentChild.stdout.on('data', d => chunks.push(d.toString()))
        currentChild.stderr.on('data', d => chunks.push(d.toString()))
        currentChild.on('close', () => {
          const output = chunks.join('')
          const ps = (output.match(/\[ Prompt:\s*([\d.]+)\s*t\/s/i) || [])[1]
          const gs = (output.match(/\|\s*Generation:\s*([\d.]+)\s*t\/s/i) || [])[1]
          results.push({ threads: t, promptSpeed: ps ? parseFloat(ps) : 0, genSpeed: gs ? parseFloat(gs) : 0 })
          const log = output.split('\n').filter(l => l.includes('t/s') || l.includes('Prompt') || l.includes('thread')).slice(-6).join('\n') || output.slice(-300)
          event.sender.send('benchmark-progress', { type: 'mt', index: i, total: threadList.length, threads: t, status: 'done', log })
          resolve()
        })
      })
    }
    return { results, canceled: _benchmarkCancel }
  })

  // v1.0：llama-bench 基准测试
  ipcMain.handle('llama:run-llama-bench', async (_event, payload) => {
    const { model, cliDir } = payload || {}
    if (!model || !cliDir) return { error: '缺少参数' }
    const benchPath = path.join(cliDir, 'llama-bench.exe')
    if (!existsSync(benchPath)) return { error: `找不到 ${benchPath}` }

    const args = ['-m', model, '-p', '64', '-n', '128', '-ngl', '99', '--output-json']
    const output = await new Promise(resolve => {
      const chunks = []
      const child = spawn(benchPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      child.stdout.on('data', d => chunks.push(d.toString()))
      child.stderr.on('data', d => chunks.push(d.toString()))
      child.on('close', () => resolve(chunks.join('')))
    })

    // 发回日志
    const logLines = output.split('\n').filter(l => l.includes('t/s') || l.includes('|') || l.includes('model')).slice(-8).join('\n') || output.slice(-400)
    event.sender.send('benchmark-progress', { type: 'llama-bench', status: 'done', log: logLines })

    // 尝试解析 JSON 输出
    try {
      const jsonStart = output.indexOf('[')
      if (jsonStart >= 0) {
        const json = JSON.parse(output.slice(jsonStart))
        return { results: Array.isArray(json) ? json : [json] }
      }
    } catch {}
    // 回退：从文本输出中解析
    const results = []
    const lines = output.split('\n')
    for (const line of lines) {
      const parts = line.trim().split(/\s*\|\s*/)
      if (parts.length >= 7 && !isNaN(parseFloat(parts[parts.length - 1]))) {
        results.push({
          model: parts[0]?.trim() || '',
          size: parts[1]?.trim() || '',
          backend: parts[2]?.trim() || '',
          ngl: parts[3]?.trim() || '',
          test: parts[4]?.trim() || '',
          tps: parseFloat(parts[parts.length - 1]) || 0,
        })
      }
    }
    return { results }
  })

  // v1.0：取消测速
  ipcMain.handle('llama:cancel-benchmark', async () => {
    _benchmarkCancel = true
    return { ok: true }
  })

  // v1.0：扫描模型目录
  ipcMain.handle('llama:scan-models', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择模型目录',
      properties: ['openDirectory'],
    })
    if (result.canceled || !result.filePaths?.[0]) return { ok: false }
    const dir = result.filePaths[0]
    const files = await readdir(dir)
    const ggufFiles = files.filter(f => f.toLowerCase().endsWith('.gguf')).sort()
    const models = []
    for (const f of ggufFiles) {
      const lower = f.toLowerCase()
      let type = 'model'
      if (lower.includes('mmproj')) type = 'mmproj'
      else if (lower.includes('mtp')) {
        type = f.includes('MTP') ? 'model' : 'mtp'
      }
      const fullPath = path.join(dir, f)
      // 过滤：主模型文件小于 1GB 时标记为 small（但不完全排除，让用户手动确认）
      let isSmall = false
      if (type === 'model') {
        try { isSmall = (await stat(fullPath)).size < 1.2 * 1024 * 1024 * 1024 } catch { /* ignore */ }
      }
      models.push({ name: f, path: fullPath, type, isSmall })
    }
    return {
      ok: true,
      dir,
      models,
      suggested: {
        model: models.find(m => m.type === 'model' && !m.isSmall)?.path || models.find(m => m.type === 'model')?.path || '',
        mmproj: models.find(m => m.type === 'mmproj')?.path || '',
        mtp: models.find(m => m.type === 'mtp')?.path || '',
      },
      smallCount: models.filter(m => m.isSmall).length,
    }
  })

  // v1.0：上下文批量测速
  ipcMain.handle('llama:run-benchmark', async (event, payload) => {
    const { model, cliDir, ctxSizes } = payload || {}
    if (!model || !cliDir || !ctxSizes?.length) return { results: [] }
    const cliPath = path.join(cliDir, 'llama-cli.exe')
    if (!existsSync(cliPath)) return { error: `找不到 ${cliPath}` }
    _benchmarkCancel = false
    const results = []
    let currentChild = null
    for (let i = 0; i < ctxSizes.length; i++) {
      if (_benchmarkCancel) { if (currentChild && !currentChild.killed) currentChild.kill(); break }
      const ctx = ctxSizes[i]
      await new Promise(resolve => {
        currentChild = spawn(cliPath, ['-m', model, '-c', String(ctx.value), '-p', 'hello', '-n', '128', '--no-display-prompt'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
        const chunks = []
        currentChild.stdout.on('data', d => chunks.push(d.toString())); currentChild.stderr.on('data', d => chunks.push(d.toString()))
        currentChild.on('close', () => {
          const output = chunks.join('')
          const ps = (output.match(/\[ Prompt:\s*([\d.]+)\s*t\/s/i) || [])[1]
          const gs = (output.match(/\|\s*Generation:\s*([\d.]+)\s*t\/s/i) || [])[1]
          results.push({ ctx: ctx.value, label: ctx.label, promptSpeed: ps ? parseFloat(ps) : 0, genSpeed: gs ? parseFloat(gs) : 0 })
          const log = output.split('\n').filter(l => l.includes('t/s') || l.includes('Prompt') || l.includes('model')).slice(-6).join('\n') || output.slice(-300)
          event.sender.send('benchmark-progress', { type: 'ctx', index: i, total: ctxSizes.length, ctx: ctx.label, status: 'done', log })
          resolve()
        })
      })
    }
    return { results, canceled: _benchmarkCancel }
  })

  ipcMain.handle('llama:test-health', async (_event, payload) => {
    const config = normalizeConfig(payload.config)
    const url = localUrl(config)
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3500) })
      return { ok: response.ok, status: response.status, url }
    } catch (error) {
      return { ok: false, status: 0, url, message: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('llama:get-model-info', async (_event, payload) => {
    const config = normalizeConfig(payload?.config || {})
    const serverUrl = localUrl(config)
    const modelPath = config.model || ''
    const fileName = path.basename(modelPath || 'local-model')
    let fileSize = 0
    if (modelPath && existsSync(modelPath)) {
      try {
        fileSize = (await stat(modelPath)).size
      } catch {
        fileSize = 0
      }
    }

    const [modelsPayload, propsPayload] = await Promise.all([
      fetchJson(`${serverUrl}/v1/models`),
      fetchJson(`${serverUrl}/props`),
    ])

    const apiModel = modelsPayload?.data?.[0] || {}
    const apiMeta = apiModel?.meta || {}
    const listedModel = modelsPayload?.models?.[0] || {}

    return {
      name: listedModel?.name || apiModel?.id || propsPayload?.model_alias || fileName,
      filePath: propsPayload?.model_path || modelPath,
      fileSize: Number(apiMeta?.size || fileSize || 0),
      family: listedModel?.details?.family || parseFamily(fileName),
      quantization: listedModel?.details?.quantization_level || parseQuantization(fileName),
      parameterScale: listedModel?.details?.parameter_size || parseParameterScale(fileName),
      nParams: Number(apiMeta?.n_params || 0),
      ctxSize: toNumber(propsPayload?.default_generation_settings?.n_ctx, toNumber(config.ctx_size, '')),
      trainingContext: toNumber(apiMeta?.n_ctx_train, ''),
      embeddingSize: toNumber(apiMeta?.n_embd, ''),
      vocabSize: toNumber(apiMeta?.n_vocab, ''),
      vocabType: toNumber(apiMeta?.vocab_type, ''),
      parallelSlots: toNumber(propsPayload?.total_slots, ''),
      nPredict: toNumber(config.n_predict, ''),
      gpuLayers: toNumber(config.n_gpu_layers, ''),
      temperature: toNumber(config.temp, ''),
      topP: toNumber(config.top_p, ''),
      topK: toNumber(config.top_k, ''),
      minP: toNumber(config.min_p, ''),
      presencePenalty: toNumber(config.presence_penalty, ''),
      repeatPenalty: toNumber(config.repeat_penalty, ''),
      serverUrl,
      build: propsPayload?.build_info || path.basename(config.llama_server_path || 'llama-server.exe'),
      chatTemplateText: String(propsPayload?.chat_template || config.chat_template_kwargs || '').trim(),
      propsSource: Boolean(propsPayload),
      modelSource: Boolean(modelsPayload),
      parameterLabel: humanParams(apiMeta?.n_params),
    }
  })

  ipcMain.handle('llama:chat-completion', async (_event, payload) => {
    const config = normalizeConfig(payload.config)
    const url = `${localUrl(config)}/v1/chat/completions`
    const messages = Array.isArray(payload.messages)
      ? payload.messages
          .filter(message => message && (message.role === 'user' || message.role === 'assistant' || message.role === 'system'))
          .map(message => {
            const text = String(message.content || '')
            const attachments = Array.isArray(message.attachments) ? message.attachments : []
            const textBlocks = attachments
              .filter(item => item.kind === 'text' && item.text)
              .map(item => `\n\n--- 附件：${item.name} ---\n${item.text}`)
            const fileBlocks = attachments
              .filter(item => item.kind !== 'text' && item.kind !== 'image')
              .map(item => `\n\n[附件：${item.name}，${item.mime || 'file'}，路径：${item.path}]`)
            const imageAttachments = attachments.filter(item => item.kind === 'image' && item.dataUrl)

            if (imageAttachments.length > 0) {
              return {
                role: message.role,
                content: [
                  {
                    type: 'text',
                    text: `${text}${textBlocks.join('')}${fileBlocks.join('')}`.trim() || '请分析这些图片。',
                  },
                  ...imageAttachments.map(item => ({
                    type: 'image_url',
                    image_url: { url: item.dataUrl },
                  })),
                ],
              }
            }

            return {
              role: message.role,
              content: `${text}${textBlocks.join('')}${fileBlocks.join('')}`,
            }
          })
          .filter(message => Array.isArray(message.content) || String(message.content || '').trim())
      : []

    if (messages.length === 0) {
      throw new Error('没有可发送的消息')
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: path.basename(config.model || 'local-model'),
        messages,
        temperature: toNumber(config.temp, 0.8),
        top_p: toNumber(config.top_p, 0.95),
        max_tokens: config.n_predict === -1 ? undefined : toNumber(config.n_predict, undefined),
        chat_template_kwargs: parseChatTemplateKwargs(config.chat_template_kwargs) || undefined,
        stream: false,
      }),
      signal: requestTimeoutSignal(config),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`模型接口返回 ${response.status}${text ? `：${text.slice(0, 500)}` : ''}`)
    }

    const data = await response.json()
    const content = data?.choices?.[0]?.message?.content || data?.content || ''
    return {
      ok: true,
      content: String(content || ''),
      raw: data,
    }
  })

  ipcMain.handle('llama:chat-stream', async (_event, payload) => {
    const config = normalizeConfig(payload.config)
    const requestId = payload.requestId || `${Date.now()}`
    const url = `${localUrl(config)}/v1/chat/completions`
    const startedAt = Date.now()
    const messages = Array.isArray(payload.messages)
      ? payload.messages
          .filter(message => message && (message.role === 'user' || message.role === 'assistant' || message.role === 'system'))
          .map(message => {
            const text = String(message.content || '')
            const attachments = Array.isArray(message.attachments) ? message.attachments : []
            const textBlocks = attachments
              .filter(item => item.kind === 'text' && item.text)
              .map(item => `\n\n--- 附件：${item.name} ---\n${item.text}`)
            const fileBlocks = attachments
              .filter(item => item.kind !== 'text' && item.kind !== 'image')
              .map(item => `\n\n[附件：${item.name}，${item.mime || 'file'}，路径：${item.path}]`)
            const imageAttachments = attachments.filter(item => item.kind === 'image' && item.dataUrl)

            if (imageAttachments.length > 0) {
              return {
                role: message.role,
                content: [
                  {
                    type: 'text',
                    text: `${text}${textBlocks.join('')}${fileBlocks.join('')}`.trim() || '请分析这些图片。',
                  },
                  ...imageAttachments.map(item => ({
                    type: 'image_url',
                    image_url: { url: item.dataUrl },
                  })),
                ],
              }
            }

            return {
              role: message.role,
              content: `${text}${textBlocks.join('')}${fileBlocks.join('')}`,
            }
          })
          .filter(message => Array.isArray(message.content) || String(message.content || '').trim())
      : []

    if (messages.length === 0) {
      throw new Error('没有可发送的消息')
    }

    addLog('chat', `request ${requestId}: ${messages.length} messages -> ${url}`)

    let response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: path.basename(config.model || 'local-model'),
          messages,
          temperature: toNumber(config.temp, 0.8),
          top_p: toNumber(config.top_p, 0.95),
          max_tokens: config.n_predict === -1 ? undefined : toNumber(config.n_predict, undefined),
          chat_template_kwargs: parseChatTemplateKwargs(config.chat_template_kwargs) || undefined,
          stream: true,
        }),
        signal: requestTimeoutSignal(config),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog('chat', `request failed: ${message}`)
      throw error
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      const message = `模型接口返回 ${response.status}${text ? `：${text.slice(0, 500)}` : ''}`
      addLog('chat', `request failed: ${message}`)
      throw new Error(message)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      addLog('chat', 'request failed: response body is not a readable stream')
      throw new Error('模型接口没有返回可读取的流')
    }

    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    let content = ''
    let raw = null
    let streamAnnounced = false

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split(/\r?\n\r?\n/)
      buffer = parts.pop() || ''

      for (const part of parts) {
        const lines = part
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trim())

        for (const line of lines) {
          if (!line || line === '[DONE]') continue
          try {
            const data = JSON.parse(line)
            raw = data
            const delta = contentFromStreamPayload(data)
            if (delta) {
              if (!streamAnnounced) {
                addLog('chat', `streaming response for ${requestId}`)
                streamAnnounced = true
              }
              content += delta
              sendEvent({ type: 'chat-stream', requestId, delta })
            }
          } catch {
            // Ignore malformed stream fragments; llama.cpp can occasionally split aggressively.
          }
        }
      }
    }

    const elapsed = Math.max(0.1, (Date.now() - startedAt) / 1000)
    const approxTokens = Math.max(1, Math.round(String(content || '').length / 3))
    addLog('chat', `stream done: ${approxTokens} approx tokens, ${elapsed.toFixed(1)}s`)
    sendEvent({ type: 'chat-stream', requestId, done: true, content })
    return { ok: true, content, raw }
  })

  ipcMain.handle('llama:pick-file', async (_event, payload) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: payload?.properties || ['openFile'],
      filters: payload?.filters || [{ name: 'All Files', extensions: ['*'] }],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('llama:pick-attachments', async (_event, payload) => {
    const kind = payload?.kind || 'file'
    const filterMap = {
      image: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      audio: [
        { name: 'Audio', extensions: ['mp3', 'wav', 'flac', 'm4a', 'ogg'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      text: [
        { name: 'Text and Code', extensions: ['txt', 'md', 'json', 'toml', 'yaml', 'yml', 'csv', 'log', 'py', 'js', 'ts', 'tsx', 'html', 'css', 'c', 'cpp', 'h', 'hpp'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      pdf: [
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      file: [
        { name: 'Documents and Images', extensions: ['txt', 'md', 'json', 'toml', 'yaml', 'yml', 'csv', 'log', 'py', 'js', 'ts', 'tsx', 'html', 'css', 'pdf', 'mp3', 'wav', 'flac', 'm4a', 'ogg', 'png', 'jpg', 'jpeg', 'webp'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    }
    const filters = filterMap[kind] || filterMap.file

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters,
    })

    if (result.canceled) {
      return []
    }

    const attachments = []
    for (const filePath of result.filePaths) {
      try {
        attachments.push(await buildAttachment(filePath))
      } catch (error) {
        attachments.push({
          path: filePath,
          name: path.basename(filePath),
          size: 0,
          mime: mimeForFile(filePath),
          kind: 'file',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return attachments
  })

  ipcMain.handle('llama:reveal-path', async (_event, payload) => {
    if (payload?.filePath) {
      shell.showItemInFolder(payload.filePath)
    }
    return { ok: true }
  })

  ipcMain.handle('llama:open-url', async (_event, payload) => {
    if (payload?.url) {
      await shell.openExternal(payload.url)
    }
    return { ok: true }
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.whenReady().then(() => {
    registerIpc()
    createTray()
    createMainWindow()
  })

  app.on('second-instance', () => {
    if (mainWindow) {
      showMainWindow()
    }
  })

  app.on('before-quit', async event => {
    appIsQuitting = true
    if (serverChild && serverChild.exitCode === null && !stoppingServer) {
      event.preventDefault()
      stoppingServer = true
      await taskkill(serverChild.pid)
      app.quit()
    }
  })

  app.on('window-all-closed', () => {
    // Keep the local server alive in the system tray.
  })
}
