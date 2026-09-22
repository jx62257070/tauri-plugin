/**
 * 插件 dsh-mainline（股票主线）· 全部常量
 *
 * 口径参考本地技能 `a-share-huddle-mainline`（A 股板块抱团主线四阶段判定）：
 * 把「抱团主线」从主观感觉变成可复现的状态规则 —— 数据源换成**应用内可直连的接口**：
 * - 板块清单与板块日 K（含成交额）：**同花顺为主源**（`q.10jqka.com.cn` / `d.10jqka.com.cn`，GBK 编码）；
 * - 兜底源：**东方财富**（`push2his` 板块日 K + `push2delay` 板块快照）——
 *   实测（2026-09-18）东财行情域可用但是**突发限速**（间隔 ≥1s 正常、连发即拒连），
 *   故只作「同花顺整体不可用」时的整表降级，见 `MAINLINE_SOURCE` 与 L2.5 说明；
 * - 沪深两市总成交额：复用宿主既有 `fetchMarketTurnover`（腾讯日 K，含真实成交额，与板块源无关）。
 */

/** 插件 id */
export const MAINLINE_PLUGIN_ID = 'dsh-mainline';

/** 左侧导航路径（菜单贡献点带 component 时自动注册该路由） */
export const MAINLINE_MENU_PATH = '/mainline';

/** 左侧导航标题 */
export const MAINLINE_MENU_TITLE = '股票主线';

/** 菜单图标（MenuIcon 的 key） */
export const MAINLINE_MENU_ICON = 'flame';

// ---------- 数据源 ----------

/** 同花顺行业板块清单页（GBK HTML，链接里带 `detail/code/881121/` 形式的板块代码） */
export const THS_BOARD_LIST_URL = 'https://q.10jqka.com.cn/thshy/';

/**
 * 清单页分页地址基址（ajax 形态，只返回表格行）
 *
 * 实测：首页表格每页只给 **50 行**（90 个行业板块要两页），第 2 页返回剩余 40 行，
 * 两页并集与首页页脚导航里的 90 个代码**完全一致**（探针 `.ai/tmp/mainline-probe9.mjs`）。
 */
export const THS_BOARD_LIST_PAGE_URL_BASE =
  'https://q.10jqka.com.cn/thshy/index/field/199112/order/desc/page/';

/** 分页地址尾段（`<page>` 与 `/ajax/1/` 之间插页码） */
export const THS_BOARD_LIST_PAGE_URL_SUFFIX = '/ajax/1/';

/** 从第几页开始翻（首页已由清单页本身取到） */
export const THS_BOARD_LIST_NEXT_PAGE = 2;

/** 最多翻到第几页（护栏：防止上游改版导致无限翻页） */
export const THS_BOARD_LIST_MAX_PAGES = 4;

/**
 * 同花顺板块日 K 基址（年文件）
 *
 * 完整形态 `${base}${boardCode}/01/${year}.js`，如
 * `https://d.10jqka.com.cn/v6/line/48_881121/01/2026.js`；
 * 返回 JSONP `quotebridge_v6_line_48_881121_01_2026({"data":"日期,开,高,低,收,量,额,...;..."})`
 */
export const THS_BOARD_KLINE_URL_BASE = 'https://d.10jqka.com.cn/v6/line/48_';

/** 同花顺板块年 K 的路径分段符（`…/48_<code>/<复权>/<year>.js`） */
export const THS_BOARD_KLINE_URL_MIDDLE = '/';

/** 同花顺板块年 K 的路径中段（`…/<code>/<复权>/<year>.js`）：主用前复权 */
export const THS_BOARD_KLINE_ADJUST_PRIMARY = '01';

/**
 * 同花顺复权口径回退值（`00` = 不复权）
 *
 * 实测：部分板块的 `01` 年文件被上游网关拒绝（502），而 `00` 正常；也有反过来
 * 只有 `01` 可用的板块。板块点位本身不做复权处理也不影响成交额口径，
 * 因此按「主用 → 回退」逐个尝试，首个有数据的胜出。
 */
export const THS_BOARD_KLINE_ADJUST_FALLBACK = '00';

/** 复权与年份都取不到时，向前回退的年数（去年文件兜底） */
export const THS_BOARD_KLINE_YEAR_FALLBACK = 1;

/**
 * 同花顺板块日 K 的「近端文件」段名（`…/<复权>/last.js`）
 *
 * 实测（2026-09-18）该文件是**同源同口径**的第二份数据：约 140 个交易日（≈半年）、
 * 字段序与年 K 完全一致（`日期,开,高,低,收,量,额`），且与年 K 的重叠日期**数值逐日相同**
 * （对比 881121：140 天重叠、0 天不一致）→ 可直接与年 K 序列按日期合并。
 *
 * 关键价值：502 是**按文件**发生的（年文件由冷缓存节点生成），实测 5 个「年文件 502」的板块
 * 其 `01/last.js` 全部 200 → 把它放进回退链能救回绝大部分整板失败，且不引入跨源口径差。
 */
export const THS_BOARD_KLINE_FILE_LAST = 'last';

/**
 * 同一候选 URL 对 5xx 网关错误的尝试次数（含首次）
 *
 * 实测（2026-09-18）：`d.10jqka.com.cn` 的 openresty 网关会**瞬时 502** ——
 * 同一代码 `01/2026` 连续 502，而同代码的 `00/2026` 立即 200，稍后重试部分自愈；
 * 一次 90 板块的扫描曾因此 14 个整板失败（四个候选 URL 恰好全撞上）。
 * 对 5xx 在原 URL 上小步重试一次，仍在频率红线内（间隔 ≥ `MAINLINE_SCAN_DELAY_MS`）。
 */
export const THS_BOARD_KLINE_URL_ATTEMPTS = 2;

/** 5xx 起始状态码（含）—— 视为可重试的网关瞬时错误 */
export const THS_HTTP_SERVER_ERROR_MIN = 500;

/** 同花顺要求带 Referer，否则可能被拒 */
export const THS_REFERER = 'https://q.10jqka.com.cn/';

/** 同花顺板块清单里板块代码的前缀（88xxxx 为行业板块；概念板块不在本期范围） */
export const THS_INDUSTRY_CODE_PREFIX = '88';

// ---------- 数据源与兜底（L2.5） ----------

/**
 * 板块数据源取值
 *
 * 一次扫描**整表只有一个来源（绝不混排）**：同花顺优先，只在「同花顺整体不可用」时
 * 整表切东财。两个来源的日线序列在库里**分开存放**（行键带来源），同花顺恢复后自动切回，
 * 切换期间的东财数据不会污染同花顺累积的分位序列。
 */
