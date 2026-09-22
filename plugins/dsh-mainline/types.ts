/**
 * 插件 dsh-mainline（股票主线）· 插件内类型
 *
 * 判定层（`judge.ts`）是纯函数层：输入 `BoardSeries` + 沪深成交额序列 + 基准交易日，
 * 输出 `MainlineVerdict` —— 便于冒烟断言与将来回测（历史 bundle 直接喂进去重算标签）。
 */
import type {
  MainlineConfidence,
  MainlinePhase,
  MainlineRefsSource,
  MainlineSource,
} from './constants';
// 宿主服务契约只需要**类型**：`import type` 在打包后完全消失，产物里不存在任何
// 宿主模块的引用，但源码仍然享受完整的类型检查
import type {
  FormatService,
  HttpService,
  MarketService,
  UiKitService,
} from '../../host/types/plugin.types';

/**
 * 插件运行所需的宿主能力（依赖注入容器）
 *
 * 为什么不直接在模块里 import：本插件最终以**单文件产物**形态分发，
 * 运行时拿不到宿主模块，只能由 `plugin.ts` 在 `apply(ctx)` 里把服务取好、
 * 沿调用链传下来。同时也让依赖显式化 —— 看这一个对象就知道插件用了宿主什么。
 */
export interface MainlineDeps {
  /** 受控网络请求（走宿主上游通道，域名白名单内） */
  http: HttpService;
  /** 格式化与涨跌语义 */
  format: FormatService;
  /** 市场剖面数据（成交额 / 涨停池） */
  market: MarketService;
  /** 宿主 UI Kit（卡片 / 表格 / 按钮 / 空态 / 图标） */
  ui: UiKitService;
}

/** 板块清单里的一项（同花顺行业板块） */
export interface ThsBoardRef {
  /** 板块代码（同花顺 88xxxx，如 881121 = 半导体） */
  code: string;
  /** 板块名称 */
  name: string;
}

/**
 * 板块单日行情（由同花顺板块日 K 解析而来）
 *
 * 除日 K 自带的价量字段外，另有若干**结构性字段**（涨停家数 / 宽度 / 净流入）——
 * 它们只来自「榜单快照 + 涨停池」，只可能落在**被扫描的基准日**那一行上，
 * 其余历史行没有（`undefined` = 未采集，`0` = 采到且确实为 0，二者不可混同）。
 */
export interface BoardDaily {
  /** 交易日 YYYY-MM-DD */
  date: string;
  /** 收盘点位 */
  close: number;
  /** 当日涨跌幅（%），由相邻收盘价比值算出 */
  changePercent: number;
  /** 当日成交额（元） */
  amount: number;
  /** 板块内上涨家数（同花顺行业清单页快照；仅基准日行有值） */
  riseCount?: number;
  /** 板块内下跌家数（同上） */
  fallCount?: number;
  /** 板块当日净流入（元，清单页「净流入(亿元)」换算；仅基准日行有值） */
  netInflow?: number;
  /** 板块内涨停家数（东财涨停池按行业聚合；仅基准日行有值） */
  limitUpCount?: number;
  /** 板块内最高连板数（无涨停即为 0；仅基准日行有值） */
  maxStreak?: number;
  /** 板块内涨停封板资金合计（元；仅基准日行有值） */
  sealFund?: number;
  /** 板块内领涨股名称（清单页；仅基准日行有值） */
  leaderName?: string;
}

/** 板块日线序列（按日期升序） */
export interface BoardSeries extends ThsBoardRef {
  /**
   * 该序列的数据源
   *
   * 缺省（`undefined`）视为同花顺 —— 兼容早于来源标记写入库的历史行。
   * 两个来源的序列**分开存放、绝不拼接**（跨源拼接会让成交额口径在接缝处跳变，
   * 直接污染量能倍数与成交占比分位）。
   */
  source?: MainlineSource;
  /** 逐日行情（升序，尾部为最新） */
  days: BoardDaily[];
}

/** 沪深两市单日总成交额（来源：宿主 fetchMarketTurnover，单位元） */
export interface MarketTurnoverPoint {
  /** 交易日 YYYY-MM-DD */
  date: string;
  /** 两市合计成交额（元） */
  totalAmount: number;
}

