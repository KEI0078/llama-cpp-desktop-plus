// 参数加载器（params-loader）
// 合并 llama-params.json 和 turboquant-params.json 的所有 categories
// 按用户要求加 "1-" 数字前缀

let cachedCategories = null;

/**
 * 加载所有参数分类（合并 llama-params + turboquant-params）
 * @returns {Promise<Object[]>} - 11 个分类的数组
 */
export async function loadAllCategories() {
  if (cachedCategories) return cachedCategories;

  try {
    // 1) 加载 llama.cpp 标准参数
    const llamaRes = await fetch('./params/llama-params.json');
    const llamaData = await llamaRes.json();

    // 2) 加载 TurboQuant 参数
    const turboRes = await fetch('./params/turboquant-params.json');
    const turboData = await turboRes.json();

    // 3) 合并 + 加 ID 和 "1-" 前缀
    const merged = [];

    for (const cat of llamaData.categories || []) {
      merged.push({
        ...cat,
        id: generateId(cat.name),
        // 改 name 为 "1-xxx" 格式
        name: `${merged.length + 1}-${cat.name}`,
        source: 'llama',
      });
    }

    for (const cat of turboData.categories || []) {
      merged.push({
        ...cat,
        id: generateId(cat.name),
        name: `${merged.length + 1}-${cat.name}`,
        source: 'turboquant',
      });
    }

    cachedCategories = merged;
    return merged;
  } catch (err) {
    console.error('Failed to load params:', err);
    return [];
  }
}

/**
 * 根据分类名生成稳定 ID（用作 state key）
 */
function generateId(name) {
  // "核心基础参数" -> "core-basic-params"
  // "KV 缓存量化类型" -> "kv-cache-quant-type"
  // 简单做：去掉空格 + 保留中文 + 加前缀
  return `cat-${name.replace(/\s+/g, '-')}`;
}

/**
 * 重新加载（清缓存）
 */
export function clearCache() {
  cachedCategories = null;
}