export const MAINLINE_SOURCE = {
  /** 同花顺行业板块（主源：清单页 + 板块年 K / 近端 K） */
  THS: 'ths',
  /** 东方财富行业板块（兜底源：板块日 K + 板块快照，按名称映射到同花顺板块） */
  EM: 'em',
} as const;

/** 数据源取值类型 */
export type MainlineSource = (typeof MAINLINE_SOURCE)[keyof typeof MAINLINE_SOURCE];

/** 数据源中文名（界面徽标用） */
export const MAINLINE_SOURCE_LABEL = {
  ths: '同花顺',
  em: '东方财富',
} as const satisfies Record<MainlineSource, string>;

/** 数据源徽标样式（兜底源用主色提示「口径已变」，让用户一眼看见） */
export const MAINLINE_SOURCE_BADGE_CLASS = {
  ths: 'bg-flat-weak text-text-secondary',
  em: 'bg-primary-weak text-primary',
} as const satisfies Record<MainlineSource, string>;

/**
 * 板块清单（代码 + 名称）的来源
 *
 * 清单页 `q.10jqka.com.cn` 与日线主机 `d.10jqka.com.cn` 是两个域，可能单独故障 ——
 * 清单页挂掉但日线正常时，用缓存清单继续取**同花顺**日线（仍是同源同口径，不切源），
 * 只是当日结构快照（宽度 / 净流入）取不到；连缓存都没有才用内置兜底清单。
 */
export const MAINLINE_REFS_SOURCE = {
  /** 清单页现取（正常路径） */
  LIVE: 'live',
  /** 上次成功扫描时落库的清单（清单页故障时的首选） */
  CACHE: 'cache',
  /** 内置兜底清单（`MAINLINE_THS_BOARD_FALLBACK`，首次扫描就撞上清单页故障时用） */
  STATIC: 'static',
  /** 东财自带板块清单（东财模式下不再依赖同花顺清单） */
  EM: 'em',
} as const;

/** 板块清单来源取值类型 */
export type MainlineRefsSource = (typeof MAINLINE_REFS_SOURCE)[keyof typeof MAINLINE_REFS_SOURCE];

/** 板块清单来源中文名 */
export const MAINLINE_REFS_SOURCE_LABEL = {
  live: '清单页现取',
  cache: '本地缓存清单',
  static: '内置兜底清单',
  em: '东财板块清单',
} as const satisfies Record<MainlineRefsSource, string>;

/** 触发整表切换数据源的原因（落库为键，界面按此取文案） */
export const MAINLINE_FALLBACK_REASON = {
  /** 同花顺全部板块日线取数失败 → 判定同花顺整体不可用 */
  KLINE_ALL_FAILED: 'kline_all_failed',
} as const;

/**
 * 切换原因文案
 *
 * 只保留**可复现的判定依据**（不写「可能 / 大概」）：整表切换的唯一触发条件是
 * 同花顺清单解析出的**全部**板块日线都取不到 —— 单板块失败仍走同源回退链与本地旧数据。
 */
export const MAINLINE_FALLBACK_REASON_LABEL = {
  kline_all_failed: '同花顺全部板块日线取数失败，判定为同花顺整体不可用',
} as const satisfies Record<
  (typeof MAINLINE_FALLBACK_REASON)[keyof typeof MAINLINE_FALLBACK_REASON],
  string
>;

/** 东财要求带 Referer，否则可能被拒 */
export const EM_REFERER = 'https://quote.eastmoney.com/';

/** 东财行业板块清单（一次给出涨跌幅 / 成交额 / 主力净流入 / 涨跌家数 / 领涨股） */
export const EM_BOARD_LIST_URL = 'https://push2delay.eastmoney.com/api/qt/clist/get';

/** 东财板块日 K */
export const EM_BOARD_KLINE_URL = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';

/** 东财板块 secid 前缀（`90.` = 板块；`0./1.` 是个股与指数） */
export const EM_BOARD_SECID_PREFIX = '90.';

/**
 * 东财清单的排序字段 / 方向（**必须是稳定字段，见下方血的教训**）
 *
 * ⚠️ 实测坑（2026-09-18）：`fid=f3&po=1`（按**涨跌幅**降序）—— 分页是「逐页串行请求」，
 * 而 f3 在盘中每秒都在变，翻到第 5 页时前几页的行序已经漂移 → **行在页边界来回搬家**
 * → 实测 `data.total` 报 496，但 6 页去重后只有 491 行、且出现 5 个重复，
 * **5 个板块被静默丢掉**（丢的恰是「化学纤维 / 非金属材料 / 生物制品」，表现为
 * 「未映射」名单每次跑都不一样）。改用代码升序（`f12`）后实测 496 行 / 0 重复 / 与 total 一致。
 *
 * → 排序字段必须选**不随时间变化**的（代码、名称），绝不能选行情字段。
 */
export const EM_BOARD_LIST_SORT_FIELD = 'f12';

/** 排序方向（0 = 升序；配合代码字段即稳定序） */
export const EM_BOARD_LIST_SORT_ORDER = '0';

/**
 * 东财行业板块清单的查询串（`{page}` 由调用方替换）
 *
 * `fs=m:90+t:2` = 行业板块（含一/二/三级混合，实测共 496 个）——
 * 我们**不用它当板块全集**，只用它做「同花顺板块名 → 东财板块代码」的映射表。
 */
export const EM_BOARD_LIST_QUERY =
  `pn={page}&pz=100&po=${EM_BOARD_LIST_SORT_ORDER}&np=1&fltt=2&invt=2` +
  `&fid=${EM_BOARD_LIST_SORT_FIELD}&fs=m:90+t:2` +
  '&fields=f12,f14,f3,f6,f62,f104,f105,f128';

/** 清单查询串里页码的占位符（由取数层替换为实际页码） */
export const EM_BOARD_LIST_PAGE_TOKEN = '{page}';

/** 东财日 K 的元信息字段（f1 代码 / f2 名称 / f3 市场，必填但不用其值） */
export const EM_KLINE_META_FIELDS = 'f1,f2,f3';

/** 东财板块清单最多翻页数（实测 496 个 / 每页 100 → 5 页足够，留 1 页护栏） */
export const EM_BOARD_LIST_MAX_PAGES = 6;

/** 清单行里各字段的键（避免在解析层写裸字符串） */
export const EM_BOARD_FIELD = {
  CODE: 'f12',
  NAME: 'f14',
  CHANGE_PERCENT: 'f3',
  AMOUNT: 'f6',
  NET_INFLOW: 'f62',
  RISE: 'f104',
  FALL: 'f105',
  LEADER: 'f128',
} as const;

