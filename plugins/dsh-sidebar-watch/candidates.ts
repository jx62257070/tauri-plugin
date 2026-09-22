/**
 * 插件 dsh-sidebar-watch · 候选池纯函数层
 *
 * 无 Vue / 无数据库依赖，可被冒烟断言直跑（`.ai/tmp` 里的 ts-smoke-harness 用例）。
 */
import type { WatchCandidate } from './service';

/**
 * 过滤出「仍在自选股里」的候选
 *
 * 候选池是用户逐只点出来的，但自选股会被删（删单只 / 删分组 / 清空）：
 * 面板只渲染候选池与当前自选股的交集 —— 已删掉的票自然从面板消失，
 * 既不会出现「盯盘里还挂着一只已不在自选的票」这种迷惑状态，
 * 也不会因为取不到行情 / 名称而报错。
 *
 * 库里那条候选记录**保留**（不静默删数据）：用户重新把票加回自选，标记即自动恢复。
 * @param candidates 候选池（按加入顺序）
 * @param watchlistSymbols 当前自选股符号列表
 * @returns 仍有效的候选（保持原顺序）
 */
export const filterCandidatesByWatchlist = (
  candidates: readonly WatchCandidate[],
  watchlistSymbols: readonly string[],
): WatchCandidate[] => {
  const known = new Set(watchlistSymbols);
  return candidates.filter((candidate) => known.has(candidate.symbol));
};
