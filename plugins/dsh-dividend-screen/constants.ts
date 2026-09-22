/**
 * 插件 dsh-dividend-screen（股息筛选）· 全部常量
 *
 * 定位：市面「股息排行」字段的口径都有偏差 —— 东财 clist `f133` 实测 ≈ 最新年报期
 * 分红 ÷ 现价（招商银行 2026-09-20 实测漏掉中期分红，2.47% vs 同花顺 TTM 4.97%），
 * 只用于**选样本池**；展示的 TTM / 去年 / 推算股息率全部由本插件用分红明细自算。
 * 在同一张表上叠加**今年推算**：用今年中报 ÷ 去年中报的净利比作为全年增长系数，
 * 保留去年分红率（去年分红 = 去年财务年度内中期 + 末期 + 季度方案合计），
 * 推算「今年若维持分红率、全年净利按中报增速走」的股息率。
 *
 * 数据源（2026-09-20 全部实测可用，证据 `.ai/tmp/dy*.json`）：
 * - 股息率排行：`push2delay.eastmoney.com/api/qt/clist/get`，`fid=f133` 降序，
 *   `fltt=2&invt=2` 下全部字段为真值（f2 现价 / f20 总市值 / f38 总股本 / f115 PE-TTM / f133 股息率）；
 *   ⚠️ 实测 `pz>100` 只回 100 行（上游硬上限）→ 必须分页；
 * - 业绩报表：`datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_LICO_FN_CPD`，
 *   支持 `(REPORTDATE=...)(SECURITY_CODE in ("...","..."))` 复合过滤，
 *   字段 `PARENT_NETPROFIT` 归母净利 / `SJLTZ` 净利同比 / `YSTZ` 营收同比 / `BOARD_NAME` 行业；
 * - 分红明细：`reportName=RPT_SHAREBONUS_DET`，`PRETAX_BONUS_RMB` 为每 10 股派息（含税），
 *   同一报告期可能有多条方案，每股派息须**按代码求和**；`EX_DIVIDEND_DATE` 除权除息日
 *   是 TTM 归集的锚点（报告期归属财务年度，除息日归属现金流时点，两者不同）。
 */

/** 插件 id */
export const DIVIDEND_PLUGIN_ID = 'dsh-dividend-screen';

/** 左侧导航路径（菜单贡献点带 component 时自动注册该路由） */
export const DIVIDEND_MENU_PATH = '/dividend-screen';

/** 左侧导航标题 */
export const DIVIDEND_MENU_TITLE = '股息筛选';

/** 菜单图标（MenuIcon 的 key） */
export const DIVIDEND_MENU_ICON = 'rank';

// ---------- 数据源 ----------

/** 东财行情域要求带 Referer，否则可能被拒 */
export const EM_QUOTE_REFERER = 'https://quote.eastmoney.com/';

/** 东财数据中心要求带 Referer，否则可能被拒 */
export const EM_DATA_REFERER = 'https://data.eastmoney.com/';

/** 股息率排行（push2delay 延时快照域，本机实测长期可达） */
export const DIVIDEND_RANK_URL = 'https://push2delay.eastmoney.com/api/qt/clist/get';

/** 东财数据中心（业绩报表与分红明细共用基址） */
export const EM_DATACENTER_URL = 'https://datacenter-web.eastmoney.com/api/data/v1/get';

/** 业绩报表的 reportName */
export const EM_PERF_REPORT_NAME = 'RPT_LICO_FN_CPD';

/** 分红送配明细的 reportName */
export const EM_DIVIDEND_REPORT_NAME = 'RPT_SHAREBONUS_DET';

/** A 股全集过滤串（沪深主板 + 创业板 + 科创板） */
export const DIVIDEND_RANK_FS = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23';

/**
 * 排行排序字段：`f133` = 东财「股息率」字段
 *
 * ⚠️ 实测口径并非近 12 个月（2026-09-20 招商银行案例：f133=2.47% 只含 2025 年度末期
 * 10 派 10.03 ÷ 现价，漏掉除息日在近 12 个月内的中期 10 派 10.13，同花顺同期 TTM 为
 * 4.97%）→ f133 ≈ 最新年报期分红 ÷ 现价，一年多次分红的个股被系统性低估。
 * 但这里**排行只用来选样本池**，界面展示的股息率全部由本插件自算（TTM / 去年 / 推算），
 * 池边界个别股票进出不影响数据正确性；样本池对「一年多次分红」个股的覆盖偏差
 * 可用自选 tab 的个股搜索按需拉取兜底。
 *
 * 另：f133 随现价实时变化（派息 ÷ 现价），逐页串行翻页时行会在页边界漂移
 * （与 dsh-mainline 踩过的 `fid=f3` 丢行是同一机理）——按代码去重 + 收不满多翻一页兜底。
 */