/** 日 K 要取的字段（f51~f57 = 日期 / 开 / 收 / 高 / 低 / 量 / 额；实测返回顺序即此） */
export const EM_KLINE_FIELDS = 'f51,f52,f53,f54,f55,f56,f57';

/** 日 K 周期（101 = 日线） */
export const EM_KLINE_KLT = '101';

/** 日 K 复权（1 = 前复权，与同花顺主用口径一致） */
export const EM_KLINE_ADJUST = '1';

/** 日 K 结束日期（给足够大的值即取到最新） */
export const EM_KLINE_END = '20500101';

/** 日 K 起始年份向前推的年数（1 → 取到去年初，约 370 个交易日，够算 60 日分位与 5/20 日量能） */
export const EM_KLINE_YEARS_BACK = 1;

/** 东财兜底模式的同上游间隔（毫秒）
 *
 * 实测（2026-09-18）：东财行情域是**突发限速** —— 间隔 ≥1s 时板块日 K 与板块快照都正常返回，
 * 短时间连发立刻拒连（curl 退出码 000）、停顿约 20s 后恢复。故兜底轮必须**串行**且留足间隔。
 */
export const EM_SCAN_DELAY_MS = 1200;

/** 东财兜底的并发（恒为 1：突发限速下并发会直接触发拒连） */
export const EM_SCAN_CONCURRENCY = 1;

/**
 * 东财单次请求的尝试次数（含首次）
 *
 * 实测（2026-09-18）：东财会**直接掐断连接**而不是回 HTTP 错误码
 * （`UND_ERR_SOCKET` / curl 退出码 000，约 0.2s 返回，8 次里成功 1 次），
 * 稍等重试即可恢复 → 与同花顺 5xx 一样做原地重试，只是间隔更长。
 */
export const EM_FETCH_ATTEMPTS = 3;

/** 东财兜底的失败补采间隔（毫秒；比同花顺更长，给限速留恢复时间） */
export const EM_SCAN_RETRY_DELAY_MS = 5000;

/**
 * 板块清单收不满（与上游 `total` 对账不足）时整轮重跑的轮数
 *
 * 稳定排序后实测应一次到位（496 行 / total 496）；这里只是护栏 —— 真收不满时
 * 宁可多跑一轮，也不能把缺行当成「东财没有同义板块」报给用户。
 */
export const EM_UNIVERSE_ROUNDS = 2;

/**
 * 东财涨停池的行业名 → 同花顺行业板块名（**近似归属**）
 *
 * 涨停池的 `hybk` 用的是东财（≈申万）行业口径，与同花顺行业板块**不是同一套分类**，
 * 且长名会被上游截断到 4 个汉字（`光学光电子` → `光学光电`，由前缀匹配自动兜住）。
 * 下表是**分类口径不同、名称也不同**时的兜底映射，只收录语义等价、可确认的对应关系：
 *
 * - 截断名（光学光电 / 汽车零部 / 计算机设 …）由前缀匹配处理，不在此表；
 * - 两套分类下**无法确认**对应板块的（`文娱用品`、`照明设备`）**故意不收录** ——
 *   宁可让它们落进「未归属」计数并在界面如实展示，也不猜一个板块出去；
 * - 上游分类调整时本表会漂移，故 `scan_meta` 会记录未归属家数，便于发现漂移。
 */
export const MAINLINE_INDUSTRY_ALIAS: Readonly<Record<string, string>> = {
  '工程咨询': '建筑装饰',
  '专业工程': '建筑装饰',
  '装修装饰': '建筑装饰',
  '装修建材': '建筑材料',
  '出版': '文化传媒',
  '广告营销': '文化传媒',
  '一般零售': '零售',
  '炼化及贸': '石油加工贸易',
  '旅游及景': '旅游及酒店',
  '非白酒': '饮料制造',
  '铁路公路': '公路铁路运输',
  '冶钢原料': '钢铁',
  // 2026-09-18 真实涨停池实测补齐（申万二级名 → 同花顺板块）：
  // 航运港口 与 港口航运 属词序颠倒，前后缀匹配都救不了，必须显式别名
  '商用车': '汽车整车',
  '焦炭Ⅱ': '煤炭开采加工',
  '玻璃玻纤': '建筑材料',
  '航运港口': '港口航运',
};

/**
 * 同花顺板块名 → 东财板块名（**兜底模式的名称映射表**）
 *
 * 兜底模式下东财是唯一的板块数据源，所以要把同花顺的 90 个板块名对应到东财板块。
 * 自动匹配只做**同层级语义等价**的两级：等值 → 剥罗马数字后缀（优先「Ⅱ」级，
 * 因为同花顺 90 板块≈申万二级）。下表是语义等价但**名称不同**的 12 个：
 *
 * - 词序颠倒：`公路铁路运输` ↔ `铁路公路`、`港口航运` ↔ `航运港口`、`机场航运` ↔ `航空机场`
 * - 申万改名 / 纯后缀差：`煤炭开采加工` → `煤炭开采`、`石油加工贸易` → `炼化及贸易`、
 *   `油气开采及服务` → `油气开采`、`汽车服务及其他` → `汽车服务`、`文化传媒` → `传媒`、
 *   `塑料制品` → `塑料`、`橡胶制品` → `橡胶`、`食品加工制造` → `食品加工`、
 *   `种植业与林业` → `种植业`
 *
 * **故意不收录**的 7 个（宁可让它们落进「未映射」并在页头如实列出，也不硬凑）：
 * - `汽车整车`：东财只有一级 `汽车`（含零部件/服务），而零部件已单独映射到 `汽车零部件`
 *   → 硬映射会把零部件重复计入整车；
 * - `零售`（东财拆成一般零售 / 商贸零售 / 多业态零售）、`旅游及酒店`（拆成旅游及景区 + 酒店餐饮）、
 *   `军工装备`（拆成航天/航空/航海/地面兵装）、`其他社会服务`（东财「社会服务」是一级，还含教育/旅游）
 *   —— 同花顺做过合并，东财没有一一对应的板块；
 * - `化学纤维`（东财只剩三级 `其他化学纤维`）、`饮料制造`（东财为 `饮料乳品`，多出乳品）
 *   —— 成分范围不同，映射会给出偏小/偏大的成交额。
 */
export const MAINLINE_THS_TO_EM_ALIAS: Readonly<Record<string, string>> = {
  '公路铁路运输': '铁路公路',
  '港口航运': '航运港口',
  '机场航运': '航空机场',
  '煤炭开采加工': '煤炭开采',
  '石油加工贸易': '炼化及贸易',
  '油气开采及服务': '油气开采',
  '汽车服务及其他': '汽车服务',
  '文化传媒': '传媒',
  '塑料制品': '塑料',
  '橡胶制品': '橡胶',
  '食品加工制造': '食品加工',
  '种植业与林业': '种植业',
};

