/**
 * 插件 dsh-mainline（股票主线）· 判定层（**纯函数**，可冒烟断言、可回测）
 *
 * 与技能 `a-share-huddle-mainline/scripts/huddle_judge.py` 同一定位：
 * 只吃数据、只吐结论，不碰网络与存储。规则对应技能 `references/phase-rules.md`
 * 里**可自动计算**的那部分（成交占比分位 / 量能倍数 / 价格分位 / 板块内涨停结构），
 * 需要人工输入的（公募持仓分位、估值分位、业绩验证）本期不接入 ——
 * 判定层因此把置信度降档并在界面「本期未接入的输入」里明说，**不静默**。
 *
 * 三条铁律（技能原文，代码里落实）：
 * 1. 只输出阶段标签与风险提示，不出现任何买卖 / 仓位指令；
 * 2. 只有价格上涨、没有业绩验证 → 不判「确认抱团」，本层的「确认」仅代表
 *    「量价与拥挤度特征具备」，风险提示里明确写出「需连续两季业绩验证」；
 * 3. 必须把原始指标面板一并给出（`BoardMetrics` 原样透出，不做二次加工）。
 *
 * 口径要点（2026-09-18 按实测重做，依据见 `.ai/开发方案/2026-09-18-股票主线指标优化与数据源评估.md`）：
 * - **一切指标取基准交易日截面**（不是「各板块自己序列的最后一天」），滞后板块标 `stale`
 *   并排除出阶段判定 —— 否则 9/10 只有 20/90 板块有 bar 时会出现「有的板块在算 9/17、
 *   有的在算 9/16」而 asOf 用众数把差异掩盖掉；
 * - 量能倍数改**滞后口径**（近 5 日均额 ÷ 前 20 日均额，分母不含分子），旧口径保留作对照；
 * - 结构指标（涨停家数 / 宽度）在确认期做**正向门槛**：只有价格强、内部无涨停也无宽度的
 *   板块更可能是权重拉抬，不判「确认」；连板高度/涨停占比则只做**情绪加速标记**，不改阶段。
 */
import {
  CANDIDATE_MIN_AMOUNT_RATIO,
  CANDIDATE_MIN_SHARE_PERCENTILE,
  COLLAPSE_MAX_CHANGE5,
  COLLAPSE_MIN_PRICE_PERCENTILE,
  COLLAPSE_MIN_SHARE_PERCENTILE,
  COLLAPSE_MIN_TURNOVER_SHARE,
  CONFIRMED_MIN_AMOUNT_RATIO,
  CONFIRMED_MIN_BREADTH_PERCENT,
  CONFIRMED_MIN_LIMIT_UP,
  CONFIRMED_NEAR_HIGH_RATIO,
  GERMINATION_MAX_CHANGE5,
  GERMINATION_MAX_SHARE_PERCENTILE,
  GERMINATION_MIN_AMOUNT_RATIO,
  MAINLINE_CONFIDENCE_HIGH_DAYS,
  MAINLINE_CONFIDENCE_MEDIUM_DAYS,
  MAINLINE_LONG_WINDOW,
  MAINLINE_MIN_HISTORY_DAYS,
  MAINLINE_AMOUNT_BASELINE_LAG,
  MAINLINE_PHASE,
  MAINLINE_PHASE_DESC,
  MAINLINE_PHASE_LABEL,
  MAINLINE_PHASE_ORDER,
  MAINLINE_PHASE_WARNINGS,
  MAINLINE_PRICE_WINDOW,
  MAINLINE_SHORT_WINDOW,
  MAINLINE_SOURCE,
  MAINLINE_WARNING_NO_LIMIT_UP,
  MAINLINE_WARNING_NO_STRUCTURE,
  MAINLINE_WARNING_STALE,
  MAINLINE_WARNING_STRUCTURE_FAIL,
  MAINLINE_WARNING_STRUCTURE_HOT,
  MANIA_MIN_CHANGE20,
  MANIA_MIN_LIMIT_UP_RATIO,
  MANIA_MIN_PRICE_PERCENTILE,
  MANIA_MIN_SHARE_PERCENTILE,
  MANIA_MIN_STREAK,
  MANIA_MIN_TURNOVER_SHARE,
  PERCENT_BASE,
} from './constants';
import { countTradingDaysBetween, resolveBenchmark } from './benchmark';
import type { BoardMetrics, BoardSeries, MainlineVerdict, MarketTurnoverPoint } from './types';
import type { MainlineConfidence, MainlinePhase } from './constants';