export const DIVIDEND_RANK_SORT_FIELD = 'f133';

/** 排行排序方向（1 = 降序，取股息率最高的前 N） */
export const DIVIDEND_RANK_SORT_ORDER = '1';

/**
 * 排行单页行数
 *
 * 实测（2026-09-20）：`pz=300` 只返回 100 行 → 上游单页硬上限 100，翻页不可避免。
 */
export const DIVIDEND_RANK_PAGE_SIZE = 100;

/** 排行查询串（`{page}` 由取数层替换；`fltt=2&invt=2` 保证数值为真值小数） */
export const DIVIDEND_RANK_QUERY =
  `pn={page}&pz=${DIVIDEND_RANK_PAGE_SIZE}&po=${DIVIDEND_RANK_SORT_ORDER}&np=1&fltt=2&invt=2` +
  `&fid=${DIVIDEND_RANK_SORT_FIELD}&fs=${DIVIDEND_RANK_FS}` +
  '&fields=f12,f14,f2,f3,f20,f23,f38,f115,f133';

/** 排行查询串里页码的占位符（由取数层替换为实际页码） */
export const DIVIDEND_RANK_PAGE_TOKEN = '{page}';

/** clist 行里各字段的键（避免在解析层写裸字符串） */
export const EM_RANK_FIELD = {
  /** 股票代码 */
  CODE: 'f12',
  /** 股票名称 */
  NAME: 'f14',
  /** 现价 */
  PRICE: 'f2',
  /** 涨跌幅（%） */
  CHANGE_PERCENT: 'f3',
  /** 总市值（元） */
  MARKET_CAP: 'f20',
  /** 市净率 */
  PB: 'f23',
  /** 总股本（股） */
  TOTAL_SHARES: 'f38',
  /** 市盈率 TTM */
  PE_TTM: 'f115',
  /** 东财「股息率」字段（实测 ≈ 最新年报期分红 ÷ 现价，仅用于选样本池，见上） */
  DIVIDEND_YIELD: 'f133',
} as const;

/** datacenter 业绩报表的报告期字段名（⚠️ 无下划线） */
export const EM_PERF_REPORT_DATE_FIELD = 'REPORTDATE';

/** datacenter 分红明细的报告期字段名（⚠️ 带下划线，与业绩报表不同） */
export const EM_DIVIDEND_REPORT_DATE_FIELD = 'REPORT_DATE';

/** datacenter 查询里代码字段名（两个 reportName 通用） */
export const EM_SECURITY_CODE_FIELD = 'SECURITY_CODE';

/** datacenter 业绩报表的取用列（MGJYXJJE = 每股经营活动现金流，规则引擎用） */
export const EM_PERF_COLUMNS =
  'SECURITY_CODE,SECURITY_NAME_ABBR,PARENT_NETPROFIT,SJLTZ,YSTZ,BOARD_NAME,MGJYXJJE';

/** datacenter 业绩报表行里各字段的键 */
export const EM_PERF_FIELD = {
  /** 股票代码 */
  CODE: 'SECURITY_CODE',
  /** 归母净利润（元） */
  NET_PROFIT: 'PARENT_NETPROFIT',
  /** 净利润同比（%） */
  NET_PROFIT_YOY: 'SJLTZ',
  /** 营业收入同比（%） */
  REVENUE_YOY: 'YSTZ',
  /** 行业（东财口径） */
  INDUSTRY: 'BOARD_NAME',
  /** 每股经营活动现金流（元；年报口径 = 全年经营现金流 ÷ 总股本） */
  OCF_PER_SHARE: 'MGJYXJJE',
} as const;

/** 资产负债表摘要的 reportName（负债率来源，2026-09-20 实测：DEBT_ASSET_RATIO 为百分数真值） */
export const EM_BALANCE_REPORT_NAME = 'RPT_DMSK_FN_BALANCE';

