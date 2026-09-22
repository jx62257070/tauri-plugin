import type { WatchWidgetMode, WatchWidgetPower } from '../constants/watch-widget.constants';
import type { ThemeColor } from '../constants/theme-color.constants';
import type { TrendTheme } from '../constants/trend-theme.constants';
import type { HeaderMarqueeTone } from './plugin.types';

/**
 * 任务栏盯盘小组件类型
 *
 * 小组件窗口是独立轻量入口（不装插件内核），与主窗口之间只经 Tauri 事件通信；
 * 本文件的载荷 / 设置类型被两侧共用（插件、小组件入口、设置 store）。
 */

/** 主题同步载荷（主窗口推送给小组件窗口，明暗 / 主题色 / 涨跌配色三要素） */
export interface WatchWidgetThemePayload {
  /** 是否暗色模式 */
  dark: boolean;
  /** 主题色（data-theme） */
  theme: ThemeColor;
  /** 涨跌配色主题（data-trend） */
  trend: TrendTheme;
}

/** 小组件条上单行展示数据（主窗口推送给小组件窗口的载荷行） */
export interface WatchWidgetRow {
  /** 完整符号（sh600519） */
  symbol: string;
  /** 股票名称（行情未返回时回落候选记录名） */
  name: string;
  /** 现价文案（无报价时 `--`） */
  price: string;
  /** 涨跌幅文案（无报价时 `--`） */
  percent: string;
  /** 涨跌语气（小组件端按涨跌主题映射色值，载荷不携带色值） */
  tone: HeaderMarqueeTone;
  /** 阈值已触发待回差（行首提示点） */
  fired: boolean;
}

/** 小组件停靠位置（物理像素；用户拖动后由主窗口记忆） */
export interface WatchWidgetPosition {
  /** 物理像素 x */
  x: number;
  /** 物理像素 y */
  y: number;
}

/** 设置页持久化的任务栏小组件配置 */
export interface WatchWidgetSettings {
  /**
   * 三态电源（默认关闭）：
   * off 关闭 / always 常驻显示（原「开启」）/ smart 智能开启（仅交易日盘中显示）
   */
  power: WatchWidgetPower;
  /** 显示模式：常驻显示 / 鼠标离开自动隐藏（条出现后的行为，与 power 正交） */
  mode: WatchWidgetMode;
  /** 鼠标离开多少秒后自动隐藏（hover 模式生效） */
  hideDelaySec: number;
  /** 用户拖动后的位置（物理像素；null = 每次停靠到任务栏右上角） */
  position: WatchWidgetPosition | null;
}
