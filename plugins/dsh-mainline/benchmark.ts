/**
 * 插件 dsh-mainline（股票主线）· 数据完整性层（**纯函数**，可冒烟断言）
 *
 * 解决的问题（实测依据见 `.ai/开发方案/2026-09-18-股票主线指标优化与数据源评估.md`）：
 * 1. **基准日不统一**：原先每个指标各取「自己序列的最后一天」，而板块年 K 的更新是异步的
 *    （2026-09-10 仅 20/90 板块有当日 bar、09-18 盘中仅 68/90）→ 有的板块在算 09-17、
 *    有的在算 09-16，asOf 取众数把差异掩盖掉了，横截面比较是错的。
 * 2. **盘中半日 bar 污染历史**：盘中扫描时分子是「部分板块的半日/整日混合」、分母是半日全市场，
 *    实测「板块合计 ÷ 两市」= 35.6%，而完整交易日稳定在 98.5%；半日 bar 一旦落库会覆盖同日，
 *    收盘后不重扫就永久污染占比分位序列（且不会自愈）→ 未落定日的 bar 一律不写入。
 */
import { MAINLINE_BENCHMARK_COVERAGE_RATIO, MAINLINE_SETTLE_MINUTES } from './constants';
import type { BoardSeries, MarketTurnoverPoint } from './types';

/** 基准日解析结果 */
export interface BenchmarkResolution {
  /** 基准交易日（全板块统一的指标口径日）；无法确定时为空串 */
  date: string;
  /** 基准日有行情的板块数 */
  coverage: number;
  /** 板块总数 */
  total: number;
  /** 因「尚未落定」被排除的日期（空串 = 无） */
  excludedDate: string;
  /** 是否降级（没有任何日期达到覆盖率门槛，退回了覆盖最全的一天） */
  degraded: boolean;
}

/**
 * 本地日期字符串（YYYY-MM-DD，本地时区）
 * @param date 时间
 * @returns 本地日期串
 */
export const toLocalDateString = (date: Date): string => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * 当日数据是否已落定（本地时间 ≥ 收盘 + 落定缓冲）
 * @param now 当前时间
 * @returns true 表示当日 bar 可信
 */
export const isDataSettled = (now: Date): boolean =>
  now.getHours() * 60 + now.getMinutes() >= MAINLINE_SETTLE_MINUTES;

/**
 * 统计每个交易日「有行情 bar 的板块数」（同一板块同日重复计一次）
 * @param boards 全部板块序列
 * @returns 日期 → 板块数
 */
export const buildCoverageMap = (boards: readonly BoardSeries[]): Map<string, number> => {
  const coverage = new Map<string, number>();
  for (const series of boards) {
    const seen = new Set<string>();
    for (const day of series.days) {
      if (!day.date || seen.has(day.date)) continue;
      seen.add(day.date);
      coverage.set(day.date, (coverage.get(day.date) ?? 0) + 1);
    }
  }
  return coverage;
};

/**
 * 解析全板块统一的基准交易日
 *
 * 取「最近一个（排除未落定日）有行情板块数 ≥ 板块总数 × 覆盖率门槛」的交易日；
 * 都不达标时退回覆盖最全的一天并把 `degraded` 置真（界面据此提示，不静默当正常用）。
 * @param boards 全部板块序列
 * @param market 沪深成交额序列（提供交易日日历）
 * @param now 当前时间（用于判定当日是否已落定）
 * @returns 基准日解析结果
 */
export const resolveBenchmark = (
  boards: readonly BoardSeries[],
  market: readonly MarketTurnoverPoint[],
  now: Date,
): BenchmarkResolution => {
  const total = boards.length;
  const coverage = buildCoverageMap(boards);
  const marketDates = market
    .map((point) => point.date)
    .filter((date) => date.length > 0)
    .sort();

  const today = toLocalDateString(now);
  // 当日 bar 只在「盘中/未落定」时被排除 —— 收盘落定后（≥15:30）当日就是合法的基准日
  const excludedDate = marketDates.includes(today) && !isDataSettled(now) ? today : '';
  const threshold = Math.ceil(total * MAINLINE_BENCHMARK_COVERAGE_RATIO);

  let best = '';
  let bestCoverage = 0;
  for (let index = marketDates.length - 1; index >= 0; index -= 1) {
    const date = marketDates[index];
    if (date === excludedDate) continue;
    const count = coverage.get(date) ?? 0;
    if (count > bestCoverage) {
      best = date;
      bestCoverage = count;
    }
    if (count >= threshold) {
      return { date, coverage: count, total, excludedDate, degraded: false };
    }
  }

  return { date: best, coverage: bestCoverage, total, excludedDate, degraded: best !== '' };
};

/**
 * 统计两个日期之间的交易日数（`from` 不含、`to` 含）
 * @param marketDates 交易日历（升序）
 * @param from 起始日期（不含）
 * @param to 结束日期（含）
 * @returns 交易日数
 */
export const countTradingDaysBetween = (
  marketDates: readonly string[],
  from: string,
  to: string,
): number => marketDates.filter((date) => date > from && date <= to).length;

/**
 * 裁掉基准日之后的行情（未落定日的半日 bar 一律不写入历史）
 *
 * 没有任何行需要裁时原样返回同一引用，避免无谓的响应式更新。
 * @param boards 全部板块序列
 * @param date 基准交易日（空串表示不裁剪）
 * @returns 裁剪后的板块序列
 */
export const trimAfter = (boards: readonly BoardSeries[], date: string): BoardSeries[] => {
  if (date.length === 0) return [...boards];
  return boards.map((series) =>
    series.days.some((day) => day.date > date)
      ? { ...series, days: series.days.filter((day) => day.date <= date) }
      : series,
  );
};