/** 指标计算的截面上下文 */
export interface MetricContext {
  /** 全板块统一的基准交易日（各指标一律取该日截面） */
  benchmarkDate: string;
  /** 交易日历（升序，来自沪深成交额序列；用于算「滞后几个交易日」） */
  marketDates: readonly string[];
}

/**
 * 计算某个值在一串历史值中的分位（0-100）
 *
 * 口径：`≤ 该值的历史样本数 ÷ 样本总数 × 100`，即「今天的水平在历史上压过多少天」。
 * @param history 历史值（可含当天）
 * @param value 待定位的值
 * @returns 分位（0-100）；历史为空时返回 null
 */
export const percentileRank = (history: readonly number[], value: number): number | null => {
  const usable = history.filter((item) => Number.isFinite(item));
  if (usable.length === 0 || !Number.isFinite(value)) return null;
  const below = usable.filter((item) => item <= value).length;
  return (below / usable.length) * PERCENT_BASE;
};

/**
 * 构建「交易日 → 沪深两市总成交额（元）」映射
 * @param market 沪深成交额序列
 * @returns 日期映射
 */
export const buildMarketMap = (
  market: readonly MarketTurnoverPoint[],
): Map<string, number> =>
  new Map(
    market
      .filter((point) => point.date && Number.isFinite(point.totalAmount) && point.totalAmount > 0)
      .map((point) => [point.date, point.totalAmount]),
  );

/**
 * 取序列尾部窗口的均值
 * @param values 数值序列
 * @param window 窗口长度
 * @returns 均值；序列为空返回 null
 */
const averageOfTail = (values: readonly number[], window: number): number | null => {
  const tail = values.slice(-window);
  if (tail.length === 0) return null;
  return tail.reduce((sum, item) => sum + item, 0) / tail.length;
};

/**
 * 近 N 个交易日累计涨跌幅（%）
 *
 * 用收盘价比值而非逐日涨跌幅相加：后者会忽略复利效应，长窗口下偏差可观。
 * 样本不足 N+1 天时退化为「可用区间的累计涨跌幅」。
 * @param series 板块序列（升序）
 * @param window 交易日窗口
 * @returns 累计涨跌幅（%）；样本不足 2 天返回 0
 */
const trailingChange = (series: BoardSeries['days'], window: number): number => {
  if (series.length < 2) return 0;
  const last = series[series.length - 1];
  const fromIndex = Math.max(0, series.length - 1 - window);
  const base = series[fromIndex];
  if (!last || !base || base.close <= 0) return 0;
  return ((last.close - base.close) / base.close) * PERCENT_BASE;
};

/**
 * 计算单板块的全部原始指标（按基准交易日截面）
 * @param series 板块日线序列（升序）
 * @param marketMap 交易日 → 沪深总成交额（元）
 * @param context 截面上下文（基准日 + 交易日历）
 * @returns 指标面板
 */
