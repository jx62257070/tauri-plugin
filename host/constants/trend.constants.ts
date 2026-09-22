/**
 * 涨跌方向常量（代替 enum；A 股语义红涨绿跌）
 */
export const TREND = {
  UP: 'up',
  DOWN: 'down',
  FLAT: 'flat',
} as const;

/** 涨跌方向类型 */
export type Trend = (typeof TREND)[keyof typeof TREND];

/** 判平阈值：涨跌幅绝对值小于该值视为平盘 */
export const TREND_FLAT_THRESHOLD = 0.001;

/**
 * 依据涨跌幅计算趋势方向
 * @param changePercent 涨跌幅（百分数数值，如 2.35 表示 +2.35%）
 * @returns 涨跌方向
 */
export const getTrendByChangePercent = (changePercent: number): Trend => {
  if (changePercent > TREND_FLAT_THRESHOLD) return TREND.UP;
  if (changePercent < -TREND_FLAT_THRESHOLD) return TREND.DOWN;
  return TREND.FLAT;
};
