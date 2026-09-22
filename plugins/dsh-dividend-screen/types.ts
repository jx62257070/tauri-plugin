/**
 * 插件 dsh-dividend-screen（股息筛选）· 类型定义
 *
 * 数据流：clist 排行（`RankBaseRow`）→ 三个报告期的业绩（`PerfRow`）→
 * 两个报告期的分红（`DividendAggregate`）→ `buildScreenRow` 合成落库行
 * （`DividendScreenRow`，自算口径的全部指标都已算好，读库即渲染）。
 */
import type { ProjectStatus } from './constants';
// 宿主服务契约只需要**类型**：`import type` 打包后完全消失，产物里不存在任何
// 宿主模块的引用，但源码仍然享受完整的类型检查
import type {
  FormatService,
  HttpService,
  StockOpenService,
  UiKitService,
} from '../../host/types/plugin.types';

/**
 * 插件运行所需的宿主能力（依赖注入容器）
 *
 * 为什么不直接在模块里 import：本插件最终以**单文件产物**形态分发，
 * 运行时拿不到宿主模块，只能由 `plugin.ts` 在 `apply(ctx)` 里把服务取好、
 * 沿调用链传下来。同时也让依赖显式化 —— 看这一个对象就知道插件用了宿主什么。
 */
export interface DividendDeps {
  /** 受控网络请求（走宿主上游通道，域名白名单内） */
  http: HttpService;
  /** 格式化与涨跌语义（百分比 / 涨跌色 / 限速节拍） */
  format: FormatService;
  /** 宿主 UI Kit（卡片 / 表格 / 按钮 / 标签 / 空态 / 图标） */
  ui: UiKitService;
  /** 全站统一的个股打开交互（右侧详情侧栏 / 详情整页） */
  stockOpen: StockOpenService;
}

/** clist 股息率排行的一行（东财 TTM 口径快照） */
export interface RankBaseRow {
  /** 6 位裸代码（如 `603165`） */
  code: string;
  /** 股票名称 */
  name: string;
  /** 现价（元） */
  price: number | null;
  /** 当日涨跌幅（%） */
  changePercent: number | null;
  /** 总市值（元） */
  marketCap: number | null;
  /** 市净率 */
  pb: number | null;
  /** 总股本（股） */
  totalShares: number | null;
  /** 市盈率 TTM */
  peTtm: number | null;
  /**
   * 股息率（%，东财 `f133` 字段）。
   * ⚠️ 实测口径并非「近 12 个月」：f133 = 最新年报期分红 ÷ 现价（招商银行 2026-09-20 实测，
   * f133=2.47% 只含 2025 年度末期 10 派 10.03，漏掉除息日在近 12 个月内的中期 10 派 10.13）。
   * 一年多次分红的个股会被系统性低估 → 本字段只用于**选样本池**，展示口径由本插件自算。
   */
  ttmYield: number | null;
}

/** 业绩报表一行（单报告期） */
export interface PerfRow {
  /** 6 位裸代码 */
  code: string;
  /** 归母净利润（元；缺失为 null —— 未披露 / 字段为空都不当 0） */
  netProfit: number | null;
  /** 净利润同比（%，上游口径） */
  netProfitYoY: number | null;
  /** 营业收入同比（%，上游口径） */
  revenueYoY: number | null;
  /** 行业（东财口径，如 `造纸`） */
  industry: string;
  /** 每股经营活动现金流（元；年报口径 = 全年 OCF ÷ 总股本；缺失为 null） */
  ocfPerShare: number | null;
}

/** 分红明细单个事件（一个分配方案一行） */
export interface DividendEvent {
  /** 6 位裸代码 */
  code: string;
  /** 该方案每股派息（元，含税；`PRETAX_BONUS_RMB ÷ 10`，纯转增为 0） */
  dps: number;
  /** 派息方案公告时的总股本（股） */
  totalShares: number | null;
  /** 方案所属报告期（`YYYY-MM-DD`，多期合并查询后按期分组用） */
  reportDate: string;
  /** 除权除息日（`YYYY-MM-DD`；未实施为 null —— TTM 归集的锚点字段） */
  exDate: string | null;
}

/** 分红明细按（代码 × 报告期）聚合后的结果（单报告期） */
export interface DividendAggregate {
  /** 6 位裸代码 */
  code: string;
  /** 该报告期每股派息合计（元；同一报告期可能有多条方案，求和） */
  dps: number;
  /** 最后一条方案公告时的总股本（股） */
  totalShares: number | null;
  /** 实施日（除权除息日，`YYYY-MM-DD`；多条方案取最新，全部未实施为 null） */
  exDate: string | null;
}

/** 资产负债表摘要一行（负债率） */
export interface DebtSnapshot {
  /** 6 位裸代码 */
  code: string;
  /** 资产负债率（%，真值小数） */
  ratio: number;
  /** 报告期（`YYYY-MM-DD`，取该股已披露的最新一期） */
  reportDate: string;
}