/**
 * 内置兜底板块清单（同花顺 90 个行业板块的快照，2026-09-18 取自清单页）
 *
 * 只在「清单页故障 **且** 本地没有缓存清单」时使用（首次扫描就撞上故障）。
 * 板块代码与名称极少变动；若上游调整分类，靠页头「清单来源：内置兜底清单」提示，
 * 并且下一次清单页正常时缓存会被现取清单覆盖。
 */
export const MAINLINE_THS_BOARD_FALLBACK: readonly { code: string; name: string }[] = [
  { code: '881101', name: '种植业与林业' },
  { code: '881102', name: '养殖业' },
  { code: '881103', name: '农产品加工' },
  { code: '881105', name: '煤炭开采加工' },
  { code: '881107', name: '油气开采及服务' },
  { code: '881108', name: '化学原料' },
  { code: '881109', name: '化学制品' },
  { code: '881112', name: '钢铁' },
  { code: '881114', name: '金属新材料' },
  { code: '881115', name: '建筑材料' },
  { code: '881116', name: '建筑装饰' },
  { code: '881117', name: '通用设备' },
  { code: '881118', name: '专用设备' },
  { code: '881121', name: '半导体' },
  { code: '881122', name: '光学光电子' },
  { code: '881123', name: '其他电子' },
  { code: '881124', name: '消费电子' },
  { code: '881125', name: '汽车整车' },
  { code: '881126', name: '汽车零部件' },
  { code: '881128', name: '汽车服务及其他' },
  { code: '881129', name: '通信设备' },
  { code: '881130', name: '计算机设备' },
  { code: '881131', name: '白色家电' },
  { code: '881132', name: '黑色家电' },
  { code: '881133', name: '饮料制造' },
  { code: '881134', name: '食品加工制造' },
  { code: '881135', name: '纺织制造' },
  { code: '881136', name: '服装家纺' },
  { code: '881137', name: '造纸' },
  { code: '881138', name: '包装印刷' },
  { code: '881139', name: '家居用品' },
  { code: '881140', name: '化学制药' },
  { code: '881141', name: '中药' },
  { code: '881142', name: '生物制品' },
  { code: '881143', name: '医药商业' },
  { code: '881144', name: '医疗器械' },
  { code: '881145', name: '电力' },
  { code: '881146', name: '燃气' },
  { code: '881148', name: '港口航运' },
  { code: '881149', name: '公路铁路运输' },
  { code: '881151', name: '机场航运' },
  { code: '881152', name: '物流' },
  { code: '881153', name: '房地产' },
  { code: '881155', name: '银行' },
  { code: '881156', name: '保险' },
  { code: '881157', name: '证券' },
  { code: '881158', name: '零售' },
  { code: '881159', name: '贸易' },
  { code: '881160', name: '旅游及酒店' },
  { code: '881162', name: '通信服务' },
  { code: '881164', name: '文化传媒' },
  { code: '881165', name: '综合' },
  { code: '881166', name: '军工装备' },
  { code: '881167', name: '非金属材料' },
  { code: '881168', name: '工业金属' },
  { code: '881169', name: '贵金属' },
  { code: '881170', name: '小金属' },
  { code: '881171', name: '自动化设备' },
  { code: '881172', name: '电子化学品' },
  { code: '881173', name: '小家电' },
  { code: '881174', name: '厨卫电器' },
  { code: '881175', name: '医疗服务' },
  { code: '881177', name: '互联网电商' },
  { code: '881178', name: '教育' },
  { code: '881179', name: '其他社会服务' },
  { code: '881180', name: '石油加工贸易' },
  { code: '881181', name: '环境治理' },
  { code: '881182', name: '美容护理' },
  { code: '881263', name: '农化制品' },
  { code: '881264', name: '化学纤维' },
  { code: '881265', name: '塑料制品' },
  { code: '881266', name: '橡胶制品' },
  { code: '881267', name: '能源金属' },
  { code: '881268', name: '工程机械' },
  { code: '881269', name: '轨交设备' },
  { code: '881270', name: '元件' },
  { code: '881271', name: 'IT服务' },
  { code: '881272', name: '软件开发' },
  { code: '881273', name: '白酒' },
  { code: '881274', name: '影视院线' },
  { code: '881275', name: '游戏' },
  { code: '881276', name: '军工电子' },
  { code: '881277', name: '电机' },
  { code: '881278', name: '电网设备' },
  { code: '881279', name: '光伏设备' },
  { code: '881280', name: '风电设备' },
  { code: '881281', name: '电池' },
  { code: '881282', name: '其他电源设备' },
  { code: '881283', name: '多元金融' },
  { code: '881284', name: '环保设备' },
];

/** 东财涨停池类型（主线只取涨停池） */
export const MAINLINE_LIMIT_UP_POOL_TYPE = 'zt';

/** 单次扫描的同上游并发上限（频率红线：不得高于 3） */
export const MAINLINE_SCAN_CONCURRENCY = 3;

/** 同上游连续请求间隔（毫秒，频率红线） */
export const MAINLINE_SCAN_DELAY_MS = 500;

/**
 * 扫描第二轮补采的间隔（毫秒）
 *
 * 502 网关错误呈「突发簇」分布（一轮扫描里集中出现），整轮跑完等一小段时间
 * 再补采失败板块的自愈率显著更高；第二轮轮内同上游间隔也用该值（比首轮更稀疏）。
 */
export const MAINLINE_SCAN_RETRY_DELAY_MS = 2000;

/** 每板块保留的最大历史交易日数（约一年，够算分位又不过度膨胀） */
export const MAINLINE_MAX_HISTORY_DAYS = 260;

/**
 * 基准交易日的覆盖率门槛（0-1）
 *
 * 基准日 = 最近一个「有行情 bar 的板块数 ≥ 全清单 × 本比例」的交易日。
 * 实测依据：完整交易日稳定在 88/90 ≈ 0.978；盘中只有 68/90 ≈ 0.756 且两市成交额只有半日值，
 * 两者不可比（实测同一时点「板块合计 ÷ 两市」= 35.6%，而完整日为 98.5%），故必须整表按同一日截面计算。
 */
export const MAINLINE_BENCHMARK_COVERAGE_RATIO = 0.85;

/**
 * 当日数据「落定」时刻（本地时间，当日 0 点起的分钟数）
 *
 * 收盘 15:00 后上游年 K 与成交额还需落定，取 15:30 作缓冲：早于该时刻扫描时，
 * **当日 bar 一律不写入历史**（半日 bar 一旦落库就会污染占比分位序列，且不会自愈）。
 */
