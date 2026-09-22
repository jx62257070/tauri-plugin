/**
 * 插件 dsh-mainline（股票主线）· 看板筛选（纯函数）
 *
 * 抽成纯函数是为了守住一条容易做砸的不变量：**徽标上的数字 = 点它之后表里的行数**。
 * 界面把「阶段计数」和「阶段过滤」分开写时极易漂移（计数用了全量、过滤用了候选后的量，
 * 或计数含阶段筛选而过滤不含），用户就会看到「显示 39、点进去 12」。
 * 这里把两个动作放在同一份 `MainlineFilterOptions` 语义下，并由冒烟断言锁死。
 */
import { MAINLINE_PHASE_LIST } from './constants';
import type { MainlinePhase } from './constants';
import type { MainlineFilterOptions, MainlineVerdict } from './types';

/** 每个阶段的板块数（用来喂徽标数字） */
export type MainlinePhaseCounts = Record<MainlinePhase, number>;

/**
 * 按筛选条件过滤判定结论
 *
 * 「候选」与「阶段」是**与**关系（两个条件同时满足才留下）；
 * 阶段本身是**多选**，多选之间是**或**（并集）—— 选了「狂热 + 确认」应同时看到两类。
 * `phases` 为空数组表示不按阶段筛选（而不是「一个都不要」）。
 * @param verdicts 全部判定结论
 * @param options 筛选条件
 * @returns 命中条件的判定结论（保持原顺序）
 */
export const filterVerdicts = (
  verdicts: readonly MainlineVerdict[],
  options: MainlineFilterOptions,
): MainlineVerdict[] =>
  verdicts.filter((verdict) => {
    if (options.candidateOnly && !verdict.candidate) return false;
    if (options.phases.length === 0) return true;
    return options.phases.includes(verdict.phase);
  });

/**
 * 按阶段统计板块数（未出现的阶段给 0，不留 `undefined` 让界面去兜）
 * @param verdicts 判定结论
 * @returns 每个阶段的板块数
 */
export const countByPhase = (verdicts: readonly MainlineVerdict[]): MainlinePhaseCounts => {
  const counts = Object.fromEntries(MAINLINE_PHASE_LIST.map((phase) => [phase, 0])) as MainlinePhaseCounts;
  for (const verdict of verdicts) {
    counts[verdict.phase] += 1;
  }
  return counts;
};

/**
 * 是否存在任一筛选条件（界面据此决定是否露出「清除筛选」与行数提示）
 * @param options 筛选条件
 * @returns 是否有筛选生效
 */
export const isFilterActive = (options: MainlineFilterOptions): boolean =>
  options.candidateOnly || options.phases.length > 0;

/**
 * 切换某个阶段的选中态（多选；已选中则取消）
 *
 * 返回新数组而不是原地改，保证 Vue 的响应式依赖能正确触发。
 * @param phases 当前选中的阶段
 * @param phase 要切换的阶段
 * @returns 新的选中阶段列表（保持「原有顺序 + 新项追加」）
 */
export const togglePhase = (
  phases: readonly MainlinePhase[],
  phase: MainlinePhase,
): MainlinePhase[] =>
  phases.includes(phase) ? phases.filter((item) => item !== phase) : [...phases, phase];