/**
 * 板块清单页的一行快照（当日截面，含涨跌家数与资金流）
 *
 * 同花顺清单页与东财板块清单都能填出这套字段（字段名一一对应），
 * 差别只在「净流入」口径：同花顺为净流入，东财 `f62` 为**主力净流入**。
 */
export interface BoardSnapshot {
  /** 板块代码（同花顺 88xxxx / 东财 BKxxxx） */
  code: string;
  /** 板块名称 */
  name: string;
  /** 数据源 */
  source: MainlineSource;
  /** 板块当日涨跌幅（%） */
  changePercent: number | null;
  /** 板块当日成交额（元） */
  amount: number | null;
  /** 板块当日净流入（元；东财为主力净流入口径） */
  netInflow: number | null;
  /** 上涨家数 */
  riseCount: number | null;
  /** 下跌家数 */
  fallCount: number | null;
  /** 领涨股名称（无则空串） */
  leaderName: string;
}

/** 单个板块的涨停结构聚合（由东财涨停池按行业归属而来） */
export interface LimitUpStat {
  /** 板块内涨停家数 */
  count: number;
  /** 板块内最高连板数 */
  maxStreak: number;
  /** 板块内涨停封板资金合计（元） */
  sealFund: number;
}

/** 涨停池聚合结果（含未归属统计，不静默丢弃） */
export interface LimitUpAggregate {
  /** 板块代码 → 涨停结构 */
  byCode: Map<string, LimitUpStat>;
  /** 未能归属到任何板块的涨停家数 */
  unmappedCount: number;
  /** 未能归属的行业名（上游原始名） */
  unmappedIndustries: string[];
  /** 涨停家数总计（含未归属） */
  total: number;
}

/**
 * 「同花顺板块 → 东财板块」映射结果（兜底模式用）
 *
 * 两级都如实保留：映射不上的板块**不猜**（宁可按「无数据」处理并在页头列出），
 * 因为硬映射会把成分不同的板块当成同一个，比缺数据更误导。
 */
export interface EmMappingResult {
  /** 同花顺板块代码 → 命中的东财板块快照 */
  mapped: Map<string, BoardSnapshot>;
  /** 未能映射的同花顺板块名（页头如实展示） */
  unmapped: string[];
}

/** 板块指标面板（原始指标，供界面直接展示，不做二次加工） */
export interface BoardMetrics {
  /** 该板块自身序列的最后一天（滞后板块会小于基准日） */
  asOf: string;
  /** 该板块序列的数据源（同花顺 / 东财） */
  source: MainlineSource;
  /** 全板块统一的基准交易日 */
  benchmarkDate: string;
  /** 该板块是否滞后于基准日（无基准日 bar，不参与阶段判定） */
  stale: boolean;
  /** 滞后基准日的交易日数（0 = 不滞后） */
  staleDays: number;
  /** 历史样本交易日数 */
  historyDays: number;
  /** 基准日涨跌幅（%） */
  latestChange: number;
  /** 近 5 日累计涨跌幅（%） */
  change5: number;
  /** 近 20 日累计涨跌幅（%） */
  change20: number;
  /** 基准日成交额（元）；无数据为 null */
  amount: number | null;
  /** 基准日成交额 ÷ 沪深两市总成交额（%）；缺全市场数据为 null */
  turnoverShare: number | null;
  /** 成交占比在其自身历史上的分位（0-100）；样本不足为 null */
  sharePercentile: number | null;
  /** 量能倍数 = 近 5 日均额 ÷ 前 20 日均额（不含最近 5 日）；样本不足为 null */
  amountRatio: number | null;
  /** 量能倍数旧口径 = 近 5 日均额 ÷ 近 20 日均额（窗口重叠，仅作观察对照） */
  amountRatioOverlap: number | null;
  /** 收盘价在近 60 日区间中的分位（0-100）；样本不足为 null */
  pricePercentile: number | null;
  /** 板块内涨停家数；null = 未采集结构数据 */
  limitUpCount: number | null;
  /** 板块内最高连板数 */
  maxStreak: number | null;
  /** 板块内涨停封板资金合计（元） */
  sealFund: number | null;
  /** 涨停占比 = 涨停家数 ÷ (上涨家数 + 下跌家数) × 100（%） */
  limitUpRatio: number | null;
  /** 板块宽度 = 上涨家数 ÷ (上涨家数 + 下跌家数) × 100（%） */
  breadth: number | null;
  /** 板块内上涨家数 */
  riseCount: number | null;
  /** 板块内下跌家数 */
  fallCount: number | null;
  /** 板块当日主力净流入（元） */
  netInflow: number | null;
  /** 板块内领涨股名称（无则空串） */
  leaderName: string;
}

