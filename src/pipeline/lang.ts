/**
 * Language detection, ZH→EN translation, and multilingual query support.
 */

export interface QueryLang {
  lang: string;
  gl: string;
  hl: string;
}

export function detectQueryLang(q: string): QueryLang {
  if (/[\u4e00-\u9fff]/.test(q)) return { lang: 'zh', gl: 'cn', hl: 'zh-cn' };
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(q)) return { lang: 'ja', gl: 'jp', hl: 'ja' };
  if (/[\uac00-\ud7af]/.test(q)) return { lang: 'ko', gl: 'kr', hl: 'ko' };
  if (/[\u0e00-\u0e7f]/.test(q)) return { lang: 'th', gl: 'th', hl: 'th' };
  if (/[\u0400-\u04ff]/.test(q)) return { lang: 'ru', gl: 'ru', hl: 'ru' };
  if (/[\u0600-\u06ff]/.test(q)) return { lang: 'ar', gl: 'sa', hl: 'ar' };
  if (/[àâäéèêëïîôùûüÿçœæ]/i.test(q)) return { lang: 'fr', gl: 'fr', hl: 'fr' };
  if (/[äöüß]/i.test(q)) return { lang: 'de', gl: 'de', hl: 'de' };
  if (/[áéíóúñ¿¡]/i.test(q)) return { lang: 'es', gl: 'es', hl: 'es' };
  if (/[ãõâêôç]/i.test(q)) return { lang: 'pt', gl: 'br', hl: 'pt-BR' };
  if (/[àèìòù]/i.test(q)) return { lang: 'it', gl: 'it', hl: 'it' };
  return { lang: 'en', gl: 'us', hl: 'en' };
}

export const LANG_NAMES: Record<string, string> = {
  zh: '中文', en: '英文', ja: '日语', ko: '韩语', fr: '法语', de: '德语',
  es: '西班牙语', pt: '葡萄牙语', ru: '俄语', ar: '阿拉伯语', it: '意大利语', th: '泰语',
};

export const WIKI_LANG_MAP: Record<string, string> = {
  zh: 'zh', ja: 'ja', ko: 'ko', fr: 'fr', de: 'de', es: 'es',
  pt: 'pt', ru: 'ru', ar: 'ar', it: 'it', th: 'th',
};

const ZH_EN: Record<string, string> = {
  '机器学习': 'machine learning', '深度学习': 'deep learning', '神经网络': 'neural network',
  '梯度下降': 'gradient descent', '自然语言处理': 'NLP', '计算机视觉': 'computer vision',
  '强化学习': 'reinforcement learning', '注意力机制': 'attention mechanism',
  '大语言模型': 'large language model', '生成式': 'generative',
  '比特币': 'bitcoin', '以太坊': 'ethereum', '区块链': 'blockchain', '加密货币': 'cryptocurrency',
  '减半': 'halving', '漏洞': 'vulnerability', '安全': 'security',
  '论文': 'paper', '算法': 'algorithm', '优化': 'optimization',
  '教程': 'tutorial', '指南': 'guide', '人工智能': 'AI',
};

export function extractEnglishTerms(query: string): string {
  let result = query;
  const entries = Object.entries(ZH_EN).sort((a, b) => b[0].length - a[0].length);
  for (const [zh, en] of entries) result = result.replace(new RegExp(zh, 'g'), ` ${en} `);
  const parts = result.match(/[a-zA-Z0-9][\w./-]*/g) ?? [];
  return parts.join(' ').trim() || query;
}
