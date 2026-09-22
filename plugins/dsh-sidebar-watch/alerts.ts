/**
 * 自选盯盘插件 · 阈值提醒规则（纯函数层）
 *
 * 抽成纯函数的原因：阈值判定是本插件最容易出错、也最值得回归保护的部分 ——
 * 「什么时候该提醒、什么时候该闭嘴」全在这里，与报价来源、DB、UI 都无关，
 * 因此可以被冒烟断言直接覆盖（见 `.ai/tmp/watch-alerts-smoke.mjs`）。
 *
 * 生命周期的核心是 **armed（待触发）** 两态：
 * - `armed = true`：条件满足就提醒，提醒后转 false；
 * - `armed = false`：闭嘴，直到价格回到阈值**内侧**并越过回差（防抖动刷屏）才转回 true。
 *
 * 「内侧」= 与触发方向相反的一侧：涨到型阈值的条件是 `≥`，回到 `<` 即内侧。
 *
 * 另有一处易错点：用户填的涨跌幅是**幅度**（恒正），方向由「涨幅/跌幅达到」表达，
 * 因此比较前必须先把阈值解析成带符号的值 —— 见 `resolveAlertThreshold`。
 */
import {
  WATCH_ALERT_DIRECTION,
  WATCH_ALERT_DIRECTION_CHANGE_LABEL,
  WATCH_ALERT_DIRECTION_PRICE_LABEL,
  WATCH_ALERT_KIND,
  WATCH_ALERT_REARM_CHANGE_MARGIN,
  WATCH_ALERT_REARM_PRICE_RATIO,
  WATCH_ALERT_TONE,
} from './constants';
import type { NotifyTone } from '../../host/types/notify.types';
import type { FormatService } from '../../host/types/plugin.types';

/** 阈值类型（`''` = 未设） */
export type WatchAlertKind = (typeof WATCH_ALERT_KIND)[keyof typeof WATCH_ALERT_KIND];

/** 阈值比较方向 */
export type WatchAlertDirection =
  (typeof WATCH_ALERT_DIRECTION)[keyof typeof WATCH_ALERT_DIRECTION];

/** 一条阈值规则（`armed` 由盯盘引擎维护，用户只设前三个字段） */
export interface WatchAlertRule {
  /** 阈值类型 */
  kind: WatchAlertKind;
  /** 阈值数值（价格为元、涨跌幅为百分数）；未设时为 null */
  value: number | null;
  /** 比较方向 */
  above: boolean;
  /** 是否处于待触发态（false = 已触发过、等回到内侧重新武装） */
  armed: boolean;
}

/** 判定用的行情快照（缺值时视为「无法判定」，一律不提醒） */
export interface AlertSnapshot {
  /** 现价 */
  price: number | null;
  /** 涨跌幅（百分数，如 3.21 表示 +3.21%） */
  changePercent: number | null;
}

/** 一次判定的结果 */
export interface AlertEvaluation {
  /** 是否应当提醒（armed 且条件满足） */
  fire: boolean;
  /** 是否应当重新武装（已触发过且价格已回到阈值内侧） */
  rearm: boolean;
}

/**
 * 未设阈值的规则（新增候选时的初值）
 * @returns 默认规则
 */
export const createEmptyAlertRule = (): WatchAlertRule => ({
  kind: WATCH_ALERT_KIND.NONE,
  value: null,
  above: true,
  armed: true,
});

/**
 * 规则是否已配置完整（类型非空且数值有限）
 * @param rule 阈值规则
 * @returns 是否已配置
 */
export const isAlertConfigured = (rule: WatchAlertRule): boolean =>
  rule.kind !== WATCH_ALERT_KIND.NONE &&
  rule.value !== null &&
  Number.isFinite(rule.value);

/**
 * 取规则当前用于比较的行情数值
 * @param rule 阈值规则
 * @param snapshot 行情快照
 * @returns 当前值；规则未配置或行情缺值时为 null
 */
export const resolveAlertCurrent = (
  rule: WatchAlertRule,
  snapshot: AlertSnapshot,
): number | null => {
  if (!isAlertConfigured(rule)) return null;
  const current =
    rule.kind === WATCH_ALERT_KIND.PRICE ? snapshot.price : snapshot.changePercent;
  return current === null || current === undefined || Number.isNaN(current) ? null : current;
};

/**
 * 把规则里的「用户填的数值」解析成**带符号的比较阈值**
 *
 * 这是本模块最容易写错的一处，必须说清楚：
 * - **价格**阈值本身就是价位，用户填正的、比较也用它（`跌到 28.50` = `price <= 28.50`）；
 * - **涨跌幅**阈值用户填的是**幅度**（恒为正，方向由「涨幅达到 / 跌幅达到」表达），
 *   所以 `跌幅达到 3%` 的真实含义是 `changePercent <= -3` —— 阈值取负号。
 *
 * 曾经漏掉这个取负，`跌幅达到 3%` 被算成 `changePercent <= 3`（几乎恒成立），
 * 表现为「一设就疯狂提醒」。这也是本模块必须被冒烟断言覆盖的原因。
 * @param rule 阈值规则
 * @returns 带符号阈值；规则未配置时为 null
 */