/** 资产负债表摘要的报告期字段名（⚠️ 带下划线，与分红明细同、与业绩报表不同） */
export const EM_BALANCE_REPORT_DATE_FIELD = 'REPORT_DATE';

/** 资产负债表摘要的取用列 */
export const EM_BALANCE_COLUMNS = 'SECURITY_CODE,REPORT_DATE,DEBT_ASSET_RATIO';

/** 资产负债表摘要行里各字段的键 */
export const EM_BALANCE_FIELD = {
  /** 股票代码 */
  CODE: 'SECURITY_CODE',
  /** 报告期 */
  REPORT_DATE: 'REPORT_DATE',
  /** 资产负债率（%，真值小数） */
  DEBT_ASSET_RATIO: 'DEBT_ASSET_RATIO',
} as const;

/** 连续分红年数往前回看的年度数（「连续 5 年分红」规则口径） */
export const DIVIDEND_HISTORY_YEARS = 5;

/** TTM 股息率的回看窗口（天；按除权除息日归集，与同花顺「股息率(TTM)」同口径） */
export const TTM_WINDOW_DAYS = 365;

/** datacenter 分红明细的取用列（EX_DIVIDEND_DATE = 除权除息日，TTM 归集锚点） */
export const EM_DIVIDEND_COLUMNS =
  'SECURITY_CODE,SECURITY_NAME_ABBR,REPORT_DATE,ASSIGN_PROGRESS,PRETAX_BONUS_RMB,TOTAL_SHARES,EX_DIVIDEND_DATE';

/** datacenter 分红明细行里各字段的键 */
export const EM_DIVIDEND_FIELD = {
  /** 股票代码 */
  CODE: 'SECURITY_CODE',
  /** 报告期（多期合并查询后按期分组的键） */
  REPORT_DATE: 'REPORT_DATE',
  /** 每 10 股派息（元，含税；纯转增行为 null） */
  BONUS_PER_TEN: 'PRETAX_BONUS_RMB',
  /** 派息方案公告时的总股本（股） */
  TOTAL_SHARES: 'TOTAL_SHARES',
  /** 除权除息日（未实施为空） */
  EX_DATE: 'EX_DIVIDEND_DATE',
} as const;

/** 每 10 股派息换算每股的基数 */
export const SHARES_PER_TEN_BONUS = 10;

/** datacenter 单次 in 过滤的代码分块大小（控制 URL 长度，实测 3 代码可用、100 代码约 1.2KB 无压力） */
export const EM_CODE_CHUNK_SIZE = 100;

/** datacenter 单次请求的页大小（in 过滤 ≤100 代码时一页必然装下） */
export const EM_DATACENTER_PAGE_SIZE = 500;

/** datacenter 返回体里的成功标记字段 */
export const EM_DATACENTER_SUCCESS_FIELD = 'success';

// ---------- 频率与重试 ----------

/** 东财行情域（push2delay）分页间隔（毫秒；东财系同上游必须错峰） */
export const EM_RANK_DELAY_MS = 1000;

/** 东财数据中心（datacenter-web）分块间隔（毫秒；该域限速显著宽松于行情域） */
export const EM_DATACENTER_DELAY_MS = 600;

/** 单请求尝试次数（含首次；东财会掐连接，原地小步重试是唯一有效兜底） */
export const EM_FETCH_ATTEMPTS = 3;

/** 重试间隔（毫秒） */
export const EM_FETCH_RETRY_DELAY_MS = 1500;

// ---------- 样本池与报告期 ----------

/** 默认样本池大小（按 TTM 股息率取前 N） */
export const DIVIDEND_UNIVERSE_DEFAULT = 200;

/** 样本池可选档位 */
export const DIVIDEND_UNIVERSE_OPTIONS = [100, 200, 300, 500] as const;

/** 排行翻页的护栏页数（`ceil(上限档位 / 单页)` + 1 页漂移余量） */
export const DIVIDEND_RANK_MAX_PAGES = 6;

// ---------- 推算与展示 ----------

/** 百分比换算基数 */
export const PERCENT_BASE = 100;

/** 元 → 亿元换算基数 */
export const YUAN_PER_YI = 1e8;

/**
 * 推算状态（决定行内推算列显示什么）
 *
 * 状态判定按顺序短路：未披露 → 今年亏损 → 增长不可比 → 无可比分红率 → 可推算。
 */