export const computeMetrics = (
  series: BoardSeries,
  marketMap: ReadonlyMap<string, number>,
  context: MetricContext,
): BoardMetrics => {
  const days = series.days;
  const last = days[days.length - 1] ?? null;
  const benchmarkDay = days.find((day) => day.date === context.benchmarkDate) ?? null;
  const stale = benchmarkDay === null;

  const metrics: BoardMetrics = {
    asOf: '',
    source: series.source ?? MAINLINE_SOURCE.THS,
    benchmarkDate: context.benchmarkDate,
    stale,
    staleDays: 0,
    historyDays: days.length,
    latestChange: 0,
    change5: 0,
    change20: 0,
    amount: null,
    turnoverShare: null,
    sharePercentile: null,
    amountRatio: null,
    amountRatioOverlap: null,
    pricePercentile: null,
    limitUpCount: null,
    maxStreak: null,
    sealFund: null,
    limitUpRatio: null,
    breadth: null,
    riseCount: null,
    fallCount: null,
    netInflow: null,
    leaderName: '',
  };
  if (!last) return metrics;

  // 滞后板块退回自己的最后一天算指标（数值仍如实展示，但阶段判定会排除它），
  // 不滞后时 reference 就是基准日 —— 全板块同一截面
  const reference = benchmarkDay ?? last;
  metrics.asOf = reference.date;
  metrics.staleDays = stale
    ? countTradingDaysBetween(context.marketDates, reference.date, context.benchmarkDate)
    : 0;

  // 只取不晚于截面日的样本（防御：库里若残留未落定日的行也不会混进分位序列）
  const scoped = days.filter((day) => day.date <= reference.date);

  // 成交占比序列：仅保留「当日成交额与全市场成交额都有」的交易日
  const shares: number[] = [];
  for (const day of scoped) {
    const total = marketMap.get(day.date);
    if (!total || day.amount <= 0) continue;
    shares.push((day.amount / total) * PERCENT_BASE);
  }
  const referenceTotal = marketMap.get(reference.date);
  const turnoverShare =
    referenceTotal && reference.amount > 0 ? (reference.amount / referenceTotal) * PERCENT_BASE : null;

  // 量能倍数：分子 = 近 5 日均额；分母 = 前 20 日均额（不含最近 5 日，避免分子污染分母）
  const amounts = scoped.map((day) => day.amount).filter((amount) => amount > 0);
  const shortAverage = averageOfTail(amounts, MAINLINE_SHORT_WINDOW);
  const laggedPool = amounts.slice(0, Math.max(0, amounts.length - MAINLINE_AMOUNT_BASELINE_LAG));
  const laggedAverage = averageOfTail(laggedPool, MAINLINE_LONG_WINDOW);
  const overlapAverage = averageOfTail(amounts, MAINLINE_LONG_WINDOW);

  const closes = scoped.map((day) => day.close);
  const pricePercentile = percentileRank(closes.slice(-MAINLINE_PRICE_WINDOW), reference.close);

  // 结构指标（只有基准日那一行带，历史行没有 → null 与 0 必须区分）
  const riseCount = reference.riseCount ?? null;
  const fallCount = reference.fallCount ?? null;
  const counted = riseCount !== null && fallCount !== null ? riseCount + fallCount : 0;
  const limitUpCount = reference.limitUpCount ?? null;

  return {
    ...metrics,
    latestChange: reference.changePercent,
    change5: trailingChange(scoped, MAINLINE_SHORT_WINDOW),
    change20: trailingChange(scoped, MAINLINE_LONG_WINDOW),
    amount: reference.amount > 0 ? reference.amount : null,
    turnoverShare,
    sharePercentile:
      turnoverShare !== null && shares.length > 0 ? percentileRank(shares, turnoverShare) : null,
    amountRatio:
      shortAverage !== null && laggedAverage !== null && laggedAverage > 0
        ? shortAverage / laggedAverage
        : null,
    amountRatioOverlap:
      shortAverage !== null && overlapAverage !== null && overlapAverage > 0
        ? shortAverage / overlapAverage
        : null,
    pricePercentile,
    limitUpCount,
    maxStreak: reference.maxStreak ?? null,
    sealFund: reference.sealFund ?? null,
    limitUpRatio: limitUpCount !== null && counted > 0 ? (limitUpCount / counted) * PERCENT_BASE : null,
    breadth: riseCount !== null && counted > 0 ? (riseCount / counted) * PERCENT_BASE : null,
    riseCount,
    fallCount,
    netInflow: reference.netInflow ?? null,
    leaderName: reference.leaderName ?? '',
  };
};

/**
 * 由样本天数推置信度（样本不足 → 低档，界面据此提示）
 * @param historyDays 历史样本交易日数
 * @returns 置信度档位
 */
export const resolveConfidence = (historyDays: number): MainlineConfidence => {
  if (historyDays >= MAINLINE_CONFIDENCE_HIGH_DAYS) return 'high';
  if (historyDays >= MAINLINE_CONFIDENCE_MEDIUM_DAYS) return 'medium';
  return 'low';
};

/**
 * 板块内部结构是否支持「确认期」
 *
 * 结构数据未采集（`limitUpCount === null`）时**不因此否决**（不能让取数失败变成降级判定）；
 * 采到了就要求「至少 1 家涨停」或「宽度 ≥ 60%」—— 内部普跌的板块即便价格强也不是抱团主线。
 * @param metrics 指标面板
 * @returns 是否支持
 */