export const resolveAlertThreshold = (rule: WatchAlertRule): number | null => {
  if (!isAlertConfigured(rule) || rule.value === null) return null;
  if (rule.kind === WATCH_ALERT_KIND.CHANGE) {
    return rule.above ? rule.value : -rule.value;
  }
  return rule.value;
};

/**
 * 提醒条件是否满足（价格/涨跌幅达到或越过阈值）
 * @param rule 阈值规则
 * @param snapshot 行情快照
 * @returns 条件是否满足；规则未配置或行情缺值时为 false
 */
export const isAlertMet = (rule: WatchAlertRule, snapshot: AlertSnapshot): boolean => {
  const current = resolveAlertCurrent(rule, snapshot);
  const threshold = resolveAlertThreshold(rule);
  if (current === null || threshold === null) return false;
  return rule.above ? current >= threshold : current <= threshold;
};

/**
 * 价格是否已回到阈值内侧**并越过回差**（用于重新武装）
 *
 * 回差的存在是为了防抖动：价格在阈值上下小幅摆动时不必反复提醒。
 * 价格阈值按相对比例取回差，涨跌幅阈值按其自身单位（百分点）取绝对回差。
 * @param rule 阈值规则
 * @param snapshot 行情快照
 * @returns 是否应当重新武装
 */
export const shouldRearmAlert = (rule: WatchAlertRule, snapshot: AlertSnapshot): boolean => {
  const current = resolveAlertCurrent(rule, snapshot);
  const threshold = resolveAlertThreshold(rule);
  if (current === null || threshold === null) return false;
  const margin =
    rule.kind === WATCH_ALERT_KIND.PRICE
      ? Math.abs(threshold) * WATCH_ALERT_REARM_PRICE_RATIO
      : WATCH_ALERT_REARM_CHANGE_MARGIN;
  return rule.above ? current < threshold - margin : current > threshold + margin;
};

/**
 * 判定一条规则在本轮行情下的动作
 *
 * 两个分支互斥：待触发态只看「是否该提醒」，已触发态只看「是否该重新武装」。
 * @param rule 阈值规则
 * @param snapshot 行情快照
 * @returns 判定结果
 */
export const evaluateAlert = (
  rule: WatchAlertRule,
  snapshot: AlertSnapshot,
): AlertEvaluation => {
  if (!isAlertConfigured(rule)) {
    return { fire: false, rearm: false };
  }
  if (rule.armed) {
    return { fire: isAlertMet(rule, snapshot), rearm: false };
  }
  // 已触发：条件仍成立时既不提醒也不重新武装（保持静默）
  return { fire: false, rearm: shouldRearmAlert(rule, snapshot) };
};

/**
 * 规则的中文简述（面板行内展示，如 `跌到 28.50` / `涨幅达到 5.00%`）
 * @param rule 阈值规则
 * @param format 宿主格式化服务（价格 / 百分比口径只有宿主一份）
 * @returns 简述文案；未配置时为空串
 */
export const describeAlertRule = (rule: WatchAlertRule, format: FormatService): string => {
  if (!isAlertConfigured(rule) || rule.value === null) return '';
  const direction = rule.above
    ? WATCH_ALERT_DIRECTION.ABOVE
    : WATCH_ALERT_DIRECTION.BELOW;
  if (rule.kind === WATCH_ALERT_KIND.PRICE) {
    return `${WATCH_ALERT_DIRECTION_PRICE_LABEL[direction]} ${format.price(rule.value)}`;
  }
  return `${WATCH_ALERT_DIRECTION_CHANGE_LABEL[direction]} ${format.percentUnsigned(rule.value)}`;
};

/**
 * 阈值到达时的提醒文案
 *
 * 语气色跟随**触发方向**而不是当日涨跌：设了「跌到 28.50」时，价格真跌到那里
 * 本身就是坏消息，提醒应当是跌色（A 股默认绿），与当日是红是绿无关。
 * @param rule 阈值规则
 * @param name 股票名称
 * @param snapshot 行情快照
 * @param format 宿主格式化服务（价格 / 百分比口径只有宿主一份）
 * @returns 提醒文案（标题 / 说明 / 语气）
 */
export const buildAlertNotice = (
  rule: WatchAlertRule,
  name: string,
  snapshot: AlertSnapshot,
  format: FormatService,
): { title: string; body: string; tone: NotifyTone } => {
  const direction = rule.above
    ? WATCH_ALERT_DIRECTION.ABOVE
    : WATCH_ALERT_DIRECTION.BELOW;
  const label =
    rule.kind === WATCH_ALERT_KIND.PRICE
      ? WATCH_ALERT_DIRECTION_PRICE_LABEL[direction]
      : WATCH_ALERT_DIRECTION_CHANGE_LABEL[direction];
  const target =
    rule.kind === WATCH_ALERT_KIND.PRICE
      ? format.price(rule.value)
      : format.percentUnsigned(rule.value);

  return {
    title: `${name} ${label} ${target}`,
    body: `现价 ${format.price(snapshot.price)}（${format.percent(snapshot.changePercent)}）`,
    // 提醒语气由「触发方向」决定：向上触发用涨色，向下触发用跌色
    tone: rule.above ? WATCH_ALERT_TONE.UP : WATCH_ALERT_TONE.DOWN,
  };
};
