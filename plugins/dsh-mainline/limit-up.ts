/**
 * 插件 dsh-mainline（股票主线）· 涨停结构层
 *
 * 给每个行业板块补上「内部结构」指标：涨停家数 / 最高连板 / 封板资金合计。
 *
 * 数据源：东财涨停池（宿主 `fetchZtPool`，`push2ex.eastmoney.com/getTopicZTPool`）——
 * 实测 2026-09-18 返回 63 家涨停，字段含 `hybk`(行业) `lbc`(连板数) `fund`(封板资金)。
 * `date` 参数**确实生效**（实测同一只票连板数逐日递进：9/15 = 1 板 → 9/16 = 2 板 → 9/17 = 3 板），
 * 但只覆盖近端池子（一个月前的日期返回空池）→ 只能取「基准日当天」的池子。
 *
 * ⚠️ 归属映射的诚实边界：涨停池的 `hybk` 是**东财（≈申万）行业**口径，与同花顺行业板块
 * 不是同一套分类，且长名被上游截断到 4 个汉字。本模块按「等值 → 前缀（双向）→ 人工别名表」
 * 三级匹配，**匹配不到的一律计入未归属并返回给上层展示**，不做静默猜测 ——
 * 界面页头会写「全市场 N 家（未归属板块 M 家）」，让口径缺口可见。
 */
import { MAINLINE_INDUSTRY_ALIAS } from './constants';
import type { LimitUpPoolMember } from '../../host/types/plugin.types';
import type { LimitUpAggregate, LimitUpStat, MainlineDeps, ThsBoardRef } from './types';

/** 行业归属的匹配方式（用于排查与文档，不参与计算） */
export const INDUSTRY_MATCH_VIA = {
  EXACT: 'exact',
  PREFIX: 'prefix',
  ALIAS: 'alias',
} as const;

/**
 * 构造「东财行业名 → 同花顺板块」的匹配器
 *
 * 匹配顺序（每一级都要求唯一命中，避免把资金记到错误板块）：
 * 1. 等值：`半导体` → `半导体`
 * 2. 前缀：上游截断名 `光学光电` → `光学光电子`；以及带后缀的 `IT服务Ⅱ` → `IT服务`
 * 3. 别名：分类口径不同但语义等价（见 `MAINLINE_INDUSTRY_ALIAS` 的说明）
 * @param boards 板块清单
 * @returns 匹配函数（未命中返回 null）
 */
export const createIndustryMatcher = (
  boards: readonly ThsBoardRef[],
): ((industry: string) => ThsBoardRef | null) => {
  const byName = new Map(boards.map((board) => [board.name, board]));

  return (industry: string): ThsBoardRef | null => {
    if (!industry) return null;

    const exact = byName.get(industry);
    if (exact) return exact;

    // 前缀：上游把长名截断（板块名以行业名开头），或行业名带申万后缀（行业名以板块名开头）
    let forward: ThsBoardRef | null = null;
    let forwardCount = 0;
    let backward: ThsBoardRef | null = null;
    let backwardCount = 0;
    for (const board of boards) {
      if (board.name.startsWith(industry)) {
        forward = board;
        forwardCount += 1;
      } else if (industry.startsWith(board.name)) {
        backward = board;
        backwardCount += 1;
      }
    }
    if (forward && forwardCount === 1) return forward;
    if (backward && backwardCount === 1) return backward;

    const alias = MAINLINE_INDUSTRY_ALIAS[industry];
    return alias ? (byName.get(alias) ?? null) : null;
  };
};

/**
 * 把涨停池按板块聚合（未归属的单独统计，不并入任何板块）
 * @param items 涨停池成员
 * @param boards 板块清单
 * @returns 聚合结果
 */
export const aggregateLimitUp = (
  items: readonly LimitUpPoolMember[],
  boards: readonly ThsBoardRef[],
): LimitUpAggregate => {
  const match = createIndustryMatcher(boards);
  const byCode = new Map<string, LimitUpStat>();
  const unmapped = new Map<string, number>();

  for (const item of items) {
    const board = match(item.industry ?? '');
    if (!board) {
      const key = item.industry || '(无行业)';
      unmapped.set(key, (unmapped.get(key) ?? 0) + 1);
      continue;
    }
    const stat = byCode.get(board.code) ?? { count: 0, maxStreak: 0, sealFund: 0 };
    stat.count += 1;
    // 连板数缺失时按 1 板计（当日涨停即 1 板）
    stat.maxStreak = Math.max(stat.maxStreak, item.continuousBoardCount ?? 1);
    stat.sealFund += item.boardAmount ?? 0;
    byCode.set(board.code, stat);
  }

  let unmappedCount = 0;
  for (const count of unmapped.values()) unmappedCount += count;

  return {
    byCode,
    unmappedCount,
    unmappedIndustries: [...unmapped.keys()].sort(),
    total: items.length,
  };
};

/**
 * 拉取指定交易日的涨停池
 * @param deps 宿主能力集合（http / format / market / ui）
 * @param date 基准交易日（`YYYY-MM-DD`）
 * @returns 涨停池成员（上游对该日期无池子时返回空数组）
 */
export const fetchLimitUpPool = async (
  deps: MainlineDeps,
  date: string,
): Promise<LimitUpPoolMember[]> => deps.market.fetchLimitUpPool(date);