export const isStructureSupporting = (metrics: BoardMetrics): boolean => {
  if (metrics.limitUpCount === null) return true;
  if (metrics.limitUpCount >= CONFIRMED_MIN_LIMIT_UP) return true;
  return metrics.breadth !== null && metrics.breadth >= CONFIRMED_MIN_BREADTH_PERCENT;
};

/**
 * 板块是否处于「情绪加速」（连板梯队成型 / 涨停占比到档）
 *
 * 只用于展示与追加风险提示，**不参与阶段判定** —— 目前只有单日结构样本，不足以定阶段门槛。
 * @param metrics 指标面板
 * @returns 是否情绪加速
 */
export const isStructureHot = (metrics: BoardMetrics): boolean =>
  (metrics.maxStreak ?? 0) >= MANIA_MIN_STREAK ||
  (metrics.limitUpRatio ?? 0) >= MANIA_MIN_LIMIT_UP_RATIO;

/**
 * 阶段判定（按「先极端、后成型、再萌芽」的顺序短路）
 * @param metrics 指标面板
 * @returns 阶段
 */
export const resolvePhase = (metrics: BoardMetrics): MainlinePhase => {
  const {
    sharePercentile,
    turnoverShare,
    change5,
    change20,
    amountRatio,
    pricePercentile,
    historyDays,
  } = metrics;

  // 滞后板块的指标不是基准日截面，与其它板块不可比 → 不下结论（界面同时给出滞后天数）
  if (metrics.stale) return MAINLINE_PHASE.UNKNOWN;

  // 样本不足时不下结论 —— 缺样本 ≠ 状态正常
  if (historyDays < MAINLINE_MIN_HISTORY_DAYS || sharePercentile === null) {
    return MAINLINE_PHASE.UNKNOWN;
  }

  // 瓦解优先于狂热：两者都「拥挤 + 价格高位」，差别只在**是否已经转弱** ——
  // 已经从高位放量下跌的板块，先按瓦解定性（否则会被狂热的分支截胡）
  if (
    sharePercentile >= COLLAPSE_MIN_SHARE_PERCENTILE &&
    turnoverShare !== null &&
    turnoverShare >= COLLAPSE_MIN_TURNOVER_SHARE &&
    pricePercentile !== null &&
    pricePercentile >= COLLAPSE_MIN_PRICE_PERCENTILE &&
    change5 <= COLLAPSE_MAX_CHANGE5
  ) {
    return MAINLINE_PHASE.COLLAPSE;
  }

  // 狂热 = 拥挤到历史极值 + 赔率恶化（价格/中期涨幅处于高位），二者缺一不成立
  const crowded = sharePercentile >= MANIA_MIN_SHARE_PERCENTILE;
  const bigEnough = turnoverShare !== null && turnoverShare >= MANIA_MIN_TURNOVER_SHARE;
  const pricedHigh =
    (pricePercentile !== null && pricePercentile >= MANIA_MIN_PRICE_PERCENTILE) ||
    change20 >= MANIA_MIN_CHANGE20;
  if (crowded && bigEnough && pricedHigh) {
    return MAINLINE_PHASE.MANIA;
  }

  if (
    amountRatio !== null &&
    amountRatio >= CONFIRMED_MIN_AMOUNT_RATIO &&
    change5 > 0 &&
    pricePercentile !== null &&
    pricePercentile >= CONFIRMED_NEAR_HIGH_RATIO * PERCENT_BASE &&
    sharePercentile >= GERMINATION_MAX_SHARE_PERCENTILE &&
    isStructureSupporting(metrics)
  ) {
    // 不设占比分位上限：占比已到极值但涨幅尚未加速的，仍属「确认后期」而非「未成主线」；
    // 真正的狂热要「拥挤 + 加速」同时成立（在上面的分支里判定）
    return MAINLINE_PHASE.CONFIRMED;
  }
  if (
    amountRatio !== null &&
    amountRatio >= GERMINATION_MIN_AMOUNT_RATIO &&
    sharePercentile < GERMINATION_MAX_SHARE_PERCENTILE &&
    change5 > 0 &&
    change5 <= GERMINATION_MAX_CHANGE5
  ) {
    return MAINLINE_PHASE.GERMINATION;
  }
  return MAINLINE_PHASE.NONE;
};

