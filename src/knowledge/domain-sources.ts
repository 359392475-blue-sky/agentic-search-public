/**
 * DomainSources — 领域-优先源知识库 (Agent-Accessible Only)
 *
 * 核心原则:
 *   1. 无需登录 — agent 可以直接 HTTP 访问
 *   2. 无需 API Key — 或有免费无限 key
 *   3. 返回结构化数据 — JSON/XML/可解析 HTML
 *   4. 优先小众灰色渠道 — 大站有登录墙，小站才真正可用
 *
 * accessMethod:
 *   - 'api'         直接 HTTP GET/POST 返回 JSON/XML，无需 key
 *   - 'scrape'      返回 HTML，需解析。无反爬或反爬弱
 *   - 'torrent_api' 返回磁力链接/种子信息的 API
 */

export interface DomainSource {
  name: string;
  /** Base URL or API endpoint template. {q} = query placeholder */
  url: string;
  accessMethod: 'api' | 'scrape' | 'torrent_api';
  /** Why this source matters for an agent */
  why: string;
  /** Example curl/fetch call */
  example?: string;
  lang: 'en' | 'zh' | 'multi';
}

export interface DomainEntry {
  domain: string;
  label: string;
  keywords: string[];
  sources: DomainSource[];
}

// ═══════════════════════════════════════════
// THE REGISTRY
// ═══════════════════════════════════════════

