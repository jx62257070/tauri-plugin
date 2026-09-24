/**
 * 涨跌配色主题常量（<html data-trend> 切换，settings store 持久化）
 */
export const TREND_THEME = {
  /** 红涨绿跌（默认，A 股习惯） */
  RED_UP: 'red_up',
  /** 红跌绿涨（涨为绿、跌为红） */
  GREEN_UP: 'green_up',
  /** 红涨蓝跌（跌为蓝） */
  BLUE_DOWN: 'blue_down',
} as const;

/** 涨跌配色主题类型 */
export type TrendTheme = (typeof TREND_THEME)[keyof typeof TREND_THEME];

/** 涨跌配色主题选项（swatch 为选项自身标识色，供设置页预览色块固定展示，不随主题切换） */
export const TREND_THEME_OPTIONS: readonly {
  label: string;
  value: TrendTheme;
  upSwatch: string;
  downSwatch: string;
}[] = [
  { label: '红涨绿跌', value: TREND_THEME.RED_UP, upSwatch: '#e02020', downSwatch: '#00b578' },
  { label: '红跌绿涨', value: TREND_THEME.GREEN_UP, upSwatch: '#00b578', downSwatch: '#e02020' },
  { label: '红涨蓝跌', value: TREND_THEME.BLUE_DOWN, upSwatch: '#e02020', downSwatch: '#2f6fed' },
];

/** 默认涨跌配色主题 */
export const TREND_THEME_DEFAULT: TrendTheme = TREND_THEME.RED_UP;