export const DIVIDEND_PROJECT_STATUS = {
  /** 今年中报已披露、去年基数健康、去年有分红率 → 可推算 */
  OK: 'ok',
  /** 今年中报未披露（无记录或净利字段缺失） */
  NO_REPORT: 'no_report',
  /** 今年中报亏损（负增长推算出的负分红没有意义，不推算） */
  H1_LOSS: 'h1_loss',
  /** 今年盈利但去年同期无数据或为负（增长系数不可比） */
  BASE_INVALID: 'base_invalid',
  /** 去年未分红或去年净利为负（分红率不可得） */
  NO_PAYOUT: 'no_payout',
} as const;

/** 推算状态取值类型 */
export type ProjectStatus = (typeof DIVIDEND_PROJECT_STATUS)[keyof typeof DIVIDEND_PROJECT_STATUS];

/** 推算状态中文说明（行内徽标与展开区共用） */
export const DIVIDEND_PROJECT_STATUS_LABEL = {
  ok: '可推算',
  no_report: '中报未披露',
  h1_loss: '中报亏损',
  base_invalid: '增长不可比',
  no_payout: '去年无可比分红率',
} as const satisfies Record<ProjectStatus, string>;

/** 推算状态徽标样式（可推算用涨色弱底，其余用中性弱底） */
export const DIVIDEND_PROJECT_STATUS_BADGE_CLASS = {
  ok: 'bg-up-weak text-up',
  no_report: 'bg-flat-weak/60 text-text-tertiary',
  h1_loss: 'bg-down-weak text-down',
  base_invalid: 'bg-flat-weak/60 text-text-tertiary',
  no_payout: 'bg-flat-weak/60 text-text-tertiary',
} as const satisfies Record<ProjectStatus, string>;

/** 分红率超过该值视为「超额分红」（去年分红大于去年净利，推算时照算但明示异常） */
export const PAYOUT_OVERDUE_THRESHOLD = 1;

/** 中报净利比的持平线（1 = 与去年同期持平；「仅净利增长」筛选按 > 该值判定） */
export const GROWTH_BREAK_EVEN = 1;

/** 超额分红徽标文案 */
export const DIVIDEND_PAYOUT_OVERDUE_BADGE = '超分红';

// ---------- 规则引擎 ----------

/**
 * 规则配置在插件库 config 表里的键
 */
export const DIVIDEND_CONFIG_KEY = 'rule_config';

/** 规则分组：筛选（全部满足才保留） */
export const RULE_GROUP_FILTER = 'filter';

/** 规则分组：排除（命中任意一条即剔除） */
export const RULE_GROUP_EXCLUDE = 'exclude';

/**
 * 周期行业关键词默认清单（子串匹配东财 BOARD_NAME）
 *
 * 「非周期顶点」没有直接可查的字段，用两层代理：① 行业属周期板块 → 高股息常是
 * 盈利顶点的价格陷阱（市盈率极低 = 市场预期景气回落）；② 中报净利同比塌陷。
 * 关键词按子串匹配以兼容行业名的年度调整（如「普钢」/「特钢」都含「钢」）。
 */
export const RULE_CYCLICAL_KEYWORDS_DEFAULT = '煤炭,焦炭,钢,石油,炼化,油气,化工,化学,有色,工业金属,能源金属,小金属,贵金属,航运,港口,化纤';

/**
 * 市值下限规则的默认阈值（亿元）
 *
 * 微盘高股息常是「股价跌出来的息」：流动性差、治理溢价低、分红一停就杀估值。
 * 100 亿是兼顾覆盖面与质量的常见门槛，用户可在规则面板自行调整。
 */
export const RULE_MARKET_CAP_MIN_DEFAULT_YI = 100;

/** 亿元 → 元 的换算因子（东财 f20 总市值的存储单位是元） */
export const YI_TO_YUAN = 1e8;

/** 规则参数展示时的百分号后缀 */
export const RULE_PARAM_PERCENT_SUFFIX = '%';

/** 规则参数展示时的倍数后缀 */
export const RULE_PARAM_COVER_SUFFIX = '×';

// ---------- 界面文案 ----------

/** 页面标题 */
export const DIVIDEND_PAGE_TITLE = '股息筛选';