export const DOMAIN_SOURCES: DomainEntry[] = [

  // ────────────────────────────────────────
  // 学术论文 & 开放获取
  // ────────────────────────────────────────
  {
    domain: 'academic',
    label: '学术论文',
    keywords: ['论文', 'paper', 'research', '研究', 'study', 'journal', '期刊', 'arxiv', 'citation', '引用', 'doi', 'preprint', '综述', 'survey', 'review', '推导', 'derivation', '证明', 'proof', '算法', 'algorithm', '原理', 'principle', '方法', 'method', '模型', 'model', '实现', 'implementation', '解读', '解析'],
    sources: [
      {
        name: 'arXiv API',
        url: 'http://export.arxiv.org/api/query?search_query={q}&max_results=10',
        accessMethod: 'api',
        why: '完全免费无key, Atom XML返回, CS/物理/数学预印本, 含PDF直链',
        example: 'curl "http://export.arxiv.org/api/query?search_query=all:transformer+attention&max_results=5"',
        lang: 'en',
      },
      {
        name: 'Semantic Scholar API',
        url: 'https://api.semanticscholar.org/graph/v1/paper/search?query={q}&limit=10',
        accessMethod: 'api',
        why: '无需key(有速率限制), 引用图谱, TLDR摘要, 2亿+论文',
        example: 'curl "https://api.semanticscholar.org/graph/v1/paper/search?query=attention+mechanism&limit=5&fields=title,abstract,citationCount,url"',
        lang: 'en',
      },
      {
        name: 'OpenAlex API',
        url: 'https://api.openalex.org/works?search={q}&per_page=10',
        accessMethod: 'api',
        why: '完全免费无key, 2.5亿+学术作品, 替代已关闭的Microsoft Academic',
        example: 'curl "https://api.openalex.org/works?search=deep+learning&per_page=5"',
        lang: 'en',
      },
      {
        name: 'CrossRef API',
        url: 'https://api.crossref.org/works?query={q}&rows=10',
        accessMethod: 'api',
        why: '无需key, DOI元数据权威来源, 1.4亿+记录, 支持引用关系',
        example: 'curl "https://api.crossref.org/works?query=machine+learning&rows=5"',
        lang: 'en',
      },
      {
        name: 'CORE API',
        url: 'https://api.core.ac.uk/v3/search/works?q={q}&limit=10',
        accessMethod: 'api',
        why: '免费无需注册(有速率限制), 全球最大开放获取全文库, 含PDF',
        example: 'curl "https://api.core.ac.uk/v3/search/works?q=neural+network&limit=5"',
        lang: 'en',
      },
      {
        name: 'Unpaywall API',
        url: 'https://api.unpaywall.org/v2/{doi}?email=agent@search.local',
        accessMethod: 'api',
        why: '只需填email(无需注册), 给DOI找免费全文PDF链接, 破付费墙利器',
        example: 'curl "https://api.unpaywall.org/v2/10.1038/nature12373?email=test@test.com"',
        lang: 'en',
      },
      {
        name: "Anna's Archive",
        url: 'https://annas-archive.org/search?q={q}',
        accessMethod: 'scrape',
        why: '聚合Sci-Hub+LibGen+Z-Lib, 4200万+书籍9800万+论文, 免费全文下载, 无需登录',
        lang: 'multi',
      },
    ],
  },

  // ────────────────────────────────────────
  // 编程 & 开发
  // ────────────────────────────────────────
  {
    domain: 'programming',
    label: '编程开发',
    keywords: ['代码', 'code', 'programming', '编程', 'bug', 'error', 'api', 'library', '框架', 'framework', 'npm', 'pip', 'github', 'stackoverflow', 'React', 'Vue', 'Angular', 'Python', 'TypeScript', 'JavaScript', 'hook', 'hooks', '组件', 'component', '优化', 'optimization', 'Node', 'Rust', 'Go', 'Java'],
    sources: [
      {
        name: 'GitHub Search API',
        url: 'https://api.github.com/search/code?q={q}',
        accessMethod: 'api',
        why: '无需key可搜(速率限制10次/分钟), 搜索真实代码/仓库/issue',
        example: 'curl "https://api.github.com/search/repositories?q=search+agent+language:typescript&sort=stars"',
        lang: 'en',
      },
      {
        name: 'Hacker News Algolia API',
        url: 'https://hn.algolia.com/api/v1/search?query={q}',
        accessMethod: 'api',
        why: '完全免费无key, 技术社区最高质量讨论, 按分数/时间排序',
        example: 'curl "https://hn.algolia.com/api/v1/search?query=agentic+search&tags=story"',
        lang: 'en',
      },
      {
        name: 'npm Registry API',
        url: 'https://registry.npmjs.org/-/v1/search?text={q}&size=10',
        accessMethod: 'api',
        why: '完全免费无key, 搜索JS/TS包, 含下载量/维护分/质量分',
        example: 'curl "https://registry.npmjs.org/-/v1/search?text=search+agent&size=5"',
        lang: 'en',
      },
      {
        name: 'Libraries.io API',
        url: 'https://libraries.io/api/search?q={q}',
        accessMethod: 'api',
        why: '免费key(注册即得), 跨平台包搜索(npm/pip/gem/maven等), 依赖分析',
        example: 'curl "https://libraries.io/api/search?q=search+engine&platforms=npm"',
        lang: 'en',
      },
      {
        name: 'StackExchange API',
        url: 'https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=votes&q={q}&site=stackoverflow',
        accessMethod: 'api',
        why: '无需key(有速率限制), StackOverflow问答搜索, 按投票排序',
        example: 'curl "https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=votes&q=web+scraping&site=stackoverflow"',
        lang: 'en',
      },
      {
        name: 'ArchWiki',
        url: 'https://wiki.archlinux.org/api.php?action=opensearch&search={q}&limit=10&format=json',
        accessMethod: 'api',
        why: 'Linux/系统管理最权威Wiki, MediaWiki API免费, 社区志愿者维护, 内容极深极全',
        example: 'curl "https://wiki.archlinux.org/api.php?action=opensearch&search=docker&limit=5&format=json"',
        lang: 'en',
      },
      {
        name: 'Gentoo Wiki',
        url: 'https://wiki.gentoo.org/api.php?action=opensearch&search={q}&limit=10&format=json',
        accessMethod: 'api',
        why: '深入的Linux/编译优化文档, MediaWiki API免费, 社区维护',
        lang: 'en',
      },
      {
        name: 'DevDocs',
        url: 'https://devdocs.io/search?q={q}',
        accessMethod: 'scrape',
        why: '聚合400+技术文档(MDN/Python/React/Node等), 无需登录, 内容干净',
        lang: 'en',
      },
    ],
  },

  // ────────────────────────────────────────
  // AI & 机器学习
  // ────────────────────────────────────────
  {
    domain: 'ai_ml',
    label: 'AI/机器学习',
    keywords: ['AI', 'machine learning', '机器学习', 'deep learning', '深度学习', 'model', '模型', 'LLM', 'GPT', 'transformer', 'neural', 'huggingface', 'Claude', 'ChatGPT', 'DeepSeek', '大模型', '训练', 'training', '推理', 'inference', '注意力机制', 'attention', '微调', 'fine-tune', '向量', 'embedding'],
    sources: [
      {
        name: 'Hugging Face API',
        url: 'https://huggingface.co/api/models?search={q}&sort=downloads&direction=-1&limit=10',
        accessMethod: 'api',
        why: '完全免费无key, 搜索模型/数据集/Space, AI领域的GitHub',
        example: 'curl "https://huggingface.co/api/models?search=text+generation&sort=downloads&direction=-1&limit=5"',
        lang: 'en',
      },
      {
        name: 'Papers With Code API',
        url: 'https://paperswithcode.com/api/v1/search/?q={q}',
        accessMethod: 'api',
        why: '免费无key, 论文+代码+SOTA排行榜一体',
        example: 'curl "https://paperswithcode.com/api/v1/papers/?q=attention+mechanism"',
        lang: 'en',
      },
      {
        name: 'arXiv cs.AI',
        url: 'http://export.arxiv.org/api/query?search_query=cat:cs.AI+AND+{q}&max_results=10',
        accessMethod: 'api',
        why: '限定AI分类的arXiv搜索, 最新研究比正式发表快3-6个月',
        lang: 'en',
      },
    ],
  },

  // ────────────────────────────────────────
  // 网络安全
  // ────────────────────────────────────────
  {
    domain: 'cybersecurity',
    label: '网络安全',
    keywords: ['CVE', '漏洞', 'vulnerability', 'exploit', 'malware', '安全', 'security', 'hack', '渗透', 'pentest', 'ransomware', 'Log4j', 'XSS', 'SQL注入', 'injection', 'RCE', 'payload', 'PoC', 'zero-day', '0day'],
    sources: [
      {
        name: 'CVEDB (Shodan)',
        url: 'https://cvedb.shodan.io/cves?product={q}',
        accessMethod: 'api',
        why: '完全免费无需账号无需key, 每日更新, 按产品/CVE/CPE查询, JSON返回',
        example: 'curl "https://cvedb.shodan.io/cve/CVE-2021-44228"',
        lang: 'en',
      },
      {
        name: 'NVD API 2.0',
        url: 'https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch={q}',
        accessMethod: 'api',
        why: '美国国家漏洞数据库, 免费无key(有速率限制), JSON返回, 权威CVSS评分',
        example: 'curl "https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=log4j"',
        lang: 'en',
      },
      {
        name: 'Exploit-DB',
        url: 'https://www.exploit-db.com/search?q={q}',
        accessMethod: 'scrape',
        why: '无需登录, PoC漏洞利用代码, Offensive Security维护',
        lang: 'en',
      },
      {
        name: 'OSV.dev API',
        url: 'https://api.osv.dev/v1/query',
        accessMethod: 'api',
        why: '完全免费无key, Google维护, 开源软件漏洞数据库, POST JSON查询',
        example: 'curl -X POST "https://api.osv.dev/v1/query" -d \'{"package":{"name":"log4j","ecosystem":"Maven"}}\'',
        lang: 'en',
      },
      {
        name: 'InternetDB (Shodan)',
        url: 'https://internetdb.shodan.io/{ip}',
        accessMethod: 'api',
        why: '完全免费无key, 输入IP返回开放端口/漏洞/服务, 超快',
        example: 'curl "https://internetdb.shodan.io/8.8.8.8"',
        lang: 'en',
      },
    ],
  },

  // ────────────────────────────────────────
  // 影视 & 娱乐资源
  // ────────────────────────────────────────
  {
    domain: 'media',
    label: '影视娱乐',
    keywords: ['电影', 'movie', '电视剧', 'TV', '纪录片', 'documentary', '综艺', '动漫', 'anime', '下载', 'download', '磁力', 'magnet', '资源', '片源', '排片', '排期', '影院', '节目', '频道', 'CCTV', '央视', '视频', 'video', '游戏', 'game', 'Dota', 'LOL', '英雄联盟', 'CSGO', 'CS2', '原神', 'Genshin', '王者荣耀', 'Steam', '更新', 'patch', '版本', '英雄', 'hero', '改动', '平衡', '身世', '角色', 'character', '暗黑', 'Diablo', '魔兽', 'Warcraft', '最终幻想', 'Final Fantasy', '塞尔达', 'Zelda', '宝可梦', 'Pokemon', '艾尔登法环', 'Elden Ring', '巫师', 'Witcher', 'NPC', '剧情', 'lore', '设定', '世界观', '背景故事'],
    sources: [
      {
        name: 'Fandom Wiki',
        url: 'https://www.fandom.com/?s={q}',
        accessMethod: 'scrape',
        why: '全球最大游戏/动漫/影视Wiki平台(前Wikia), 角色背景/剧情/设定极其详细, 无需登录',
        lang: 'multi',
      },
      {
        name: 'TV Tropes',
        url: 'https://tvtropes.org/pmwiki/search_result.php?q={q}',
        accessMethod: 'scrape',
        why: '影视/文学/游戏叙事模式百科, 社区志愿者维护, 内容极深, 无需登录',
        lang: 'en',
      },
      {
        name: 'PCGamingWiki',
        url: 'https://www.pcgamingwiki.com/w/index.php?search={q}',
        accessMethod: 'scrape',
        why: 'PC游戏修复/设置/兼容性百科, 社区驱动, MediaWiki API可用, 无需登录',
        lang: 'en',
      },
      {
        name: 'MobyGames',
        url: 'https://www.mobygames.com/search/?q={q}',
        accessMethod: 'scrape',
        why: '全球最全游戏数据库(1999年建立), 含平台/评分/截图/制作人员, 无需登录',
        lang: 'en',
      },
      {
        name: 'IGDB',
        url: 'https://www.igdb.com/search?q={q}',
        accessMethod: 'scrape',
        why: 'Twitch旗下游戏数据库, 涵盖游戏/平台/公司/角色, 社区贡献, 无需登录',
        lang: 'en',
      },
      {
        name: 'MyAnimeList',
        url: 'https://myanimelist.net/search/all?q={q}',
        accessMethod: 'scrape',
        why: '全球最大动漫数据库, 含评分/评论/角色/声优/制作团队, 社区贡献, 无需登录搜索',
        lang: 'en',
      },
      {
        name: 'AniList',
        url: 'https://anilist.co/search/anime?search={q}',
        accessMethod: 'scrape',
        why: '现代化动漫/漫画数据库, GraphQL API免费, 社区维护, 无需登录',
        lang: 'en',
      },
      {
        name: 'BTDigg',
        url: 'https://btdig.com/search?q={q}',
        accessMethod: 'scrape',
        why: '你朋友的秘密武器! 磁力搜索引擎, 无需登录, 资源最全, DHT网络抓取',
        lang: 'en',
      },
      {
        name: '1337x',
        url: 'https://1337x.to/search/{q}/1/',
        accessMethod: 'scrape',
        why: '无需登录, 影视/音频/软件种子, 社区活跃, 有评论和质量标识',
        lang: 'en',
      },
      {
        name: 'TorrentGalaxy',
        url: 'https://torrentgalaxy.to/torrents.php?search={q}',
        accessMethod: 'scrape',
        why: '无需登录, IMDB评分集成, 有截图预览, 支持磁力直链',
        lang: 'en',
      },
      {
        name: 'Knaben Torrent Aggregator',
        url: 'https://knaben.eu/search?q={q}',
        accessMethod: 'scrape',
        why: '种子聚合搜索引擎, 搜几十个源, 无需登录',
        lang: 'en',
      },
      {
        name: 'YTS/YIFY API',
        url: 'https://yts.mx/api/v2/list_movies.json?query_term={q}',
        accessMethod: 'api',
        why: '完全免费JSON API无需key, 高清电影小体积, 含磁力链和海报',
        example: 'curl "https://yts.mx/api/v2/list_movies.json?query_term=oppenheimer"',
        lang: 'en',
      },
      {
        name: 'Nyaa.si',
        url: 'https://nyaa.si/?q={q}',
        accessMethod: 'scrape',
        why: '动漫/日剧/日语资源最全, 无需登录, 有RSS',
        lang: 'en',
      },
      {
        name: 'TMDb API',
        url: 'https://api.themoviedb.org/3/search/movie?query={q}',
        accessMethod: 'api',
        why: '免费key(注册即得), 电影/剧集元数据, 海报, 评分, 多语言',
        lang: 'multi',
      },
      {
        name: 'OMDb API',
        url: 'https://www.omdbapi.com/?s={q}&apikey=free',
        accessMethod: 'api',
        why: '免费key(1000次/天), IMDb数据的JSON接口',
        lang: 'en',
      },
      {
        name: '17173游戏网',
        url: 'https://www.17173.com/search?q={q}',
        accessMethod: 'scrape',
        why: '中文最大游戏资讯站之一, 游戏攻略/补丁/英雄改动, 无需登录',
        lang: 'zh',
      },
      {
        name: 'DotA中文维基 (灰机)',
        url: 'https://dota2.huijiwiki.com/wiki/{q}',
        accessMethod: 'scrape',
        why: 'Dota2中文维基, 英雄/物品/更新日志详细数据, 无需登录',
        lang: 'zh',
      },
      {
        name: 'Liquipedia Dota2',
        url: 'https://liquipedia.net/dota2/{q}',
        accessMethod: 'scrape',
        why: '电竞百科, Dota/LOL/CS赛事和游戏数据, 无需登录',
        lang: 'en',
      },
      {
        name: 'Dota2 Wiki (Fandom)',
        url: 'https://dota2.fandom.com/wiki/{q}',
        accessMethod: 'scrape',
        why: '英文Dota2维基, 最全英雄/技能/补丁数据, 无需登录',
        lang: 'en',
      },
    ],
  },

  // ────────────────────────────────────────
  // 电子书 & 文档
  // ────────────────────────────────────────
  {
    domain: 'books',
    label: '电子书/文档',
    keywords: ['书', 'book', 'ebook', '教材', 'textbook', 'PDF', '电子书', '小说', 'novel', '手册', 'manual', '文档', 'documentation', 'read', '阅读', 'works', 'author', '作者', 'chapter', 'download'],
    sources: [
      {
        name: "Anna's Archive",
        url: 'https://annas-archive.org/search?q={q}',
        accessMethod: 'scrape',
        why: '聚合Sci-Hub+LibGen+Z-Lib+DuXiu, 4200万+书籍, 无需登录, 直接下载',
        lang: 'multi',
      },
      {
        name: 'Library Genesis',
        url: 'https://libgen.rs/search.php?req={q}',
        accessMethod: 'scrape',
        why: '学术书籍/教材最全, 无需登录, 多镜像站',
        lang: 'multi',
      },
      {
        name: 'Open Library API',
        url: 'https://openlibrary.org/search.json?q={q}&limit=10',
        accessMethod: 'api',
        why: '完全免费无key, Internet Archive的图书项目, 含借阅功能',
        example: 'curl "https://openlibrary.org/search.json?q=deep+learning&limit=5"',
        lang: 'en',
      },
      {
        name: 'Gutenberg API',
        url: 'https://gutendex.com/books/?search={q}',
        accessMethod: 'api',
        why: '完全免费无key, 7万+公版书全文, 含EPUB/TXT',
        example: 'curl "https://gutendex.com/books/?search=shakespeare"',
        lang: 'en',
      },
    ],
  },

  // ────────────────────────────────────────
  // 音乐
  // ────────────────────────────────────────
  {
    domain: 'music',
    label: '音乐',
    keywords: ['音乐', 'music', '歌曲', 'song', '专辑', 'album', '歌手', 'singer', '乐队', 'band', '演唱会', 'concert', '歌词', 'lyrics', '曲风', 'genre', '作曲', 'composer', '乐器', 'instrument', '吉他', 'guitar', '钢琴', 'piano'],
    sources: [
      {
        name: 'MusicBrainz API',
        url: 'https://musicbrainz.org/ws/2/artist/?query={q}&fmt=json&limit=10',
        accessMethod: 'api',
        why: '完全免费无key, 开放音乐百科, 公共领域数据, 艺术家/专辑/曲目/厂牌全覆盖',
        example: 'curl "https://musicbrainz.org/ws/2/artist/?query=radiohead&fmt=json&limit=5" -H "User-Agent: AgenticSearch/1.0"',
        lang: 'multi',
      },
      {
        name: 'Discogs API',
        url: 'https://api.discogs.com/database/search?q={q}&type=release',
        accessMethod: 'api',
        why: '免费(注册即得key), 全球最大唱片数据库, 社区贡献, 含版本/发行信息',
        lang: 'multi',
      },
      {
        name: 'Genius Lyrics',
        url: 'https://genius.com/search?q={q}',
        accessMethod: 'scrape',
        why: '歌词+社区注释, 最大的歌词注释平台, 无需登录搜索',
        lang: 'multi',
      },
    ],
  },

  // ────────────────────────────────────────
  // 电子工程 & 硬件
  // ────────────────────────────────────────
  {
    domain: 'electronics',
    label: '电子硬件',
    keywords: ['电路', 'circuit', 'PCB', '元器件', 'component', '芯片', 'chip', 'IC', 'datasheet', '数据手册', 'Arduino', 'FPGA', 'MCU', 'STM32'],
    sources: [
      {
        name: 'Datasheet Archive',
        url: 'https://www.datasheetarchive.com/search?q={q}',
        accessMethod: 'scrape',
        why: '5亿+数据手册, 无需登录, 搜索后直接下载PDF',
        lang: 'en',
      },
      {
        name: 'LCEDA/OSHWHub',
        url: 'https://oshwhub.com/search?q={q}',
        accessMethod: 'scrape',
        why: '立创开源硬件平台, 无需登录搜索, 含原理图/PCB/BOM',
        lang: 'zh',
      },
      {
        name: 'Octopart API',
        url: 'https://octopart.com/api/v4/search?q={q}',
        accessMethod: 'scrape',
        why: '元器件搜索聚合, 跨分销商比价, 无需登录查看结果',
        lang: 'en',
      },
      {
        name: 'WikiChip',
        url: 'https://en.wikichip.org/w/index.php?search={q}',
        accessMethod: 'scrape',
        why: '半导体/处理器架构百科, 社区驱动, 芯片工艺/微架构极其详细, 无需登录',
        lang: 'en',
      },
      {
        name: 'iFixit',
        url: 'https://www.ifixit.com/Search?query={q}',
        accessMethod: 'scrape',
        why: '设备拆解/维修百科, 13万+免费维修指南, 社区志愿者贡献, 无需登录',
        lang: 'multi',
      },
    ],
  },

  // ────────────────────────────────────────
  // 数据 & 统计
  // ────────────────────────────────────────
  {
    domain: 'data_stats',
    label: '数据统计',
    keywords: ['数据', 'data', '统计', 'statistics', '人口', 'population', 'GDP', '经济', 'economy', '指标', 'indicator'],
    sources: [
      {
        name: 'World Bank API',
        url: 'https://api.worldbank.org/v2/country/all/indicator/{indicator}?format=json&per_page=50',
        accessMethod: 'api',
        why: '完全免费无key, 全球发展指标, JSON返回, 覆盖200+国家',
        example: 'curl "https://api.worldbank.org/v2/country/CN/indicator/NY.GDP.PCAP.CD?format=json&per_page=5"',
        lang: 'en',
      },
      {
        name: 'REST Countries',
        url: 'https://restcountries.com/v3.1/name/{q}',
        accessMethod: 'api',
        why: '完全免费无key, 国家基础数据(人口/面积/语言/货币等)',
        example: 'curl "https://restcountries.com/v3.1/name/china"',
        lang: 'en',
      },
      {
        name: 'Data.gov CKAN API',
        url: 'https://catalog.data.gov/api/3/action/package_search?q={q}',
        accessMethod: 'api',
        why: '完全免费无key, 美国政府54万+数据集元数据搜索',
        example: 'curl "https://catalog.data.gov/api/3/action/package_search?q=education"',
        lang: 'en',
      },
    ],
  },

  // ────────────────────────────────────────
  // 天气
  // ────────────────────────────────────────
  {
    domain: 'weather',
    label: '天气',
    keywords: ['天气', 'weather', '气温', 'temperature', '预报', 'forecast', '降雨', 'rain', '下雨', '台风', 'typhoon', '暴雨', '晴天', '多云', '雾霾', 'AQI', '空气质量', '紫外线', 'UV', '穿什么', '带伞', '明天天气', '今天天气', '这周天气'],
    sources: [
      {
        name: 'Open-Meteo Weather API',
        url: 'https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&hourly=temperature_2m',
        accessMethod: 'api',
        why: '完全免费无key, 天气预报+80年历史数据, 全球覆盖, 1.5km分辨率',
        example: 'curl "https://api.open-meteo.com/v1/forecast?latitude=39.9&longitude=116.4&hourly=temperature_2m"',
        lang: 'en',
      },
      {
        name: 'wttr.in',
        url: 'https://wttr.in/{q}?format=j1',
        accessMethod: 'api',
        why: '完全免费无key, 支持城市名直接查询, JSON返回, 3天预报+天文数据',
        example: 'curl "https://wttr.in/Beijing?format=j1"',
        lang: 'multi',
      },
      {
        name: 'Open-Meteo Air Quality',
        url: 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude={lat}&longitude={lon}&hourly=pm2_5,pm10,us_aqi',
        accessMethod: 'api',
        why: '完全免费无key, PM2.5/PM10/AQI空气质量预报, 全球覆盖',
        lang: 'en',
      },
      {
        name: 'Open-Meteo Geocoding',
        url: 'https://geocoding-api.open-meteo.com/v1/search?name={q}&count=5&language=zh',
        accessMethod: 'api',
        why: '完全免费无key, 城市名→经纬度转换, 配合天气API使用',
        example: 'curl "https://geocoding-api.open-meteo.com/v1/search?name=北京&count=3&language=zh"',
        lang: 'multi',
      },
    ],
  },

  // ────────────────────────────────────────
  // 金融 & 股票 (可直接访问的)
  // ────────────────────────────────────────
  {
    domain: 'finance',
    label: '金融商业',
    keywords: ['股票', 'stock', '股价', '财报', 'financial', '市场', 'market', '投资', 'invest', 'SEC', '上市公司', 'IPO', '融资', 'crypto', '加密货币', 'Bitcoin', 'BTC', 'ETH', '比特币', '以太坊', '价格', 'price', '基金', 'fund', '行情', '涨跌', 'A股', '港股', '美股', '市值', '估值', '金山办公', '小米集团', '腾讯控股', '阿里巴巴', '百度集团', '比亚迪', '宁德时代', '茅台', '中国平安', '招商银行', '工商银行', '京东', '美团', '网易', '营收', '净利润', '毛利率', '市盈率', '季报', '年报', '汇率', 'exchange rate', '外汇', 'forex', '金价', 'gold price', '银价', 'silver', '黄金', '白银', '铂金', 'platinum', '大宗商品', 'commodity', '期货', 'futures', '铜价', 'copper', '大宗交易', 'block trade', '贵金属', 'precious metal'],
    sources: [
      {
        name: 'SEC EDGAR Full-Text Search',
        url: 'https://efts.sec.gov/LATEST/search-index?q={q}&dateRange=custom&startdt=2024-01-01',
        accessMethod: 'api',
        why: '完全免费无key, 美国上市公司财报/公告全文搜索, JSON返回',
        example: 'curl "https://efts.sec.gov/LATEST/search-index?q=artificial+intelligence&dateRange=custom&startdt=2024-01-01"',
        lang: 'en',
      },
      {
        name: 'Yahoo Finance Chart API',
        url: 'https://query1.finance.yahoo.com/v8/finance/chart/{q}',
        accessMethod: 'api',
        why: '无需key, 全球股票/ETF/指数/商品实时+历史行情, 黄金=GC=F, 原油=CL=F',
        example: 'curl "https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1d&range=1mo" -H "User-Agent: Mozilla/5.0"',
        lang: 'en',
      },
      {
        name: 'Minted Metal (Gold/Silver Price)',
        url: 'https://api.mintedmetal.com/v1/spot-prices',
        accessMethod: 'api',
        why: '完全免费无key无速率限制, LBMA基准金银铂钯铑价格, 每日两次更新, CC BY 4.0',
        example: 'curl "https://api.mintedmetal.com/v1/spot-prices"',
        lang: 'en',
      },
      {
        name: 'Metal Sentinel',
        url: 'https://api.metal-sentinel.com/v1/quotes',
        accessMethod: 'api',
        why: '免费15000次/月, 实时贵金属报价(Kitco数据源), 10+金属+90+加密+180+法币',
        lang: 'en',
      },
      {
        name: 'CoinGecko API',
        url: 'https://api.coingecko.com/api/v3/search?query={q}',
        accessMethod: 'api',
        why: '免费无key, 加密货币搜索/行情/历史价格, 1万+币种',
        example: 'curl "https://api.coingecko.com/api/v3/search?query=bitcoin"',
        lang: 'en',
      },
      {
        name: 'ExchangeRate API',
        url: 'https://open.er-api.com/v6/latest/{q}',
        accessMethod: 'api',
        why: '完全免费无key, 实时汇率, 支持150+货币, 每日更新',
        example: 'curl "https://open.er-api.com/v6/latest/USD"',
        lang: 'en',
      },
      {
        name: 'OpenFIGI API',
        url: 'https://api.openfigi.com/v3/search',
        accessMethod: 'api',
        why: '免费无key(250次/分钟), 金融工具标识搜索(股票/债券/期货), POST JSON',
        example: 'curl -X POST "https://api.openfigi.com/v3/search" -H "Content-Type: application/json" -d \'{"query":"AAPL"}\'',
        lang: 'en',
      },
    ],
  },

  // ────────────────────────────────────────
  // 油价 & 能源
  // ────────────────────────────────────────
  {
    domain: 'oil_energy',
    label: '油价能源',
    keywords: ['油价', 'oil price', '汽油', 'gasoline', '柴油', 'diesel', '加油', '92号', '95号', '98号', '原油', 'crude oil', 'WTI', 'Brent', '布伦特', 'OPEC', '天然气', 'natural gas', '电价', '能源', 'energy', '煤价', '煤炭'],
    sources: [
      {
        name: 'Oil Price API (Demo)',
        url: 'https://api.oilpriceapi.com/v1/prices/latest',
        accessMethod: 'api',
        why: '免费demo端点无需key, WTI/Brent/柴油/汽油实时价格, 5分钟更新',
        lang: 'en',
      },
      {
        name: 'CoinGecko (Energy Commodities)',
        url: 'https://api.coingecko.com/api/v3/simple/price?ids=crude-oil&vs_currencies=usd',
        accessMethod: 'api',
        why: '免费无key, 大宗商品价格追踪',
        lang: 'en',
      },
    ],
  },

  // ────────────────────────────────────────
  // 星座 & 占卜
  // ────────────────────────────────────────
  {
    domain: 'horoscope',
    label: '星座运势',
    keywords: ['星座', 'zodiac', '运势', 'horoscope', '白羊', '金牛', '双子', '巨蟹', '狮子', '处女', '天秤', '天蝎', '射手', '摩羯', '水瓶', '双鱼', 'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces', '今日运势', '本周运势', '本月运势', '塔罗', 'tarot', '占卜', '星盘', '上升星座', '月亮星座', '水逆', 'Mercury retrograde'],
    sources: [
      {
        name: 'Free Horoscope API',
        url: 'https://horoscope-app-api.vercel.app/api/v1/get-horoscope/daily?sign={q}',
        accessMethod: 'api',
        why: '完全免费无key, 每日/每周/每月星座运势, JSON返回, 12星座全覆盖',
        example: 'curl "https://horoscope-app-api.vercel.app/api/v1/get-horoscope/daily?sign=aries"',
        lang: 'en',
      },
      {
        name: 'Ohmanda Horoscope API',
        url: 'https://ohmanda.com/api/horoscope/{q}',
        accessMethod: 'api',
        why: '完全免费无key, Astrology.com数据源, 每日星座运势, 极简API',
        example: 'curl "https://ohmanda.com/api/horoscope/leo"',
        lang: 'en',
      },
      {
        name: 'FreeAstroAPI',
        url: 'https://freeastroapi.com/api/natal-chart',
        accessMethod: 'api',
        why: '免费80次/天, 星盘计算/行星位置/宫位/相位, 支持西方和吠陀占星',
        lang: 'en',
      },
    ],
  },

  // ────────────────────────────────────────
  // 命理 & 风水
  // ────────────────────────────────────────
  {
    domain: 'fortune',
    label: '命理风水',
    keywords: ['命理', '八字', 'bazi', '风水', 'feng shui', '五行', 'five elements', '生辰', '算命', '起名', '取名', '黄历', '黄道吉日', '吉凶', '属相', '生肖', '紫微斗数', '奇门遁甲', '易经', 'I Ching', '周易', '阴阳', '太极', '面相', '手相', '姓名学', '运势', '流年', '大运'],
    sources: [
      {
        name: '天机爻 Bazi API',
        url: 'https://api.tianjiyao.com/v1/bazi',
        accessMethod: 'api',
        why: '免费100次/分钟, 八字排盘+AI解读+紫微斗数, RESTful JSON, 中文优化',
        lang: 'zh',
      },
      {
        name: 'FreeAstroAPI Bazi',
        url: 'https://freeastroapi.com/api/bazi',
        accessMethod: 'api',
        why: '免费80次/天, 八字四柱+五行分析+神煞+大运流年, 真太阳时计算',
        lang: 'en',
      },
      {
        name: '万年历/黄历查询',
        url: 'https://www.36jxs.com/',
        accessMethod: 'scrape',
        why: '万年历/黄历/吉日查询, 无需登录, 社区维护',
        lang: 'zh',
      },
    ],
  },

  // ────────────────────────────────────────
  // 专利
  // ────────────────────────────────────────
  {
    domain: 'patent',
    label: '专利检索',
    keywords: ['专利', 'patent', '发明', 'invention', '实用新型', 'utility model', 'prior art', '现有技术'],
    sources: [
      {
        name: 'EPO Open Patent Services',
        url: 'https://ops.epo.org/3.2/rest-services/published-data/search?q={q}',
        accessMethod: 'api',
        why: '免费(匿名有速率限制), 欧洲专利局API, 全球专利检索',
        lang: 'multi',
      },
      {
        name: 'The Lens API',
        url: 'https://api.lens.org/patent/search',
        accessMethod: 'api',
        why: '免费tier(注册即得), 专利+学术交叉检索, 引用网络',
        lang: 'en',
      },
      {
        name: 'Google Patents (scrape)',
        url: 'https://patents.google.com/?q={q}',
        accessMethod: 'scrape',
        why: '无需登录, 全球专利搜索, 支持语义搜索, Google质量',
        lang: 'multi',
      },
    ],
  },

  // ────────────────────────────────────────
  // 法律 (可直接访问的)
  // ────────────────────────────────────────
  {
    domain: 'legal',
    label: '法律法规',
    keywords: [
      '法律', 'law', '法规', 'regulation', '判例', 'case law', '合同', 'contract',
      '诉讼', 'lawsuit', '法院', '仲裁', 'arbitration', '条例', '规章',
      '海关', 'customs', '关税', 'tariff', '原产地', '进出口', '贸易壁垒',
      '知识产权', 'patent', '商标', 'trademark', '著作权', 'copyright',
      '刑法', '民法', '行政法', '劳动法', '公司法', '合规', 'compliance',
      '反垄断', 'antitrust', '证券法', '税法', '税务', '反倾销', '反补贴',
      'RCEP', 'WTO', 'USMCA', '自贸协定', 'FTA',
    ],
    sources: [
      {
        name: 'CourtListener API',
        url: 'https://www.courtlistener.com/api/rest/v4/search/?q={q}&type=o',
        accessMethod: 'api',
        why: '完全免费无key, 美国法院判例全文搜索, 含口头辩论录音',
        example: 'curl "https://www.courtlistener.com/api/rest/v4/search/?q=artificial+intelligence&type=o"',
        lang: 'en',
      },
      {
        name: 'EUR-Lex (scrape)',
        url: 'https://eur-lex.europa.eu/search.html?lang=en&text={q}',
        accessMethod: 'scrape',
        why: '无需登录, 欧盟法律法规全文, 24种语言',
        lang: 'multi',
      },
      {
        name: '国家法律法规数据库',
        url: 'https://flk.npc.gov.cn/fl/search?kw={q}',
        accessMethod: 'scrape',
        why: '全国人大官方法律数据库，收录宪法/法律/行政法规/地方法规',
        lang: 'zh',
      },
      {
        name: '中国裁判文书网',
        url: 'https://wenshu.court.gov.cn/',
        accessMethod: 'scrape',
        why: '最高法院官方判例数据库，包含各级法院裁判文书',
        lang: 'zh',
      },
      {
        name: '海关总署政策法规',
        url: 'http://www.customs.gov.cn/customs/302249/302266/index.html',
        accessMethod: 'scrape',
        why: '海关总署规章/公告/通知，关税/原产地/进出口管理',
        lang: 'zh',
      },
      {
        name: '商务部经贸政策',
        url: 'http://www.mofcom.gov.cn/',
        accessMethod: 'scrape',
        why: '商务部贸易政策/反倾销/反补贴/贸易救济公告',
        lang: 'zh',
      },
    ],
  },

  // ────────────────────────────────────────
  // 医学 (可直接访问的)
  // ────────────────────────────────────────
  {
    domain: 'medical',
    label: '医学健康',
    keywords: ['医学', 'medical', 'drug', '药物', 'clinical', '临床', 'disease', '疾病', 'protein', '蛋白质', 'gene', '基因', 'FDA', '免疫', 'immune', '治疗', 'therapy', 'cancer', '肿瘤', 'PD-1', 'PD-L1'],
    sources: [
      {
        name: 'PubMed E-utilities',
        url: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&term={q}',
        accessMethod: 'api',
        why: '完全免费无key, 3600万+生物医学文献, JSON返回, 含全文链接',
        example: 'curl "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&term=immunotherapy&retmax=5"',
        lang: 'en',
      },
      {
        name: 'ClinicalTrials.gov API',
        url: 'https://clinicaltrials.gov/api/v2/studies?query.term={q}&pageSize=10',
        accessMethod: 'api',
        why: '完全免费无key, 全球临床试验数据, JSON返回',
        example: 'curl "https://clinicaltrials.gov/api/v2/studies?query.term=cancer&pageSize=5"',
        lang: 'en',
      },
      {
        name: 'OpenFDA API',
        url: 'https://api.fda.gov/drug/event.json?search={q}&limit=10',
        accessMethod: 'api',
        why: '完全免费无key, FDA药物不良反应/标签/召回数据',
        example: 'curl "https://api.fda.gov/drug/label.json?search=aspirin&limit=3"',
        lang: 'en',
      },
    ],
  },

  // ────────────────────────────────────────
  // 通用知识 (Wikipedia等)
  // ────────────────────────────────────────
  {
    domain: 'knowledge',
    label: '通用知识',
    keywords: ['什么是', 'what is', '定义', 'definition', '解释', 'explain', '百科', 'wiki', '概念', 'concept', '科普', '量子', 'quantum', '原理', 'principle', '历史', 'history', '身世', '来历', '简介', '介绍', '是谁', '怎么回事', '朋友', '关系', '结局', '命运'],
    sources: [
      {
        name: 'Wikipedia API',
        url: 'https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch={q}&format=json',
        accessMethod: 'api',
        why: '完全免费无key, 多语言百科, JSON返回, 含摘要提取',
        example: 'curl "https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=quantum+computing&format=json"',
        lang: 'multi',
      },
      {
        name: 'Wikidata API',
        url: 'https://www.wikidata.org/w/api.php?action=wbsearchentities&search={q}&language=en&format=json',
        accessMethod: 'api',
        why: '完全免费无key, 结构化知识图谱, 实体关系查询',
        example: 'curl "https://www.wikidata.org/w/api.php?action=wbsearchentities&search=Albert+Einstein&language=en&format=json"',
        lang: 'multi',
      },
      {
        name: 'DuckDuckGo Instant Answer',
        url: 'https://api.duckduckgo.com/?q={q}&format=json&no_html=1',
        accessMethod: 'api',
        why: '完全免费无key, 即时回答/摘要/相关话题, 零追踪',
        example: 'curl "https://api.duckduckgo.com/?q=python+programming&format=json&no_html=1"',
        lang: 'en',
      },
      {
        name: 'TV Tropes',
        url: 'https://tvtropes.org/pmwiki/search_result.php?q={q}',
        accessMethod: 'scrape',
        why: '影视/文学/游戏叙事手法百科, 社区驱动, 无需登录, 内容极深',
        lang: 'en',
      },
    ],
  },

  // ────────────────────────────────────────
  // OSINT & 情报
  // ────────────────────────────────────────
  {
    domain: 'osint',
    label: '开源情报',
    keywords: ['OSINT', '情报', 'intelligence', '调查', 'investigation', '追踪', 'tracking', '溯源', 'whois', 'IP', '域名', 'domain'],
    sources: [
      {
        name: 'InternetDB (Shodan)',
        url: 'https://internetdb.shodan.io/{ip}',
        accessMethod: 'api',
        why: '完全免费无key, IP→开放端口/漏洞/服务, 秒级响应',
        lang: 'en',
      },
      {
        name: 'CVEDB (Shodan)',
        url: 'https://cvedb.shodan.io/cves?product={q}',
        accessMethod: 'api',
        why: '完全免费无key, 漏洞搜索, 每日更新',
        lang: 'en',
      },
      {
        name: 'RDAP (ARIN)',
        url: 'https://rdap.arin.net/registry/ip/{ip}',
        accessMethod: 'api',
        why: '完全免费无key, WHOIS替代协议, IP归属查询, JSON返回',
        lang: 'en',
      },
      {
        name: 'crt.sh (Certificate Transparency)',
        url: 'https://crt.sh/?q={q}&output=json',
        accessMethod: 'api',
        why: '完全免费无key, SSL证书透明度日志搜索, 发现子域名利器',
        example: 'curl "https://crt.sh/?q=%.example.com&output=json"',
        lang: 'en',
      },
      {
        name: 'URLScan.io API',
        url: 'https://urlscan.io/api/v1/search/?q=domain:{q}',
        accessMethod: 'api',
        why: '免费无key搜索(提交需key), 网站安全扫描结果, 截图+DOM+请求链',
        example: 'curl "https://urlscan.io/api/v1/search/?q=domain:example.com"',
        lang: 'en',
      },
    ],
  },

  // ────────────────────────────────────────
  // 产品说明书 & 用户手册
  // ────────────────────────────────────────
  {
    domain: 'manuals',
    label: '产品说明书',
    keywords: ['说明书', 'manual', '用户手册', 'user guide', '使用说明', 'instruction', '操作指南', 'operation guide', '规格', 'specification', 'spec sheet', '产品手册', 'product manual', '安装', 'installation', '维修手册', 'service manual', '型号', 'model number'],
    sources: [
      {
        name: 'ManualsLib',
        url: 'https://www.manualslib.com/search/{q}',
        accessMethod: 'scrape',
        why: '970万+PDF手册, 14万+品牌, 无需登录即可在线阅读, 全球最大说明书数据库',
        lang: 'multi',
      },
      {
        name: 'Manualzz',
        url: 'https://manualzz.com/search?q={q}',
        accessMethod: 'scrape',
        why: '1000万+用户手册, AI问答功能, 无需登录搜索和阅读',
        lang: 'multi',
      },
      {
        name: 'NHTSA Vehicle API',
        url: 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/{q}?format=json',
        accessMethod: 'api',
        why: '完全免费无key, 美国交通安全局车辆VIN解码/规格数据, JSON返回',
        example: 'curl "https://vpic.nhtsa.dot.gov/api/vehicles/getallmakes?format=json"',
        lang: 'en',
      },
    ],
  },

  // ────────────────────────────────────────
  // 图片搜索
  // ────────────────────────────────────────
  {
    domain: 'images',
    label: '图片搜索',
    keywords: ['图片', 'image', '照片', 'photo', '壁纸', 'wallpaper', '素材', 'stock photo', '插图', 'illustration', '图标', 'icon', '矢量', 'vector', 'SVG', 'PNG', '高清', 'HD', '4K', '搜图', '找图', '配图', '头像', 'avatar', '背景图'],
    sources: [
      {
        name: 'Wikimedia Commons API',
        url: 'https://commons.wikimedia.org/w/api.php?action=query&list=search&srnamespace=6&srsearch={q}&format=json',
        accessMethod: 'api',
        why: '完全免费无key, 1亿+自由授权媒体文件, 维基百科图片来源',
        example: 'curl "https://commons.wikimedia.org/w/api.php?action=query&list=search&srnamespace=6&srsearch=cat&format=json&srlimit=5"',
        lang: 'multi',
      },
      {
        name: 'Openverse API',
        url: 'https://api.openverse.org/v1/images/?q={q}&page_size=10',
        accessMethod: 'api',
        why: '完全免费无key, WordPress基金会维护, 8亿+CC授权图片聚合搜索',
        example: 'curl "https://api.openverse.org/v1/images/?q=sunset&page_size=5"',
        lang: 'multi',
      },
      {
        name: 'Lorem Picsum',
        url: 'https://picsum.photos/v2/list?page=1&limit=30',
        accessMethod: 'api',
        why: '完全免费无key, 高质量随机图片, Unsplash来源, 支持自定义尺寸',
        lang: 'en',
      },
    ],
  },

  // ────────────────────────────────────────
  // 食物 & 食谱 & 营养
  // ────────────────────────────────────────
  {
    domain: 'food',
    label: '食物食谱',
    keywords: ['食谱', 'recipe', '做法', '烹饪', 'cooking', '菜谱', '怎么做', '怎么炒', '营养', 'nutrition', '卡路里', 'calorie', '配料', 'ingredient', '食材', '成分', '添加剂', 'additive', '减肥', 'diet', '健康饮食'],
    sources: [
      {
        name: 'Open Food Facts API',
        url: 'https://world.openfoodfacts.org/cgi/search.pl?search_terms={q}&json=1&page_size=10',
        accessMethod: 'api',
        why: '完全免费无key, 170万+食品数据, 成分/营养/添加剂/过敏原, 社区贡献',
        example: 'curl "https://world.openfoodfacts.org/cgi/search.pl?search_terms=nutella&json=1&page_size=5"',
        lang: 'multi',
      },
      {
        name: 'TheMealDB API',
        url: 'https://www.themealdb.com/api/json/v1/1/search.php?s={q}',
        accessMethod: 'api',
        why: '完全免费无key, 菜谱搜索含步骤/配料/视频, JSON返回',
        example: 'curl "https://www.themealdb.com/api/json/v1/1/search.php?s=chicken"',
        lang: 'en',
      },
      {
        name: 'Wikibooks Cookbook',
        url: 'https://en.wikibooks.org/w/api.php?action=opensearch&search=Cookbook:{q}&limit=10&format=json',
        accessMethod: 'api',
        why: '完全免费无key, 维基教科书食谱, 社区维护, MediaWiki API',
        lang: 'multi',
      },
    ],
  },

  // ────────────────────────────────────────
  // 旅行 & 地理
  // ────────────────────────────────────────
  {
    domain: 'travel',
    label: '旅行地理',
    keywords: ['旅行', 'travel', '旅游', 'tourism', '攻略', 'guide', '景点', 'attraction', '酒店', 'hotel', '机票', 'flight', '签证', 'visa', '地图', 'map', '地址', 'address', '经纬度', 'coordinate', '城市', 'city', '国家', 'country'],
    sources: [
      {
        name: 'Wikivoyage API',
        url: 'https://en.wikivoyage.org/w/api.php?action=opensearch&search={q}&limit=10&format=json',
        accessMethod: 'api',
        why: '完全免费无key, 维基旅行指南, 34000+目的地, 社区维护, 无广告',
        example: 'curl "https://en.wikivoyage.org/w/api.php?action=opensearch&search=Tokyo&limit=5&format=json"',
        lang: 'multi',
      },
      {
        name: 'Nominatim (OpenStreetMap)',
        url: 'https://nominatim.openstreetmap.org/search?q={q}&format=json&limit=5',
        accessMethod: 'api',
        why: '完全免费无key, 地理编码/逆编码, 地址搜索, 全球覆盖',
        example: 'curl "https://nominatim.openstreetmap.org/search?q=Tokyo+Tower&format=json&limit=3"',
        lang: 'multi',
      },
      {
        name: 'GeoNames API',
        url: 'https://api.geonames.org/searchJSON?q={q}&maxRows=10&username=demo',
        accessMethod: 'api',
        why: '免费(注册即得), 1200万+地名数据库, 含行政区划/邮编/海拔',
        lang: 'multi',
      },
    ],
  },

  // ────────────────────────────────────────
  // 语言 & 词典
  // ────────────────────────────────────────
  {
    domain: 'language',
    label: '语言词典',
    keywords: ['词典', 'dictionary', '翻译', 'translate', '定义', 'definition', '词义', 'meaning', '发音', 'pronunciation', '语法', 'grammar', '近义词', 'synonym', '反义词', 'antonym', '词源', 'etymology', '俚语', 'slang', '成语', 'idiom', '怎么读', '什么意思'],
    sources: [
      {
        name: 'Free Dictionary API',
        url: 'https://api.dictionaryapi.dev/api/v2/entries/en/{q}',
        accessMethod: 'api',
        why: '完全免费无key, 定义/发音/近义词/例句, 多语言支持',
        example: 'curl "https://api.dictionaryapi.dev/api/v2/entries/en/serendipity"',
        lang: 'multi',
      },
      {
        name: 'Urban Dictionary API',
        url: 'https://unofficialurbandictionaryapi.com/api/search?term={q}',
        accessMethod: 'api',
        why: '完全免费无key无速率限制, 网络俚语/流行语解释, 社区投票',
        example: 'curl "https://unofficialurbandictionaryapi.com/api/search?term=GOAT"',
        lang: 'en',
      },
      {
        name: 'Wiktionary API',
        url: 'https://en.wiktionary.org/w/api.php?action=opensearch&search={q}&limit=10&format=json',
        accessMethod: 'api',
        why: '完全免费无key, 维基词典, 词源/发音/翻译, 社区维护, 多语言',
        lang: 'multi',
      },
    ],
  },

  // ────────────────────────────────────────
  // 3D模型 & DIY制作
  // ────────────────────────────────────────
  {
    domain: 'maker',
    label: '3D打印/DIY',
    keywords: ['3D打印', '3D print', 'STL', '模型', '3D model', 'DIY', '制作', 'make', '教程', 'tutorial', 'how to', '怎么做', '手工', 'craft', 'Arduino', '树莓派', 'Raspberry Pi', 'maker', '创客'],
    sources: [
      {
        name: 'Printables',
        url: 'https://www.printables.com/search/models?q={q}',
        accessMethod: 'scrape',
        why: 'Prusa旗下3D模型库, CC授权, 无需登录搜索, 社区活跃',
        lang: 'en',
      },
      {
        name: 'Thangs',
        url: 'https://thangs.com/search/{q}',
        accessMethod: 'scrape',
        why: '3D模型聚合搜索引擎, 跨平台搜索, 无需登录, AI几何搜索',
        lang: 'en',
      },
      {
        name: 'Instructables',
        url: 'https://www.instructables.com/search/?q={q}',
        accessMethod: 'scrape',
        why: 'DIY教程最大社区, 社区贡献, 步骤图详细, 无需登录浏览',
        lang: 'en',
      },
      {
        name: 'WikiHow',
        url: 'https://www.wikihow.com/wikiHowTo?search={q}',
        accessMethod: 'scrape',
        why: '全球最大How-to百科, 24万+图文教程, 社区编辑, 无需登录',
        lang: 'multi',
      },
    ],
  },

  // ────────────────────────────────────────
  // 汽车 & 车辆
  // ────────────────────────────────────────
  {
    domain: 'automotive',
    label: '汽车车辆',
    keywords: ['汽车', 'car', '车型', 'vehicle', '轿车', 'SUV', '发动机', 'engine', '油耗', 'mpg', '马力', 'horsepower', '变速箱', 'transmission', '新能源', 'EV', '电动车', '特斯拉', 'Tesla', '比亚迪', 'BYD', '丰田', 'Toyota', '宝马', 'BMW', '奔驰', 'Mercedes', '大众', 'Volkswagen', '车评', 'review', '试驾', 'test drive'],
    sources: [
      {
        name: 'NHTSA Vehicle API',
        url: 'https://vpic.nhtsa.dot.gov/api/vehicles/getmodelsformake/{q}?format=json',
        accessMethod: 'api',
        why: '完全免费无key, 美国交通安全局, 车辆规格/VIN解码/召回信息, JSON',
        example: 'curl "https://vpic.nhtsa.dot.gov/api/vehicles/getmodelsformake/Toyota?format=json"',
        lang: 'en',
      },
      {
        name: 'NHTSA Recalls API',
        url: 'https://api.nhtsa.gov/recalls/recallsByVehicle?make={q}&modelYear=2024',
        accessMethod: 'api',
        why: '完全免费无key, 车辆召回信息查询, JSON返回',
        lang: 'en',
      },
    ],
  },

  // ────────────────────────────────────────
  // 钓鱼
  // ────────────────────────────────────────
  {
    domain: 'fishing',
    label: '钓鱼',
    keywords: ['钓鱼', 'fishing', '钓', '鱼竿', '饵料', 'bait', '路亚', 'lure', '台钓', '海钓', '矶钓', '淡水', '鲈鱼', 'bass', '鲤鱼', 'carp', '鲫鱼', '鲶鱼', 'catfish', '鳟鱼', 'trout', '三文鱼', 'salmon', '钓点', '鱼情', '渔获', '浮漂', '钩', '线组', '打窝', '调漂', '黑坑', '野钓'],
    sources: [
      {
        name: 'FishDatabase API',
        url: 'https://api.fishdatabase.com/v1/species?search={q}',
        accessMethod: 'api',
        why: '免费5000次/月, 1200+鱼类品种数据, 栖息地/分布/图片, 社区贡献',
        lang: 'en',
      },
      {
        name: 'AnglerFinder',
        url: 'https://anglerfinder.com/search?q={q}',
        accessMethod: 'scrape',
        why: '12.3万+钓点, 64+鱼类物种, 季节性钓鱼报告, 无需登录',
        lang: 'en',
      },
      {
        name: 'FishBase (全球鱼类数据库)',
        url: 'https://www.fishbase.se/search.php?q={q}',
        accessMethod: 'scrape',
        why: '全球最大鱼类数据库, 3.5万+物种, 学术级数据, 无需登录',
        lang: 'multi',
      },
      {
        name: 'iNaturalist (鱼类观察)',
        url: 'https://api.inaturalist.org/v1/observations?taxon_name={q}&iconic_taxa=Actinopterygii&per_page=10',
        accessMethod: 'api',
        why: '免费无key读取, 全球鱼类观察记录+照片, 社区鉴定, 含地理位置',
        lang: 'multi',
      },
    ],
  },

  // ────────────────────────────────────────
  // 花鸟鱼虫 & 宠物 & 自然
  // ────────────────────────────────────────
  {
    domain: 'nature_pets',
    label: '花鸟鱼虫',
    keywords: ['花', 'flower', '鸟', 'bird', '虫', 'insect', '鱼', 'fish', '宠物', 'pet', '猫', 'cat', '狗', 'dog', '植物', 'plant', '多肉', 'succulent', '兰花', 'orchid', '盆栽', 'bonsai', '养花', '养鱼', '观赏鱼', '锦鲤', 'koi', '金鱼', 'goldfish', '热带鱼', '水族', 'aquarium', '鹦鹉', 'parrot', '画眉', '百灵', '蟋蟀', '蝈蝈', '蜥蜴', 'lizard', '龟', 'turtle', '仓鼠', 'hamster', '兔子', 'rabbit', '品种', 'breed', '喂养', 'feeding', '繁殖', 'breeding', '鉴赏', '树', 'tree', '草', 'grass'],
    sources: [
      {
        name: 'iNaturalist API',
        url: 'https://api.inaturalist.org/v1/taxa?q={q}&per_page=10',
        accessMethod: 'api',
        why: '免费无key读取, 全球最大自然观察社区, 50万+物种, 照片+分布+分类',
        example: 'curl "https://api.inaturalist.org/v1/taxa?q=orchid&per_page=5"',
        lang: 'multi',
      },
      {
        name: 'Trefle 植物API',
        url: 'https://trefle.io/api/v1/plants/search?q={q}',
        accessMethod: 'api',
        why: '免费开源, 100万+植物, 生长条件/温度/光照/土壤数据, JSON返回',
        lang: 'en',
      },
      {
        name: 'The Aquarium Wiki',
        url: 'https://www.theaquariumwiki.org/wiki/Special:Search?search={q}',
        accessMethod: 'scrape',
        why: '水族百科, 2600+文章, 淡水/海水/汽水鱼种+水草+疾病, 社区维护, 无需登录',
        lang: 'en',
      },
      {
        name: 'Wikispecies',
        url: 'https://species.wikimedia.org/w/api.php?action=opensearch&search={q}&limit=10&format=json',
        accessMethod: 'api',
        why: '完全免费无key, 维基物种目录, 94万+物种分类, 动植物学名查询',
        lang: 'multi',
      },
      {
        name: 'Xeno-Canto (鸟鸣声)',
        url: 'https://xeno-canto.org/api/2/recordings?query={q}',
        accessMethod: 'api',
        why: '完全免费无key, 全球鸟鸣声录音数据库, 1万+鸟种, 社区上传, JSON返回',
        example: 'curl "https://xeno-canto.org/api/2/recordings?query=Parus+major"',
        lang: 'multi',
      },
      {
        name: 'eBird API',
        url: 'https://api.ebird.org/v2/data/obs/geo/recent?lat={lat}&lng={lon}',
        accessMethod: 'api',
        why: '免费key(注册即得), 康奈尔鸟类实验室, 全球鸟类观察数据, 含热点/稀有鸟种',
        lang: 'en',
      },
    ],
  },

  // ────────────────────────────────────────
  // 大宗商品 & 农产品
  // ────────────────────────────────────────
  {
    domain: 'commodity',
    label: '大宗商品',
    keywords: ['大宗商品', 'commodity', '期货', 'futures', '小麦', 'wheat', '玉米', 'corn', '大豆', 'soybean', '棉花', 'cotton', '糖', 'sugar', '咖啡', 'coffee', '橡胶', 'rubber', '铁矿石', 'iron ore', '螺纹钢', '铝', 'aluminum', '锌', 'zinc', '镍', 'nickel', '锡', 'tin', '农产品', 'agricultural', '粮食', 'grain', '猪肉', 'pork', '鸡蛋', '现货', 'spot', '交割', 'delivery'],
    sources: [
      {
        name: 'Yahoo Finance Commodity',
        url: 'https://query1.finance.yahoo.com/v8/finance/chart/{q}',
        accessMethod: 'api',
        why: '无需key, 大宗商品期货行情(GC=F黄金/SI=F白银/CL=F原油/ZW=F小麦/ZC=F玉米)',
        example: 'curl "https://query1.finance.yahoo.com/v8/finance/chart/ZW=F?interval=1d&range=3mo" -H "User-Agent: Mozilla/5.0"',
        lang: 'en',
      },
      {
        name: 'Commodity Fundamentals (USDA)',
        url: 'https://api.commodityfundamentals.com/v1/commodities?search={q}',
        accessMethod: 'api',
        why: '免费1000次/天, 美国农业部粮食数据(产量/种植面积/供需), 追溯至1960年代',
        lang: 'en',
      },
      {
        name: 'World Bank Commodity API',
        url: 'https://api.worldbank.org/v2/country/all/indicator/CM.MKT.INDX.ZG?format=json',
        accessMethod: 'api',
        why: '完全免费无key, 全球大宗商品价格指数, 覆盖能源/金属/农产品, 历史数据',
        lang: 'en',
      },
    ],
  },
];
