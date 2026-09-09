import { BaseMethod } from './base.js';
import type { SearchResult, MethodConfig } from '../types/index.js';

/**
 * FinanceMethod — 新浪财经 + 腾讯财经免费 API
 *
 * 支持 A 股、港股实时行情，无需 API key。
 * 先用 LLM 或关键词匹配提取股票代码，再调 API 获取数据。
 */
export class FinanceMethod extends BaseMethod {
  readonly name = 'finance';
  readonly config: MethodConfig = {
    name: 'finance',
    description: 'Real-time stock data from Sina/Tencent Finance API',
    supportedParams: ['query', 'stockCode'],
  };

  private static readonly STOCK_MAP: Record<string, string> = {
    '金山办公': 'sh688111', '金山': 'sh688111',
    '小米': 'hk01810', '小米集团': 'hk01810',
    '腾讯': 'hk00700', '腾讯控股': 'hk00700',
    '阿里巴巴': 'hk09988', '阿里': 'hk09988',
    '百度': 'hk09888', '百度集团': 'hk09888',
    '京东': 'hk09618', '京东集团': 'hk09618',
    '美团': 'hk03690',
    '网易': 'hk09999',
    '比亚迪': 'sz002594',
    '宁德时代': 'sz300750',
    '茅台': 'sh600519', '贵州茅台': 'sh600519',
    '中国平安': 'sh601318', '平安': 'sh601318',
    '招商银行': 'sh600036', '招行': 'sh600036',
    '工商银行': 'sh601398', '工行': 'sh601398',
    '建设银行': 'sh601939', '建行': 'sh601939',
    '中国银行': 'sh601988',
    '农业银行': 'sh601288',
    '中信证券': 'sh600030',
    '海康威视': 'sz002415',
    '五粮液': 'sz000858',
    '中国中免': 'sh601888',
    '长城汽车': 'sh601633',
    '恒瑞医药': 'sh600276',
    '迈瑞医疗': 'sz300760',
    '药明康德': 'sh603259',
    '中芯国际': 'hk00981',
    '理想汽车': 'hk02015', '理想': 'hk02015',
    '蔚来': 'hk09866', '蔚来汽车': 'hk09866',
    '小鹏汽车': 'hk09868', '小鹏': 'hk09868',
    '快手': 'hk01024',
    '哔哩哔哩': 'hk09626', 'B站': 'hk09626',
    '拼多多': 'hk01020', 'PDD': 'hk01020',
    '中国移动': 'sh600941',
    '中国电信': 'sh601728',
    '中国联通': 'sh600050',
    '万科': 'sz000002', '万科A': 'sz000002',
    '格力电器': 'sz000651', '格力': 'sz000651',
    '美的集团': 'sz000333', '美的': 'sz000333',
    '隆基绿能': 'sh601012', '隆基': 'sh601012',
    '中国石油': 'sh601857',
    '中国石化': 'sh600028',
    '紫金矿业': 'sh601899',
    '科大讯飞': 'sz002230', '讯飞': 'sz002230',
    '三六零': 'sh601360', '360': 'sh601360',
    '寒武纪': 'sh688256',
    '中微公司': 'sh688012',
  };

  /**
   * Try to resolve stock code via Sina suggest API when STOCK_MAP misses.
   */
  private async searchStockCode(keyword: string): Promise<string | null> {
    try {
      const url = `https://suggest3.sinajs.cn/suggest/type=11,12,13,14,15&key=${encodeURIComponent(keyword)}&name=suggestdata`;
      const resp = await fetch(url, {
        headers: { 'Referer': 'https://finance.sina.com.cn/', 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(3_000),
      });
      const text = await resp.text();
      const match = text.match(/"([^"]+)"/);
      if (!match) return null;
      // Format: "代码,简称,display,...;代码,简称,display,...;"
      const items = match[1].split(';').filter(Boolean);
      for (const item of items) {
        const parts = item.split(',');
        if (parts.length < 4) continue;
        const rawCode = parts[3]; // e.g. "11_sh688111" or "31_hk01810"
        const codeParts = rawCode.split('_');
        if (codeParts.length >= 2) return codeParts[1]; // "sh688111"
      }
    } catch {}
    return null;
  }

  async execute(params: Record<string, unknown>): Promise<SearchResult[]> {
    const query = (params.query as string) ?? '';
    const stockCode = (params.stockCode as string) ?? '';

    let code = stockCode;
    if (!code) {
      // Longest-match first from STOCK_MAP
      const sortedNames = Object.keys(FinanceMethod.STOCK_MAP).sort((a, b) => b.length - a.length);
      for (const name of sortedNames) {
        if (query.includes(name) && FinanceMethod.STOCK_MAP[name]) {
          code = FinanceMethod.STOCK_MAP[name];
          break;
        }
      }
    }

    // Fallback: try Sina suggest API to auto-detect stock code
    if (!code) {
      const keywords = query.replace(/[股价行情财报最新今日实时涨跌市值估值]/g, '').trim();
      if (keywords.length >= 2) {
        code = await this.searchStockCode(keywords) || '';
      }
    }

    if (!code) return [];

    const results: SearchResult[] = [];

    // Sina Finance API
    try {
      const sinaData = await this.fetchSina(code);
      if (sinaData) {
        results.push({
          filePath: `https://finance.sina.com.cn/realstock/company/${code}/nc.shtml`,
          lines: [0],
          snippet: sinaData,
          score: 2.0, // High priority for financial data
          source: 'sina-finance',
          metadata: { title: `${code} 实时行情 - 新浪财经`, url: `https://finance.sina.com.cn/` },
        });
      }
    } catch {}

    // Tencent Finance API
    try {
      const tencentData = await this.fetchTencent(code);
      if (tencentData) {
        results.push({
          filePath: `https://stockapp.finance.qq.com/mstats/#mod=list&id=${code}`,
          lines: [0],
          snippet: tencentData,
          score: 1.8,
          source: 'tencent-finance',
          metadata: { title: `${code} 行情 - 腾讯财经`, url: `https://finance.qq.com/` },
        });
      }
    } catch {}

    return results;
  }