export const MAINLINE_SETTLE_MINUTES = 15 * 60 + 30;

/** 元 → 亿元 的换算基数（展示用） */
export const YUAN_PER_YI = 1e8;

/** 亿元单位文案 */
export const YI_UNIT = '亿';

/** 百分比数值转小数比率时的基数 */
export const PERCENT_BASE = 100;

// ---------- 判定阈值（对应技能 phase-rules 的可自动项） ----------

/** 分位与倍数计算所需的最少历史样本（不足则判「数据不足」） */
export const MAINLINE_MIN_HISTORY_DAYS = 30;

/** 短期量能窗口（交易日）：近 5 日成交额均值 */
export const MAINLINE_SHORT_WINDOW = 5;

/** 中期量能窗口（交易日）：近 20 日成交额均值 */
export const MAINLINE_LONG_WINDOW = 20;

/**
 * 量能倍数分母的滞后长度（交易日）
 *
 * 现行量能倍数 = 近 5 日均额 ÷ 近 20 日均额，**分母含分子** → 比值被近期自身水平拉动，
 * 板块越放量比值越被低估，同一阈值对不同板块不等价（实测同一天半导体 +16.9%、
 * 通信设备 −9.6%、通用设备 +11.8% 的口径差）。故改用「前 20 日（不含最近 5 日）」作分母。
 */
export const MAINLINE_AMOUNT_BASELINE_LAG = 5;

/** 价格分位窗口（交易日） */
export const MAINLINE_PRICE_WINDOW = 60;

/** 狂热期：成交占比历史分位下线（%） */
export const MANIA_MIN_SHARE_PERCENTILE = 90;

/**
 * 狂热期：成交占比的容量门槛（%）—— 占比过小的板块即便分位到 100，
 * 也只是微板块的资金噪声，不称「狂热」（替代技能里没接入的市值容量预过滤）
 */
export const MANIA_MIN_TURNOVER_SHARE = 1;

/** 狂热期：价格分位下线（%）—— 拥挤之外还要求价格处于高位，才叫赔率恶化 */
export const MANIA_MIN_PRICE_PERCENTILE = 70;

/** 狂热期：近 20 日累计涨幅的替代口径（%）—— 价格分位不足时用中期涨幅兜底 */
export const MANIA_MIN_CHANGE20 = 15;

/** 瓦解期：成交占比历史分位下线（%）—— 高位放量下跌 */
export const COLLAPSE_MIN_SHARE_PERCENTILE = 70;

/**
 * 瓦解期：成交占比容量门槛（%）
 *
 * 原值 0.5% 与真实分布不匹配（全板块占比中位数就是 0.55%，等于不过滤），
 * 与狂热期对齐取 1%，让容量真正起「噪声过滤」作用。
 */
export const COLLAPSE_MIN_TURNOVER_SHARE = 1;

/** 瓦解期：价格分位下线（%）—— 「高位」下跌才叫瓦解，低位下跌只是弱 */
export const COLLAPSE_MIN_PRICE_PERCENTILE = 50;

/** 瓦解期：近 5 日累计涨幅上限（%） */
export const COLLAPSE_MAX_CHANGE5 = -5;

/**
 * 确认期：量能倍数下线（滞后口径：近 5 日均额 ÷ 前 20 日均额）
 *
 * 口径从「窗口重叠」改为「滞后」后需要重标：按实测 5 个板块的新旧差异（+5.8% ~ +16.9%）
 * 反推，旧口径 1.2 约等于新口径 1.35。**该阈值属一次性标定，待累积 20+ 个交易日的
 * 结构序列后应用真实分位回测复核**（界面同时展示新旧两套倍数供观察）。
 */
export const CONFIRMED_MIN_AMOUNT_RATIO = 1.35;

/** 确认期：收盘价需站上 60 日高点的比例（0.97 = 距高点 3% 以内） */
export const CONFIRMED_NEAR_HIGH_RATIO = 0.97;

/**
 * 确认期：板块内涨停家数下限
 *
 * 「抱团主线」必须有个股层面的涨停参与 —— 只有价格强、内部无涨停的板块，
 * 更可能是权重股拉抬（假确认）。取 1 是**极宽**的门槛，只否决「完全没有涨停」的极端情形；
 * 更严的结构门槛需回测后再定。
 */
export const CONFIRMED_MIN_LIMIT_UP = 1;

/** 确认期：板块宽度下限（%），涨停家数为 0 时的替代条件（上涨家数占比） */
export const CONFIRMED_MIN_BREADTH_PERCENT = 60;

/** 萌芽期：量能倍数的异常抬升下线（滞后口径）—— 低位放量是萌芽的核心特征 */
export const GERMINATION_MIN_AMOUNT_RATIO = 1.7;

/** 萌芽期：成交占比分位上限（%），超过就不是「低位」了 */
export const GERMINATION_MAX_SHARE_PERCENTILE = 50;

/** 萌芽期：近 5 日累计涨幅上限（%），已经暴涨的不算萌芽 */
export const GERMINATION_MAX_CHANGE5 = 15;

/** 主线候选：成交占比分位下线（%）—— 命中即标「主线候选」 */
export const CANDIDATE_MIN_SHARE_PERCENTILE = 70;

/** 主线候选：量能倍数下线（滞后口径） */
export const CANDIDATE_MIN_AMOUNT_RATIO = 1.7;

// ---------- 结构指标阈值（涨停 / 宽度 / 净流入） ----------

/**
 * 情绪加速：板块内最高连板数下限
 *
 * 3 板是「连板梯队成型」的经验分界（今日实测全市场最高 4 板、2 板及以上 10 家）。
 * 命中只**追加风险提示与展示标记**，不改变阶段判定 —— 只有一天的结构样本不足以定阶段门槛。
 */
export const MANIA_MIN_STREAK = 3;

/** 情绪加速：涨停占比下限（%），连板高度的替代条件 */
export const MANIA_MIN_LIMIT_UP_RATIO = 2;

// ---------- 阶段标签 ----------

/** 四阶段（+ 无 / 数据不足），取值与技能 JSON 的 `phase` 对齐 */
export const MAINLINE_PHASE = {
  /** 萌芽：低位放量，潜在新抱团（多数会证伪，只做观察） */
  GERMINATION: 'germination',
  /** 确认：抱团主线成型 */
  CONFIRMED: 'confirmed_group',
  /** 狂热：筹码拥挤 + 成交占比历史极值，赔率恶化 */
  MANIA: 'mania',
  /** 瓦解：高位放量下跌，景气/筹码松动 */
  COLLAPSE: 'collapse',
  /** 未成主线：无明显抱团特征 */
  NONE: 'none',
  /** 数据不足：历史样本不够，不下结论 */
  UNKNOWN: 'insufficient_data',
} as const;