/** 页面副标题（说明口径与硬约束） */
export const DIVIDEND_PAGE_SUBTITLE =
  '按东财股息率排行选样本池，TTM / 去年 / 推算股息率均为本页自算口径（TTM = 近 12 个月已实施派息 ÷ 现价，与同花顺同口径；东财 f133 字段会漏一年多次分红，故只用于选池）。推算：以「今年中报 ÷ 去年中报」的净利比作全年增长系数、保留去年分红率。辅助研究工具，推算不构成投资建议。';

/** 扫描按钮文案 */
export const DIVIDEND_SCAN_BUTTON = '扫描排行';

/** 扫描中按钮文案前缀 */
export const DIVIDEND_SCAN_RUNNING = '扫描中';

/** 首次空态文案 */
export const DIVIDEND_EMPTY_TEXT =
  '还没有股息样本，点「扫描排行」按 TTM 股息率拉取前 N 名并叠加中报推算（结果落本地库，重进页面不再联网）';

/** 扫描失败文案前缀 */
export const DIVIDEND_SCAN_FAILED = '扫描失败';

/** 指标缺失占位 */
export const DIVIDEND_PLACEHOLDER = '—';

/** 样本池选择标签 */
export const DIVIDEND_UNIVERSE_LABEL = '样本池';

/** 表格列标题 */
export const DIVIDEND_COLUMN_LABEL = {
  action: '操作',
  name: '股票',
  industry: '行业',
  price: '现价',
  ttmYield: 'TTM股息率',
  yieldLast: '去年股息率',
  payoutLast: '去年分红率',
  dividendYears: '连续分红',
  netProfitH1: '中报净利',
  netProfitYoY: '净利同比',
  projectedYield: '推算今年股息率',
  projectedDelta: '较去年',
  debtRatio: '负债率',
  peTtm: 'PE(TTM)',
  ruleResult: '规则',
} as const;

/**
 * 可配置数据列（键 + 展示名；顺序即默认列顺序）
 *
 * 「操作」列固定最左、「规则」列固定最右（且只在筛选 tab 出现），均不参与配置；
 * 其余 13 个数据列都可由用户在插件设置里控制显隐与顺序。
 */
export const DIVIDEND_CONFIGURABLE_COLUMNS = [
  { key: 'name', label: DIVIDEND_COLUMN_LABEL.name },
  { key: 'industry', label: DIVIDEND_COLUMN_LABEL.industry },
  { key: 'price', label: DIVIDEND_COLUMN_LABEL.price },
  { key: 'ttmYield', label: DIVIDEND_COLUMN_LABEL.ttmYield },
  { key: 'projectedYield', label: DIVIDEND_COLUMN_LABEL.projectedYield },
  { key: 'projectedDelta', label: DIVIDEND_COLUMN_LABEL.projectedDelta },
  { key: 'yieldLast', label: DIVIDEND_COLUMN_LABEL.yieldLast },
  { key: 'payoutLast', label: DIVIDEND_COLUMN_LABEL.payoutLast },
  { key: 'dividendYears', label: DIVIDEND_COLUMN_LABEL.dividendYears },
  { key: 'netProfitH1', label: DIVIDEND_COLUMN_LABEL.netProfitH1 },
  { key: 'netProfitYoY', label: DIVIDEND_COLUMN_LABEL.netProfitYoY },
  { key: 'debtRatio', label: DIVIDEND_COLUMN_LABEL.debtRatio },
  { key: 'peTtm', label: DIVIDEND_COLUMN_LABEL.peTtm },
] as const;

/** 可配置列的键列表（归一化的全集参数） */
export const DIVIDEND_CONFIGURABLE_COLUMN_KEYS = DIVIDEND_CONFIGURABLE_COLUMNS.map(
  (column) => column.key,
);

/** settings 里表头配置的键名 */
export const DIVIDEND_SETTINGS_COLUMN_KEY = 'columns';

/** 快捷筛选：仅已披露中报 */
export const DIVIDEND_FILTER_PUBLISHED = '仅已披露中报';

/** 快捷筛选：仅净利同比增长 */
export const DIVIDEND_FILTER_GROWING = '仅净利增长';

/** 快捷筛选：仅可推算行 */
export const DIVIDEND_FILTER_PROJECTABLE = '仅可推算';

/** 清除筛选按钮文案 */
export const DIVIDEND_FILTER_CLEAR = '清除筛选';