/**
 * 组装风险提示（阶段固定文案 + 本期实测到的上下文提示，一律状态语言）
 * @param metrics 指标面板
 * @param phase 已判定阶段
 * @param structureSupports 内部结构是否支持确认期
 * @returns 提示数组
 */
export const buildWarnings = (
  metrics: BoardMetrics,
  phase: MainlinePhase,
  structureSupports: boolean,
): readonly string[] => {
  const warnings: string[] = [];

  if (metrics.stale) warnings.push(MAINLINE_WARNING_STALE(metrics.staleDays));
  if (metrics.limitUpCount === null && !metrics.stale) warnings.push(MAINLINE_WARNING_NO_STRUCTURE);

  warnings.push(...MAINLINE_PHASE_WARNINGS[phase]);

  if (
    phase === MAINLINE_PHASE.NONE &&
    !structureSupports &&
    metrics.limitUpCount !== null &&
    metrics.breadth !== null
  ) {
    warnings.push(MAINLINE_WARNING_STRUCTURE_FAIL(metrics.limitUpCount, metrics.breadth));
  }
  if (
    phase === MAINLINE_PHASE.CONFIRMED &&
    metrics.limitUpCount === 0 &&
    metrics.breadth !== null
  ) {
    warnings.push(MAINLINE_WARNING_NO_LIMIT_UP(metrics.breadth));
  }
  if (isStructureHot(metrics)) {
    warnings.push(MAINLINE_WARNING_STRUCTURE_HOT(metrics.maxStreak ?? 0, metrics.limitUpRatio ?? 0));
  }
  return warnings;
};

/**
 * 判定单个板块
 * @param series 板块日线序列
 * @param marketMap 交易日 → 沪深总成交额（元）
 * @param context 截面上下文
 * @returns 判定结论（阶段 + 风险提示 + 原始指标面板）
 */
export const judgeBoard = (
  series: BoardSeries,
  marketMap: ReadonlyMap<string, number>,
  context: MetricContext,
): MainlineVerdict => {
  const metrics = computeMetrics(series, marketMap, context);
  const phase = resolvePhase(metrics);
  const structureSupports = isStructureSupporting(metrics);
  const candidate =
    (metrics.sharePercentile !== null &&
      metrics.sharePercentile >= CANDIDATE_MIN_SHARE_PERCENTILE) ||
    (metrics.amountRatio !== null && metrics.amountRatio >= CANDIDATE_MIN_AMOUNT_RATIO);

  return {
    code: series.code,
    name: series.name,
    phase,
    phaseLabel: MAINLINE_PHASE_LABEL[phase],
    phaseDesc: MAINLINE_PHASE_DESC[phase],
    candidate,
    confidence: resolveConfidence(metrics.historyDays),
    structureHot: isStructureHot(metrics),
    warnings: buildWarnings(metrics, phase, structureSupports),
    metrics,
  };
};

/**
 * 判定全部板块并排序（阶段严重度优先，同阶段按成交占比分位降序）
 * @param boards 全部板块序列
 * @param market 沪深成交额序列
 * @param now 当前时间（决定基准日；缺省取当前时刻，测试可传入固定时间）
 * @returns 判定结论数组
 */
export const judgeAll = (
  boards: readonly BoardSeries[],
  market: readonly MarketTurnoverPoint[],
  now: Date = new Date(),
): MainlineVerdict[] => {
  const marketMap = buildMarketMap(market);
  const benchmark = resolveBenchmark(boards, market, now);
  const context: MetricContext = {
    benchmarkDate: benchmark.date,
    marketDates: market.map((point) => point.date).sort(),
  };
  return boards
    .map((series) => judgeBoard(series, marketMap, context))
    .sort((a, b) => {
      const byPhase = MAINLINE_PHASE_ORDER[a.phase] - MAINLINE_PHASE_ORDER[b.phase];
      if (byPhase !== 0) return byPhase;
      return (b.metrics.sharePercentile ?? -1) - (a.metrics.sharePercentile ?? -1);
    });
};