/** 阶段取值类型 */
export type MainlinePhase = (typeof MAINLINE_PHASE)[keyof typeof MAINLINE_PHASE];

/** 阶段中文标签 */
export const MAINLINE_PHASE_LABEL = {
  germination: '萌芽',
  confirmed_group: '确认',
  mania: '狂热',
  collapse: '瓦解',
  none: '未成主线',
  insufficient_data: '数据不足',
} as const satisfies Record<MainlinePhase, string>;

/**
 * 全部阶段取值（顺序 = 看板徽标的展示顺序，直接取标签表的键序）
 *
 * 单一事实源：新增阶段只往 `MAINLINE_PHASE_LABEL` 加一项即可，徽标与统计自动跟上。
 */
export const MAINLINE_PHASE_LIST = Object.keys(MAINLINE_PHASE_LABEL) as readonly MainlinePhase[];

/** 阶段徽标样式（宿主 token：涨红跌绿，狂热用主色提示风险） */
export const MAINLINE_PHASE_BADGE_CLASS = {
  germination: 'bg-flat-weak text-text-secondary',
  confirmed_group: 'bg-up-weak text-up',
  mania: 'bg-primary-weak text-primary',
  collapse: 'bg-down-weak text-down',
  none: 'bg-flat-weak/60 text-text-tertiary',
  insufficient_data: 'bg-flat-weak/60 text-text-tertiary',
} as const satisfies Record<MainlinePhase, string>;

/** 阶段排序权重（越小越靠前，用于看板默认排序） */
export const MAINLINE_PHASE_ORDER = {
  mania: 0,
  collapse: 1,
  confirmed_group: 2,
  germination: 3,
  none: 4,
  insufficient_data: 5,
} as const satisfies Record<MainlinePhase, number>;

/** 阶段一句话说明（判定结论文案，只讲状态不讲买卖） */
export const MAINLINE_PHASE_DESC = {
  germination:
    '萌芽期：成交占比自低位快速抬升，但拥挤度尚低。潜在新抱团，多数会证伪，仅作观察。',
  confirmed_group:
    '确认期：量能持续放大且价格创阶段新高，抱团主线成型。需连续两季业绩验证方能成立。',
  mania:
    '狂热期：筹码拥挤、成交占比处于历史极值区间，赔率恶化，瓦解风险抬升。',
  collapse:
    '瓦解期：高位放量下跌，筹码开始松动，容易超预期下跌。',
  none: '无明显抱团特征：成交占比与量能均未抬升。',
  insufficient_data: '历史样本不足，不下阶段结论 —— 缺样本不等于状态正常。',
} as const satisfies Record<MainlinePhase, string>;

/** 阶段风险提示（可为空数组；一律为状态语言，不含买卖指令） */
export const MAINLINE_PHASE_WARNINGS = {
  germination: ['萌芽期多数最终证伪，不能作为入场依据，只做观察池跟踪。'],
  confirmed_group: ['确认期需连续两季业绩验证；本期未接入业绩/估值分位数据，判定置信度受限。'],
  mania: [
    '成交占比处于历史极值，拥挤度带来的赔率恶化需要正视。',
    '抱团末期常见「利好钝化」与波动放大，瓦解风险抬升。',
  ],
  collapse: ['高位放量下跌常伴随超预期回撤，注意情绪与流动性的负反馈。'],
  none: [],
  insufficient_data: ['样本天数不足，请继续每日扫描以累积分位序列。'],
} as const satisfies Record<MainlinePhase, readonly string[]>;

// ---------- 界面文案 ----------

/** 页面标题 */
export const MAINLINE_PAGE_TITLE = '股票主线';

/** 页面副标题（说明工具定位与硬约束） */
export const MAINLINE_PAGE_SUBTITLE =
  '板块抱团主线阶段判定：成交占比分位 / 量能倍数 / 价格分位 → 萌芽·确认·狂热·瓦解。辅助研判工具，只输出阶段与风险提示，不含任何买卖或仓位指令。';

/** 扫描按钮文案 */
export const MAINLINE_SCAN_BUTTON = '扫描主线';

/** 扫描中按钮文案前缀 */
export const MAINLINE_SCAN_RUNNING = '扫描中';

/** 扫描进度文案模板（已请求数 / 总数） */
export const MAINLINE_SCAN_PROGRESS_SUFFIX = '个板块';

/** 首次空态文案 */
export const MAINLINE_EMPTY_TEXT =
  '还没有主线快照，点「扫描主线」拉取行业板块与成交额历史（板块数据优先同花顺，整体不可用时自动切东财兜底）';

/** 筛选后无匹配行的空态文案（与「还没扫描」区分开，别让用户以为数据丢了） */
export const MAINLINE_FILTER_EMPTY_TEXT = '当前筛选条件下没有匹配的板块，换个阶段或清除筛选看看';

/** 清除筛选按钮文案 */
export const MAINLINE_FILTER_CLEAR = '清除筛选';

/**
 * 筛选生效时的行数提示模板
 * @param shown 已筛出的行数
 * @param total 全部结论行数
 * @returns 提示文案
 */
export const MAINLINE_FILTER_SUMMARY = (shown: number, total: number): string =>
  `筛选后 ${shown}/${total} 个板块`;

/**
 * 阶段徽标的筛选提示（放在徽标行尾，告知可点）
 *
 * 阶段徽标本身就是筛选开关（多选，再点一次取消），这里只给一句轻提示。
 */
export const MAINLINE_PHASE_FILTER_HINT = '点阶段徽标可多选筛选';

/** 无历史样本提示（表格内） */
export const MAINLINE_NO_SAMPLE_TEXT = '无样本';

/** 指标缺失占位（分位等无法计算时） */
export const MAINLINE_METRIC_PLACEHOLDER = '—';

/** 扫描失败文案前缀 */
export const MAINLINE_SCAN_FAILED = '扫描失败';

/** 表格列标题 */
export const MAINLINE_COLUMN_LABEL = {
  name: '板块',
  phase: '阶段',
  change: '当日',
  change5: '近5日',
  share: '成交占比',
  sharePercentile: '占比分位',
  amountRatio: '量能倍数',
  pricePercentile: '价格分位',
  limitUp: '涨停',
  breadth: '宽度',
  netInflow: '净流入',
} as const;

/** 明细区小标题 */
export const MAINLINE_DETAIL_TITLE = '指标明细';