/** 推算合成后的落库行（全部展示指标已算好） */
export interface DividendScreenRow {
  /** 6 位裸代码 */
  code: string;
  /** 股票名称 */
  name: string;
  /** 行业（东财口径） */
  industry: string;
  /** 现价（元） */
  price: number | null;
  /** 当日涨跌幅（%） */
  changePercent: number | null;
  /** 总市值（元） */
  marketCap: number | null;
  /** 市净率 */
  pb: number | null;
  /** 市盈率 TTM */
  peTtm: number | null;
  /** 总股本（股，取排行快照的现值） */
  totalShares: number | null;
  /**
   * TTM 股息率（%，自算 = 近 12 个月内除权除息的每股派息合计 ÷ 现价）。
   * 与同花顺「股息率(TTM)」同口径；东财 f133（最新年报期分红 ÷ 现价）只用于选样本池，
   * 一年多次分红的个股（如招商银行 2025 年度中期 + 末期各派一次）f133 会低估一半。
   * 分红史未采集时回退 f133 值。
   */
  ttmYield: number | null;
  /** 去年每股分红（元；无分红记录为 0） */
  dpsLast: number;
  /** 去年分红总额（元） */
  dividendTotalLast: number | null;
  /** 去年全年归母净利（元） */
  netProfitFyLast: number | null;
  /** 去年分红率（0-1，可为 null = 不可得） */
  payoutLast: number | null;
  /** 今年中报归母净利（元） */
  netProfitH1: number | null;
  /** 去年中报归母净利（元） */
  netProfitH1Last: number | null;
  /** 净利同比（%，上游口径；今年中报 ÷ 去年中报的增速） */
  netProfitYoY: number | null;
  /** 营收同比（%，上游口径） */
  revenueYoY: number | null;
  /** 中报净利比（今年 ÷ 去年；不可比为 null） */
  growthH1: number | null;
  /** 预计今年全年净利（元；不可推算为 null） */
  projectedNetProfit: number | null;
  /** 推算今年每股分红（元；不可推算为 null） */
  projectedDps: number | null;
  /** 推算今年股息率（%；不可推算为 null） */
  projectedYield: number | null;
  /** 去年股息率（%，自算 = 去年每股分红 ÷ 现价） */
  yieldLast: number | null;
  /** 今年中期已宣派每股分红（元；无记录为 null） */
  interimDps: number | null;
  /**
   * 连续分红年数（从去年年报往前数连续有现金分红的年度数；去年无分红 = 0；
   * 旧快照未采集分红史为 null —— 规则评估按「数据缺失」处理）
   */
  dividendYears: number | null;
  /** 去年全年每股经营现金流（元；缺失为 null） */
  ocfPerShareLast: number | null;
  /**
   * 去年经营现金流对分红的覆盖倍数（每股经营现金流 ÷ 每股分红；
   * 无分红或现金流缺失为 null —— 无分红时「覆盖」无意义，规则按缺失处理）
   */
  cashCoverLast: number | null;
  /** 资产负债率（%，最新已披露报告期；缺失为 null） */
  debtRatio: number | null;
  /** 推算状态 */
  status: ProjectStatus;
}

/** 扫描元信息（落库，界面页头展示） */
export interface DividendScanMeta {
  /** 扫描完成时间（毫秒时间戳） */
  scannedAt: number;
  /** 本次样本池档位 */
  universeLimit: number;
  /** 上游全市场行数（clist `total`） */
  universeTotal: number | null;
  /** 实际落库行数 */
  rowCount: number;
  /** 已披露中报的行数 */
  publishedCount: number;
  /** 状态为可推算的行数 */
  projectableCount: number;
  /** 参与推算的四个报告期（ISO 日期） */
  periods: {
    /** 今年中报（如 `2026-06-30`） */
    h1: string;
    /** 去年中报（如 `2025-06-30`） */
    h1Last: string;
    /** 去年年报（分红率与全年净利的基期，如 `2025-12-31`） */
    fyLast: string;
    /** 今年中期分红（信息展示用，如 `2026-06-30`） */
    interim: string;
  };
  /** 扫描过程中的降级与告警（空数组 = 一切正常） */
  warnings: string[];
}

/** 扫描进度载荷 */
export interface DividendScanProgress {
  /** 已完成请求数 */
  done: number;
  /** 预计请求总数 */
  total: number;
}

/** 规则分组 */
export type RuleGroup = 'filter' | 'exclude';

/** 规则参数表（键 = 参数字段名；数值参数一律用展示单位：百分比、倍数、个数） */
export type RuleParams = Record<string, number | string>;

/** 用户可配置的一条规则实例 */
export interface RuleConfig {
  /** 实例 id（持久化后稳定；预置规则用固定前缀） */
  id: string;
  /** 规则类型键（`DIVIDEND_RULE_TYPE` 的值之一；未知类型在加载时被丢弃） */
  type: string;
  /** 分组：筛选（全部满足才保留）/ 排除（命中即剔除并标原因） */
  group: RuleGroup;
  /** 是否启用（停用的规则不参与评估，配置保留） */
  enabled: boolean;
  /** 参数（缺键时回退该类型的默认值） */
  params: RuleParams;
}

/** 参数字段描述（UI 据此渲染输入框） */
export interface RuleParamField {
  /** 参数键 */
  key: string;
  /** 输入框标签 */
  label: string;
  /** 输入类型：数值（number）/ 文本（text，逗号分隔关键词） */
  kind: 'number' | 'text';
  /** 默认值 */
  fallback: number | string;
  /** 数值参数的单位后缀（展示用，如 `%` / `×` / `年`） */
  unit?: string;
}

/** 单条规则对一行数据的判定结果：true = 命中 / false = 不命中 / null = 数据缺失 */
export type RuleVerdict = boolean | null;

/** 规则匹配结果（一行数据 × 全部启用规则） */
export interface RuleMatchResult {
  /** 是否通过（无启用规则 = 通过；任一排除规则命中或筛选规则未满足 = 不通过） */
  pass: boolean;
  /** 命中的排除规则文案（伪高股息原因） */
  excludeReasons: string[];
  /** 未满足的筛选规则文案（含「数据缺失」标注） */
  failedFilters: string[];
}