/**
 * 筛选生效时的行数提示模板
 * @param shown 已筛出行数
 * @param total 全部行数
 * @returns 提示文案
 */
export const DIVIDEND_FILTER_SUMMARY = (shown: number, total: number): string =>
  `筛选后 ${shown}/${total} 只`;

/** 展开区小标题 */
export const DIVIDEND_DETAIL_TITLE = '推算明细';

/** 展开区字段标签 */
export const DIVIDEND_DETAIL_LABEL = {
  status: '推算状态',
  dpsLast: '去年每股分红',
  dividendTotalLast: '去年分红总额',
  netProfitFyLast: '去年全年净利',
  payoutLast: '去年分红率',
  netProfitH1: '今年中报净利',
  netProfitH1Last: '去年中报净利',
  growthH1: '中报净利比',
  projectedNetProfit: '预计今年净利',
  projectedDps: '推算今年每股分红',
  projectedYield: '推算今年股息率',
  interimDps: '今年中期已宣派',
  ttmYield: 'TTM股息率（自算）',
  marketCap: '总市值',
  peTtm: 'PE(TTM)',
  pb: '市净率',
  dividendYears: '连续分红年数',
  ocfPerShareLast: '每股经营现金流（FY）',
  cashCoverLast: '现金流 ÷ 分红',
  debtRatio: '资产负债率',
  ruleMatch: '规则匹配',
} as const;

// ---------- 规则面板文案 ----------

/** 规则面板卡片标题 */
export const RULE_PANEL_TITLE = '筛选规则';

/** 筛选组标题（全部满足才保留） */
export const RULE_GROUP_TITLE_FILTER = '真高股息筛选条件（须全部满足）';

/** 排除组标题（命中即剔除） */
export const RULE_GROUP_TITLE_EXCLUDE = '伪高股息剔除规则（命中任一即剔除）';

/** 添加规则按钮文案 */
export const RULE_ADD_BUTTON = '添加规则';

/** 添加规则的占位提示 */
export const RULE_ADD_PLACEHOLDER = '选择规则类型';

/** 恢复默认预置按钮文案 */
export const RULE_RESET_DEFAULT = '恢复默认预置';

/** 删除规则的可达性标签 */
export const RULE_REMOVE_LABEL = '删除该规则';

// ---------- 股息自选（tab） ----------

/** 页面顶部的两个 tab（`BaseTabs` 选项） */
export const DIVIDEND_TAB_OPTIONS = [
  { label: '股息筛选', value: 'screen' },
  { label: '股息自选', value: 'watchlist' },
] as const;

/** tab 值：筛选 */
export const DIVIDEND_TAB_SCREEN = 'screen';

/** tab 值：自选 */
export const DIVIDEND_TAB_WATCHLIST = 'watchlist';

/** 加入自选的可达性标签 */
export const WATCH_ADD_LABEL = '加入自选';

/** 移出自选的可达性标签 */
export const WATCH_REMOVE_LABEL = '移出自选';

/** 一键把当前筛选列表全部加入自选 */
export const WATCH_BULK_ADD = '把当前列表加入自选';

/** 自选 tab 的空态文案 */
export const WATCH_EMPTY_TEXT =
  '还没有自选股票——在列表左侧「操作」列点「自选」按钮加入，筛选出的通过名单可以整表收进来跟踪，也可以在下方搜索个股加入';

/** 自选 tab 的表格卡片标题 */
export const WATCH_CARD_TITLE = '股息自选';

/**
 * 自选计数文案模板
 * @param count 自选数量
 * @returns 文案
 */
export const WATCH_COUNT_TEXT = (count: number): string => `共 ${count} 只`;

/** 操作失败的提示前缀（与规则保存失败同一格式） */
export const WATCH_SAVE_FAILED = '自选保存失败';

/** 规则持久化失败提示前缀 */
export const RULE_SAVE_FAILED = '规则保存失败';

/** 「显示未通过行」开关文案（未通过的行默认隐藏，翻开才显示并带原因徽标） */
export const RULE_SHOW_FAILED = '显示未通过';/** 规则通过徽标文案 */
export const RULE_PASS_BADGE = '通过';

/** 规则未通过徽标文案前缀 */
export const RULE_FAIL_BADGE = '未过';