/** 明细区字段标签 */
export const MAINLINE_DETAIL_LABEL = {
  asOf: '数据截止',
  benchmark: '基准交易日',
  source: '数据源',
  historyDays: '历史样本',
  latestChange: '当日涨跌',
  change5: '近 5 日累计',
  change20: '近 20 日累计',
  amount: '当日成交额',
  turnoverShare: '当日成交占比',
  sharePercentile: '成交占比历史分位',
  amountRatio: '量能倍数（5日/前20日）',
  amountRatioOverlap: '量能倍数（旧口径 5日/20日）',
  pricePercentile: '价格分位（60 日）',
  limitUpCount: '涨停家数',
  maxStreak: '最高连板',
  sealFund: '封板资金合计',
  limitUpRatio: '涨停占比',
  riseFall: '上涨 / 下跌家数',
  breadth: '板块宽度',
  netInflow: '主力净流入',
  leader: '领涨股',
  confidence: '置信度',
} as const;

/** 明细区单位与后缀 */
export const MAINLINE_DETAIL_UNIT = {
  days: '个交易日',
  times: '×',
  houses: '家',
  boards: '板',
} as const;

/** 缺失输入标题与说明（不静默：缺什么明说） */
export const MAINLINE_MISSING_TITLE = '本期未接入的输入';

/** 缺失输入条目（数据现实：这些指标免费源拿不到或本期未实现） */
export const MAINLINE_MISSING_INPUTS = [
  '公募基金板块持仓分位（免费源无干净接口，需按报告期自建季度序列）',
  '板块 PE/PB 估值分位（东财板块快照 PE 实测返回空、PB 仅有当日值，需每日累积快照后给分位）',
  '龙头连续两季业绩验证（东财 datacenter 可按行业取，本期未接入）',
  '北向持股环比方向（实测最新披露日为 2026-06-30，属季度频率，日频环比不可得）',
] as const;

/** 已接入输入清单（与「未接入」对照展示，避免用户以为结构指标也没接） */
export const MAINLINE_CONNECTED_TITLE = '本期已接入的输入';

/** 已接入输入条目 */
export const MAINLINE_CONNECTED_INPUTS = [
  '成交占比历史分位（同花顺行业板块成交额 ÷ 沪深两市总成交额，按基准日截面）',
  '量能倍数（近 5 日均额 ÷ 前 20 日均额，已改滞后口径；界面同时给出旧口径对照）',
  '价格分位（收盘价在近 60 日区间中的分位）',
  '板块内涨停家数 / 最高连板 / 封板资金合计（东财涨停池按行业归属聚合）',
  '板块宽度（上涨 ÷ 上涨+下跌）与主力净流入（同花顺行业清单页快照）',
  '数据源兜底：同花顺清单页/日线可用时一律走同花顺；确认同花顺整体不可用（全部板块日线均失败）时整表降级东财，来源与切换原因在页头明示，两个来源的序列分开存放、不拼接',
] as const;

/** 置信度文案 */
export const MAINLINE_CONFIDENCE_LABEL = {
  high: '高（样本充足）',
  medium: '中（样本一般）',
  low: '低（样本不足）',
} as const;

/** 置信度档位类型 */
export type MainlineConfidence = keyof typeof MAINLINE_CONFIDENCE_LABEL;

/** 样本充足所需交易日数（达到即 high） */
export const MAINLINE_CONFIDENCE_HIGH_DAYS = 120;

/** 样本中等所需交易日数（低于低档阈值即 low） */
export const MAINLINE_CONFIDENCE_MEDIUM_DAYS = 60;

/**
 * 免责声明
 *
 * 三条实测口径必须写明，否则用户会把「12.58%」直接读成全市场占比：
 * 板块合计 ≈ 全市场 98.5%（实测 9/15~9/17 为 0.984~0.986，缺口为取数失败板块与口径差）；
 * 指标一律取**最近完整交易日**截面（盘中不落半日 bar）；结构指标来自榜单快照与涨停池。
 */
export const MAINLINE_DISCLAIMER =
  '仅历史统计规则下的状态判定，是概率工具而非预言，不构成投资建议，不含任何买卖或仓位指令。' +
  '成交占比口径为「行业板块成交额 ÷ 沪深两市总成交额」（同花顺口径下板块合计约为全市场成交额的 98.5%，' +
  '实测 9/15~9/17 为 98.4%~98.6%，故存在约 1.5% 的系统性低估；但分位是同一基准下的相对位置、不受该缺口影响）。' +
  '全部指标一律取「最近完整交易日」截面：盘中扫描不写入当日半日数据，避免污染占比分位序列。' +
  '板块日线默认取同花顺；仅在确认同花顺整体不可用时整表降级东财（页头标注来源与切换原因，' +
  '两个来源的序列分开存放、不拼接）。涨停家数、连板高度、封板资金来自东财涨停池（按行业归属聚合，' +
  '未归属家数在页头如实列出）；上涨/下跌家数、净流入来自板块清单页快照（同花顺口径为净流入，' +
  '东财口径为主力净流入，两者不可直接比较）。';

/** 风险提示区标题 */
export const MAINLINE_WARNING_TITLE = '风险提示';

/** 主线候选徽标文案 */
export const MAINLINE_CANDIDATE_BADGE = '主线候选';

/**
 * 数据滞后徽标文案模板
 * @param days 滞后交易日数
 * @returns 徽标文案
 */
export const MAINLINE_STALE_BADGE = (days: number): string => `滞后${days}日`;

/** 基准日完全没有行情 bar 时的徽标文案（滞后天数为 0 但确实不在基准日截面上） */
export const MAINLINE_STALE_NO_BAR_BADGE = '无基准日行情';

/** 兜底模式下「东财无同义板块」徽标文案（映射不上 → 空序列） */
export const MAINLINE_EM_UNMAPPED_BADGE = '东财无同义板块';

/** 情绪加速徽标文案 */
export const MAINLINE_STRUCTURE_HOT_BADGE = '情绪加速';

/**
 * 表格行 key
 *
 * 同一板块在「同花顺」与「东财」两个来源下是**两条不同的序列**（分开存放、绝不拼接），
 * 所以行 key 必须带来源，否则切换来源时表格会复用同一行、把两套口径混起来看。
 * @param source 数据源
 * @param code 板块代码
 * @returns 行 key
 */
export const mainlineRowKey = (source: MainlineSource, code: string): string => `${source}-${code}`;

// ---------- 页头说明文案 ----------

/** 页头字段标签 */
export const MAINLINE_HEADER_LABEL = {
  benchmark: '基准交易日',
  coverage: '覆盖板块',
  boardCount: '板块总数',
  marketAmount: '两市成交额',
  scannedAt: '上次扫描',
  limitUp: '基准日涨停',
  structure: '结构指标',
  source: '数据源',
  refsSource: '板块清单',
} as const;