  private async fetchSina(code: string): Promise<string | null> {
    // Sina format: sh600519 (A股沪), sz002594 (A股深), hk01810 (港股)
    let sinaCode = code;
    if (code.startsWith('hk')) {
      sinaCode = `rt_hk${code.slice(2)}`;
    }

    const url = `https://hq.sinajs.cn/list=${sinaCode}`;
    const resp = await fetch(url, {
      headers: {
        'Referer': 'https://finance.sina.com.cn/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(5_000),
    });

    const text = await resp.text();
    if (!text || text.includes('""')) return null;

    // Parse Sina response
    const match = text.match(/"([^"]+)"/);
    if (!match) return null;

    const parts = match[1].split(',');

    if (code.startsWith('hk')) {
      // HK stock format
      // 0:名称中文, 1:开盘, 2:昨收, 3:最高, 4:最低, 5:最新, 6:涨跌额, 7:涨跌幅, ...
      if (parts.length < 10) return null;
      const name = parts[1] || code;
      const price = parts[6] || '-';
      const change = parts[7] || '-';
      const changePercent = parts[8] || '-';
      const high = parts[4] || '-';
      const low = parts[5] || '-';
      const open = parts[2] || '-';
      const prevClose = parts[3] || '-';
      const volume = parts[12] || '-';
      const turnover = parts[11] || '-';

      return `📊 ${name} (${code.toUpperCase()}) 实时行情\n` +
        `最新价: ${price} 港元\n` +
        `涨跌额: ${change} | 涨跌幅: ${changePercent}%\n` +
        `今开: ${open} | 昨收: ${prevClose}\n` +
        `最高: ${high} | 最低: ${low}\n` +
        `成交量: ${volume} | 成交额: ${turnover}`;
    } else {
      // A-share format
      // 0:名称, 1:开盘, 2:昨收, 3:当前, 4:最高, 5:最低, 6:买入, 7:卖出, 8:成交量(股), 9:成交额
      if (parts.length < 20) return null;
      const name = parts[0] || code;
      const open = parts[1] || '-';
      const prevClose = parts[2] || '-';
      const price = parts[3] || '-';
      const high = parts[4] || '-';
      const low = parts[5] || '-';
      const volume = parts[8] || '-';
      const turnover = parts[9] || '-';
      const date = parts[30] || '';
      const time = parts[31] || '';

      const priceNum = parseFloat(price);
      const prevNum = parseFloat(prevClose);
      const change = (priceNum - prevNum).toFixed(2);
      const changePercent = prevNum > 0 ? ((priceNum - prevNum) / prevNum * 100).toFixed(2) : '-';

      return `📊 ${name} (${code.toUpperCase()}) 实时行情\n` +
        `最新价: ${price} 元\n` +
        `涨跌额: ${change} | 涨跌幅: ${changePercent}%\n` +
        `今开: ${open} | 昨收: ${prevClose}\n` +
        `最高: ${high} | 最低: ${low}\n` +
        `成交量: ${(parseInt(volume) / 10000).toFixed(0)}万手 | 成交额: ${(parseFloat(turnover) / 100000000).toFixed(2)}亿\n` +
        `时间: ${date} ${time}`;
    }
  }

  private async fetchTencent(code: string): Promise<string | null> {
    // Tencent format: sh688111, sz002594, hk01810
    let tencentCode = code;

    const url = `https://qt.gtimg.cn/q=${tencentCode}`;
    const resp = await fetch(url, {
      headers: {
        'Referer': 'https://finance.qq.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(5_000),
    });

    const text = await resp.text();
    if (!text || text.includes('pv_none')) return null;

    const match = text.match(/~([^~]+)/g);
    if (!match || match.length < 40) return null;

    // Tencent response is ~ separated
    const parts = match.map(s => s.replace('~', ''));
    const name = parts[1] || code;
    const price = parts[3] || '-';
    const prevClose = parts[4] || '-';
    const open = parts[5] || '-';
    const volume = parts[6] || '-'; // in 手
    const turnover = parts[37] || '-'; // in 万元
    const high = parts[33] || '-';
    const low = parts[34] || '-';
    const pe = parts[39] || '-'; // PE ratio
    const marketCap = parts[45] || '-'; // 总市值(亿)

    return `📊 ${name} (${code.toUpperCase()}) 腾讯财经数据\n` +
      `最新价: ${price}\n` +
      `昨收: ${prevClose} | 今开: ${open}\n` +
      `最高: ${high} | 最低: ${low}\n` +
      `成交量: ${volume}手 | 成交额: ${turnover}万\n` +
      `市盈率(PE): ${pe}\n` +
      `总市值: ${marketCap}亿`;
  }
}