/** 规则剔除徽标文案前缀 */
export const RULE_EXCLUDE_BADGE = '剔除';

/** 无启用规则时规则列的占位提示 */
export const RULE_NO_ACTIVE_HINT = '未启用';

/** 页头字段标签 */
export const DIVIDEND_HEADER_LABEL = {
  scannedAt: '上次扫描',
  universe: '样本池',
  marketTotal: '全市场',
  published: '已披露中报',
  projectable: '可推算',
  periodH1: '中报报告期',
  periodFyLast: '分红基期',
} as const;

/** 亿元单位后缀 */
export const YI_UNIT = '亿';

/** 元单位后缀 */
export const YUAN_UNIT = '元';

/** 推算公式说明（展开区固定展示，口径透明） */
export const DIVIDEND_FORMULA_TEXT =
  '推算口径：预计今年净利 = 去年全年净利 ×（今年中报净利 ÷ 去年中报净利）；推算分红 = 去年分红率 × 预计今年净利；' +
  '推算股息率 = 推算每股分红 ÷ 现价。分红率沿用去年（含特别分红的异常年份照算），中报增速对全年为线性外推，' +
  '季节性强的行业（白酒 / 工程等下半年占比高）与并购重组个股会显著失真，请结合行业属性判断。';

// ---------- 自选 tab · 个股搜索与预览 ----------

/** 搜索输入框占位文案 */
export const WATCH_SEARCH_PLACEHOLDER = '搜索个股（代码 / 名称 / 拼音）';

/** 搜索输入框的可达性标签 */
export const WATCH_SEARCH_LABEL = '搜索个股并加入自选';

/** 搜索无结果的文案 */
export const WATCH_SEARCH_NO_RESULT = '没有匹配的 A 股标的';

/** 搜索失败文案前缀 */
export const WATCH_SEARCH_FAILED = '搜索失败';

/** 预览卡片标题 */
export const WATCH_PREVIEW_TITLE = '个股预览';

/** 预览卡片「不在样本池 → 按需拉取中」的提示文案 */
export const WATCH_PREVIEW_FETCHING =
  '不在最新扫描的样本池里，正在按需拉取该股的股息指标（行情 + 三期业绩 + 分红史 + 负债 ≈ 6 次串行请求）…';

/** 预览卡片按需拉取成功后的口径说明 */
export const WATCH_PREVIEW_ON_DEMAND_NOTE =
  '该股不在最新扫描样本池，以下指标为点击时按需拉取（口径与扫描一致，但不写入快照，重进页面即消失）';

/** 预览指标按需拉取失败的提示前缀 */
export const WATCH_PREVIEW_FETCH_FAILED = '指标拉取失败';

/** 预览卡片「打开个股详情」按钮文案 */
export const WATCH_PREVIEW_OPEN_DETAIL = '个股详情';

/**
 * 免责声明（页脚固定展示）
 *
 * 三条口径必须写明：TTM 股息率是本页自算口径（近 12 个月已实施派息 ÷ 现价，同花顺同口径；
 * 东财 f133 字段 ≈ 最新年报期分红 ÷ 现价，会漏一年多次分红，只用于选样本池）；
 * 去年股息率与推算股息率是本插件自算口径；推算是线性外推不是预告。
 *
 * 末条是跨平台口径警告：集思录等第三方「静态股息率」按**分红到账的自然年**归集，
 * 本页「去年股息率」按**财务报告期**（去年财务年度内全部方案合计）归集，
 * 实测同一只股可差近一倍（达仁堂 3.71% vs 6.78%、汇洁股份 6.22% vs 11.05%）→ 对比前必须对齐口径。
 */
export const DIVIDEND_DISCLAIMER =
  '本页为历史数据推算工具，不构成投资建议：分红以公司股东大会决议为准，分红率与增速的外推都可能失真；' +
  '「TTM股息率」为本页自算口径（近 12 个月已实施派息 ÷ 现价；东财排行字段会漏一年多次分红，仅用于选样本池），' +
  '「去年股息率 / 推算股息率」亦为本页自算口径。' +
  '注意跨平台口径差异：集思录等平台的「静态股息率」按分红的到账自然年归集，本页按财务报告期归集，' +
  '同一只股可差近一倍，拿别处的股息率与本页对比前请先对齐口径。' +
  '数据落本地插件库，扫描只在点击时请求上游。';