/**
 * 基准日覆盖率文案模板（如「88 / 90 个板块」）
 * @param coverage 基准日有行情的板块数
 * @param total 板块总数
 * @returns 文案
 */
export const MAINLINE_COVERAGE_TEXT = (coverage: number, total: number): string =>
  `${coverage} / ${total} 个板块`;

/**
 * 结构指标采集说明模板（涨停家数 + 未归属家数）
 * @param total 基准日全市场涨停家数
 * @param unmapped 未能归属到板块的涨停家数
 * @returns 文案
 */
export const MAINLINE_LIMIT_UP_TEXT = (total: number, unmapped: number): string =>
  unmapped > 0 ? `全市场 ${total} 家（未归属板块 ${unmapped} 家）` : `全市场 ${total} 家`;

/** 结构指标未采集文案 */
export const MAINLINE_STRUCTURE_UNAVAILABLE = '未采集（本次取数失败）';

/**
 * 盘中未落定提示模板（说明当日 bar 为何没写入）
 * @param date 被排除的日期
 * @param benchmark 实际采用的基准交易日
 * @returns 文案
 */
export const MAINLINE_INTRADAY_NOTICE = (date: string, benchmark: string): string =>
  `${date} 当日数据尚未落定（盘中为半日值），本次未写入当日行情；全部指标按最近完整交易日 ${benchmark} 计算。`;

/**
 * 基准日覆盖率不足提示模板（连完整交易日都凑不齐覆盖率时的降级说明）
 * @param benchmark 实际采用的基准交易日
 * @returns 文案
 */
export const MAINLINE_DEGRADED_NOTICE = (benchmark: string): string =>
  `未找到覆盖率达标的交易日，已退回覆盖最全的 ${benchmark}；该日部分板块行情缺失，横截面比较需谨慎。`;

// ---------- 数据源兜底文案（L2.5） ----------

/**
 * 整表切换数据源的提示模板
 *
 * 必须同时给出「为什么切」「上游报了什么错」「口径差在哪」—— 否则用户会把东财口径的
 * 12.58% 直接和昨天的同花顺口径比，而两套板块指数不同源，点位与成分都不保证一致。
 * @param reason 切换原因（来自 `MAINLINE_FALLBACK_REASON_LABEL`）
 * @param error 上游原始报错（可为空串）
 * @returns 提示文案
 */
export const MAINLINE_FALLBACK_NOTICE = (reason: string, error: string): string =>
  `本次已整表切换为东方财富口径。原因：${reason}${error ? `（上游报错：${error}）` : ''}。` +
  '东财板块指数与同花顺不同源：点位不可比、成分不保证一致，因此指标只保证「同一次扫描内横向自洽」，' +
  '请勿与同花顺口径的历史数值直接比较。两个来源的日线在库里分开存放、绝不拼接；' +
  '同花顺恢复后会自动切回，切换期间的东财数据也不会污染同花顺累积的分位序列。';

/**
 * 兜底模式的净流入口径提示（东财 `f62` 是主力净流入，与同花顺清单页口径不同）
 */
export const MAINLINE_EM_CALIBER_NOTICE =
  '兜底模式下「净流入」为东财主力净流入（大单口径），与同花顺清单页的净流入不可直接比较；涨停家数 / 连板高度 / 封板资金仍来自东财涨停池，与同花顺模式下一致。';

/**
 * 兜底模式未映射板块提示模板（东财没有同义板块的同花顺板块，如实列出、不猜）
 * @param names 未映射的同花顺板块名
 * @returns 提示文案
 */
export const MAINLINE_EM_UNMAPPED_TEXT = (names: readonly string[]): string =>
  `有 ${names.length} 个同花顺板块在东财找不到同义板块（两套分类口径不同），本次按「无数据」处理而非猜测映射：${names.join('、')}。`;

/**
 * 清单页故障但日线仍可用的提示模板（不切源，只是拿不到当日结构快照）
 * @param error 清单页原始报错
 * @param refsLabel 实际使用的清单来源文案
 * @returns 提示文案
 */
export const MAINLINE_LIST_ONLY_NOTICE = (error: string, refsLabel: string): string =>
  `同花顺板块清单页取数失败（${error}），本次改用${refsLabel}继续取同花顺日线：数据口径未变，但当日结构指标（宽度 / 净流入）与涨停池行业归属本期未采集。`;

/** 兜底扫描耗时提示（东财必须串行 ≥1.1s，比同花顺慢得多） */
export const MAINLINE_EM_SLOW_NOTICE =
  '东财兜底必须串行请求（同上游间隔 ≥1.1s），一次扫描约需 2 分钟，请勿重复点击「扫描主线」。';

// ---------- 判定层动态文案 ----------

/**
 * 滞后板块的风险提示模板
 * @param days 滞后交易日数
 * @returns 提示文案
 */
export const MAINLINE_WARNING_STALE = (days: number): string =>
  `该板块行情滞后基准日 ${days} 个交易日，指标非同一截面，本行不参与阶段判定（等取数恢复后自动回到正常判定）。`;

/** 结构指标缺失时的风险提示 */
export const MAINLINE_WARNING_NO_STRUCTURE =
  '本期未采集到板块内涨停与宽度数据，结构门槛未参与本次判定。';

/**
 * 确认期被结构门槛否决时的提示模板
 * @param limitUpCount 板块内涨停家数
 * @param breadth 板块宽度（%）
 * @returns 提示文案
 */
export const MAINLINE_WARNING_STRUCTURE_FAIL = (limitUpCount: number, breadth: number): string =>
  `量价与拥挤度特征具备，但板块内涨停 ${limitUpCount} 家、宽度 ${breadth.toFixed(1)}%，内部结构不支持抱团主线，故不判「确认」。`;

/**
 * 情绪加速的风险提示模板
 * @param maxStreak 板块内最高连板数
 * @param limitUpRatio 涨停占比（%）
 * @returns 提示文案
 */
export const MAINLINE_WARNING_STRUCTURE_HOT = (maxStreak: number, limitUpRatio: number): string =>
  `板块内最高 ${maxStreak} 板、涨停占比 ${limitUpRatio.toFixed(1)}%，个股层面已进入情绪加速段，波动通常同步放大。`;

/**
 * 确认期板块无涨停的提示模板
 * @param breadth 板块宽度（%）
 * @returns 提示文案
 */
export const MAINLINE_WARNING_NO_LIMIT_UP = (breadth: number): string =>
  `板块内无涨停个股（宽度 ${breadth.toFixed(1)}%），确认期的个股参与度偏弱，需继续观察。`;
