/**
 * 任务栏盯盘小组件 · 公共常量
 *
 * 被设置 store、设置页与小组件插件共同消费的部分（模式枚举、设置默认值）；
 * 窗口尺寸、事件名等插件私有的常量在 `src/plugins/watch-widget/constants.ts`。
 */
import type { WatchWidgetSettings } from '../types/watch-widget.types';

/** 小组件显示模式 */
export const WATCH_WIDGET_MODE = {
  /** 常驻显示 */
  ALWAYS: 'always',
  /** 鼠标离开自动隐藏（移到屏幕右下角热区唤回） */
  HOVER: 'hover',
} as const satisfies Record<string, string>;

/** 小组件显示模式类型 */
export type WatchWidgetMode = (typeof WATCH_WIDGET_MODE)[keyof typeof WATCH_WIDGET_MODE];

/** 小组件三态电源（条是否出现；条出现后的行为由 WATCH_WIDGET_MODE 决定，二者正交） */
export const WATCH_WIDGET_POWER = {
  /** 关闭：不显示迷你条 */
  OFF: 'off',
  /** 常驻：始终显示迷你条（原「开启」） */
  ALWAYS: 'always',
  /** 智能开启：仅交易日盘中显示（盘前、盘后、非交易日自动隐藏） */
  SMART: 'smart',
} as const satisfies Record<string, string>;

/** 小组件三态电源类型 */
export type WatchWidgetPower = (typeof WATCH_WIDGET_POWER)[keyof typeof WATCH_WIDGET_POWER];

/** 三态电源默认值（默认关闭，用户在设置里显式选择） */
export const WATCH_WIDGET_POWER_DEFAULT: WatchWidgetPower = WATCH_WIDGET_POWER.OFF;

/** 小组件插件的注册 id（设置页按它查内核运行时状态，联动显隐设置项） */
export const WATCH_WIDGET_PLUGIN_ID = 'dsh-watch-widget';

/** 显示模式默认值：常驻显示（首次开启先让用户看到，摸鱼隐藏模式由用户显式选择） */
export const WATCH_WIDGET_MODE_DEFAULT: WatchWidgetMode = WATCH_WIDGET_MODE.ALWAYS;

/** 鼠标离开多少秒后自动隐藏（默认 3 秒） */
export const WATCH_WIDGET_HIDE_DELAY_SEC_DEFAULT = 3;

/** 设置默认值（settings store 初始化用；类型只读引入，与 types 单向依赖不构成环） */
export const WATCH_WIDGET_SETTINGS_DEFAULT: WatchWidgetSettings = {
  power: WATCH_WIDGET_POWER_DEFAULT,
  mode: WATCH_WIDGET_MODE_DEFAULT,
  hideDelaySec: WATCH_WIDGET_HIDE_DELAY_SEC_DEFAULT,
  position: null,
};
