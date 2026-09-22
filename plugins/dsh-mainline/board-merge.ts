/**
 * 插件 dsh-mainline（股票主线）· 日线合并与基准日富化（**纯函数**，可冒烟断言）
 *
 * 单独成模块的原因：这两件事都只吃数据结构、不碰网络与存储，而 `scan.ts` 是编排层
 * （会拉起整条 API/SDK 依赖链）—— 放这里才能被冒烟直接验证。
 *
 * 关键约定：**结构字段（涨停/宽度/净流入）默认保留**。年 K 只带价量，
 * 若直接以年 K 覆盖，上次扫描采到的结构数据会在下次扫描时被抹掉，而涨停池只覆盖近端日期、
 * 抹掉就补不回来。
 */
import type { BoardDaily, BoardSeries, BoardSnapshot, LimitUpStat } from './types';

/** 基准日的结构数据（清单页快照 + 涨停池聚合，任一可为空表示未采集） */
export interface BenchmarkStructure {
  /** 板块代码 → 清单页快照（空 Map = 快照与基准日不同源，未采用） */
  snapshots: ReadonlyMap<string, BoardSnapshot>;
  /** 板块代码 → 涨停结构；null = 涨停池未采集成功 */
  limitUp: ReadonlyMap<string, LimitUpStat> | null;
}

/**
 * 合并同一日的两条行情（新数据覆盖价量，但**保留已采到的结构字段**）
 *
 * ⚠️ `undefined` 与 `0` 语义不同：未采集是 `undefined`，采到且确实为 0 家涨停是 `0`，
 * 所以这里用 `??` 而不是 `||` —— 新数据明确给了 0 就以 0 为准。
 * @param previous 本地已有行
 * @param incoming 本次年 K 行
 * @returns 合并后的行
 */
export const mergeDaily = (previous: BoardDaily, incoming: BoardDaily): BoardDaily => ({
  ...incoming,
  riseCount: incoming.riseCount ?? previous.riseCount,
  fallCount: incoming.fallCount ?? previous.fallCount,
  netInflow: incoming.netInflow ?? previous.netInflow,
  leaderName: incoming.leaderName ?? previous.leaderName,
  limitUpCount: incoming.limitUpCount ?? previous.limitUpCount,
  maxStreak: incoming.maxStreak ?? previous.maxStreak,
  sealFund: incoming.sealFund ?? previous.sealFund,
});

/**
 * 合并新旧日线序列（按日期去重，新数据覆盖旧数据，升序返回）
 * @param existing 本地已有序列
 * @param incoming 本次拉取序列
 * @returns 合并后的序列
 */
export const mergeDays = (
  existing: readonly BoardDaily[],
  incoming: readonly BoardDaily[],
): BoardDaily[] => {
  const merged = new Map<string, BoardDaily>();
  for (const day of existing) merged.set(day.date, day);
  for (const day of incoming) {
    const previous = merged.get(day.date);
    merged.set(day.date, previous ? mergeDaily(previous, day) : day);
  }
  return [...merged.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
};

/**
 * 把结构指标写到基准日那一行
 *
 * 只有该板块**确实有基准日的行情 bar** 才写：滞后板块不硬塞（否则等于用别的日期的
 * 结构数据冒充基准日），它会在判定层被标 `stale` 并排除出阶段判定。
 * @param series 板块序列
 * @param date 基准交易日
 * @param structure 结构数据
 * @returns 富化后的序列（无需改动时返回原引用）
 */
export const enrichBenchmarkDay = (
  series: BoardSeries,
  date: string,
  structure: BenchmarkStructure,
): BoardSeries => {
  const index = series.days.findIndex((day) => day.date === date);
  if (index < 0) return series;

  const previous = series.days[index];
  const snapshot = structure.snapshots.get(series.code);
  // 涨停池是全市场枚举：没有该板块的条目就是「确实 0 家涨停」，而不是「没采到」
  const stat = structure.limitUp?.get(series.code);

  const enriched: BoardDaily = {
    ...previous,
    riseCount: snapshot?.riseCount ?? previous.riseCount,
    fallCount: snapshot?.fallCount ?? previous.fallCount,
    netInflow: snapshot?.netInflow ?? previous.netInflow,
    leaderName: snapshot?.leaderName || previous.leaderName,
    limitUpCount: structure.limitUp ? (stat?.count ?? 0) : previous.limitUpCount,
    maxStreak: structure.limitUp ? (stat?.maxStreak ?? 0) : previous.maxStreak,
    sealFund: structure.limitUp ? (stat?.sealFund ?? 0) : previous.sealFund,
  };

  const days = [...series.days];
  days[index] = enriched;
  return { ...series, days };
};
