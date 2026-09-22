/**
 * 应用通知（右侧浮窗）常量
 *
 * 全部为「够用且克制」的值：浮窗是打断性 UI，同屏条数与存活时长都必须收敛
 */

/** 浮窗语气：中性 / 上涨语义 / 下跌语义 / 主色（信息类） */
export const NOTIFY_TONE = {
  /** 中性（一般信息） */
  FLAT: 'flat',
  /** 上涨语义色（A 股默认红；随 data-trend 主题切换） */
  UP: 'up',
  /** 下跌语义色（A 股默认绿；随 data-trend 主题切换） */
  DOWN: 'down',
  /** 品牌主色（纯信息提示，不表达涨跌） */
  PRIMARY: 'primary',
} as const satisfies Record<string, string>;

/** 默认自动消失时长（毫秒） */
export const NOTIFY_DEFAULT_TIMEOUT_MS = 8_000;

/** 同屏最多保留的浮窗条数（超出时挤掉最旧的一条） */
export const NOTIFY_MAX_ITEMS = 4;

/** 浮窗来源标签：自选盯盘插件的阈值提醒 */
export const NOTIFY_SOURCE_WATCH_ALERT = '盯盘提醒';

/** 语气 → 浮窗左侧强调条与来源标签配色类名 */
export const NOTIFY_TONE_CLASS = {
  flat: { bar: 'bg-flat', label: 'text-text-tertiary' },
  up: { bar: 'bg-up', label: 'text-up' },
  down: { bar: 'bg-down', label: 'text-down' },
  primary: { bar: 'bg-primary', label: 'text-primary' },
} as const;