/** 看板筛选条件（阶段徽标与「主线候选」开关的共同描述） */
export interface MainlineFilterOptions {
  /** 是否只看主线候选 */
  candidateOnly: boolean;
  /** 选中的阶段（空数组 = 不按阶段筛选；多选按并集，不是「且」） */
  phases: readonly MainlinePhase[];
}

/** 单板块判定结论（阶段标签 + 风险提示 + 指标面板） */
export interface MainlineVerdict {
  /** 板块代码 */
  code: string;
  /** 板块名称 */
  name: string;
  /** 阶段 */
  phase: MainlinePhase;
  /** 阶段中文标签 */
  phaseLabel: string;
  /** 阶段说明 */
  phaseDesc: string;
  /** 是否命中「主线候选」（成交占比分位或量能倍数超阈值） */
  candidate: boolean;
  /** 置信度（由样本天数决定） */
  confidence: MainlineConfidence;
  /** 结构指标是否显示「情绪加速」（连板高度或涨停占比到档） */
  structureHot: boolean;
  /** 风险提示（状态语言，不含买卖指令） */
  warnings: readonly string[];
  /** 原始指标面板 */
  metrics: BoardMetrics;
}

/** 一次扫描的元信息（落库，供下次启动直接展示与增量更新） */
export interface MainlineScanMeta {
  /** 本次扫描完成时间（毫秒时间戳） */
  scannedAt: number;
  /** 全板块统一基准交易日（= 各指标口径日） */
  asOf: string;
  /** 成功板块数与总板块数 */
  boardCount: number;
  /** 基准日有行情的板块数（覆盖率分子） */
  coverage: number;
  /** 是否降级：没有任何交易日达到覆盖率门槛，已退回覆盖最全的一天 */
  degraded: boolean;
  /** 因「当日未落定」被排除的日期（空串 = 无） */
  excludedDate: string;
  /** 基准日沪深两市总成交额（元）；缺失为 null */
  marketAmount: number | null;
  /** 基准日全市场涨停家数；结构指标未采集为 null */
  limitUpTotal: number | null;
  /** 其中未能归属到行业板块的涨停家数 */
  limitUpUnmapped: number | null;
  /** 结构指标（涨停/宽度/净流入）是否采集成功 */
  structureReady: boolean;
  /** 本次扫描使用的数据源（整表一致，绝不混排） */
  source: MainlineSource;
  /** 板块清单（代码+名称）的来源 */
  refsSource: MainlineRefsSource;
  /** 清单页的原始报错（空串 = 清单页正常） */
  listError: string;
  /** 触发整表切换数据源的原因键（空串 = 未切换） */
  fallbackReason: string;
  /** 触发切换时的上游原始报错（空串 = 无） */
  fallbackError: string;
  /** 兜底模式下未能映射到东财板块的同花顺板块名（已按「无数据」处理） */
  emUnmapped: string[];
}

/** 本地快照（启动时读库得到，无需联网） */
export interface MainlineSnapshot {
  /** **当前数据源**的各板块日线序列（切换来源后自动换成另一套，不混排） */
  boards: BoardSeries[];
  /** 沪深成交额序列 */
  market: MarketTurnoverPoint[];
  /** 扫描元信息；从未扫描过为 null */
  meta: MainlineScanMeta | null;
  /** 最近一次同花顺扫描缓存的板块清单（清单页故障时用它继续取同花顺日线） */
  refs: ThsBoardRef[];
  /** 当前生效的数据源（= 上次扫描的来源；从未扫描过为同花顺） */
  source: MainlineSource;
}
