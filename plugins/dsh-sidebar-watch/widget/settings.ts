/**
 * 插件 dsh-sidebar-watch · 小组件设置（与宿主「插件设置」表单的接缝）
 *
 * 开关与参数走**插件自带的 `settings.fields`**（宿主渲染通用表单、持久化在插件 storage），
 * 不再依赖宿主 `app:watch-widget-settings` 服务 —— 那个服务在宿主侧从未实现过，
 * 依赖它等于依赖一个空指针。
 *
 * 三个字段（`widgetPower` / `widgetMode` / `widgetHideDelaySec`）由宿主表单渲染；
 * 拖动落点 `widgetPosition` **不出现在表单里**（宿主没有坐标控件），由本插件自行 `set` 回写。
 */
import { PLUGIN_STATUS } from '../../../host/constants/plugin.constants';
import {
  WATCH_WIDGET_HIDE_DELAY_SEC_DEFAULT,
  WATCH_WIDGET_MODE,
  WATCH_WIDGET_MODE_DEFAULT,
  WATCH_WIDGET_POWER,
  WATCH_WIDGET_POWER_DEFAULT,
} from './constants';
import type {
  PluginRuntimeReader,
  PluginSettingsDeclaration,
  PluginSettingFieldOption,
  PluginSettingsStore,
} from '../../../host/types/plugin.types';
import type {
  WatchWidgetMode,
  WatchWidgetPower,
} from './constants';
import type { WatchWidgetConfig, WatchWidgetPosition } from './types';

/** 设置在插件 storage 里的键名（统一加 widget 前缀：本插件将来还会有非小组件的设置） */
export const WIDGET_SETTING_KEYS = {
  POWER: 'widgetPower',
  MODE: 'widgetMode',
  HIDE_DELAY_SEC: 'widgetHideDelaySec',
  /** 拖动落点：**不出现在表单里**，由插件自行 set 回写（宿主没有坐标控件） */
  POSITION: 'widgetPosition',
} as const;

/** 隐藏延时的合法区间（同时给宿主表单 min/max 与读取端兜底 clamp） */
export const WIDGET_HIDE_DELAY_MIN_SEC = 1;

/** 隐藏延时的上限（秒） */
export const WIDGET_HIDE_DELAY_MAX_SEC = 30;

/** 旧独立包的 id（合并后被移除；留作残留检测的唯一事实源） */
export const LEGACY_WATCH_WIDGET_PLUGIN_ID = 'dsh-watch-widget';

/** 三态电源选项（默认常驻：安装即可见，用户随时可在插件设置里关掉） */
const POWER_OPTIONS: readonly PluginSettingFieldOption[] = [
  { value: WATCH_WIDGET_POWER.OFF, label: '关闭' },
  { value: WATCH_WIDGET_POWER.ALWAYS, label: '常驻显示' },
  { value: WATCH_WIDGET_POWER.SMART, label: '智能开启（交易日 09:00-15:00）' },
];

/** 显示模式选项（默认常驻：首次开启先让用户看见，摸鱼隐藏由用户显式选择） */
const MODE_OPTIONS: readonly PluginSettingFieldOption[] = [
  { value: WATCH_WIDGET_MODE.ALWAYS, label: '一直显示' },
  { value: WATCH_WIDGET_MODE.HOVER, label: '鼠标离开自动隐藏' },
];

/**
 * 清单里的 settings 段（plugin.ts 直接 `settings: WIDGET_SETTINGS_SECTION`）
 *
 * 用 `fields` 而不是 `component`：宿主设置弹窗二选一渲染，三个开关全是
 * select / select / number 能表达的，写 `component` 等于为三个开关重做一遍
 * 输入框、校验与持久化，收益为零。
 */
export const WIDGET_SETTINGS_SECTION: PluginSettingsDeclaration = {
  title: '任务栏小组件',
  description:
    '在任务栏上方常驻一个置顶迷你条，复用本插件的盯盘候选与报价（不产生第二份行情请求）。'
    + '仅 Windows 桌面端生效，且需要应用侧已内置小组件渲染端；默认开启，不需要就在上面关掉。',
  fields: [
    {
      key: WIDGET_SETTING_KEYS.POWER,
      label: '小浮窗',
      description: '常驻 / 智能开启（交易日 09:00-15:00 显示）/ 关闭；默认常驻',
      type: 'select',
      default: WATCH_WIDGET_POWER_DEFAULT,
      options: POWER_OPTIONS,
    },
    {
      key: WIDGET_SETTING_KEYS.MODE,
      label: '显示模式',
      description: '鼠标离开后是否自动隐藏（隐藏后移到屏幕右下角热区可唤回）',
      type: 'select',
      default: WATCH_WIDGET_MODE_DEFAULT,
      options: MODE_OPTIONS,
    },
    {
      key: WIDGET_SETTING_KEYS.HIDE_DELAY_SEC,
      label: '自动隐藏延时（秒）',
      description: '仅在「鼠标离开自动隐藏」模式下生效',
      type: 'number',
      default: WATCH_WIDGET_HIDE_DELAY_SEC_DEFAULT,
      min: WIDGET_HIDE_DELAY_MIN_SEC,
      max: WIDGET_HIDE_DELAY_MAX_SEC,
      step: 1,
    },
  ],
};

/**
 * 电源取值是否合法（未知值一律按「关闭」处理：宁可不显示，也不在用户以为关了的时候弹出来）
 * @param value 存储里的原始值
 * @returns 是否为合法电源取值
 */
const isWidgetPower = (value: unknown): value is WatchWidgetPower =>
  value === WATCH_WIDGET_POWER.OFF
  || value === WATCH_WIDGET_POWER.ALWAYS
  || value === WATCH_WIDGET_POWER.SMART;

/**
 * 显示模式取值是否合法（未知值回落到常驻，与宿主 select 的默认值口径一致）
 * @param value 存储里的原始值
 * @returns 是否为合法显示模式
 */
const isWidgetMode = (value: unknown): value is WatchWidgetMode =>
  value === WATCH_WIDGET_MODE.ALWAYS || value === WATCH_WIDGET_MODE.HOVER;

/**
 * 隐藏延时收敛到合法区间（非数字 / NaN 回落到默认值 3 秒）
 * @param value 存储里的原始值
 * @returns 合法区间内的整数秒数
 */
const clampDelay = (value: unknown): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  const safe = Number.isFinite(numeric) ? numeric : WATCH_WIDGET_HIDE_DELAY_SEC_DEFAULT;
  return Math.min(
    WIDGET_HIDE_DELAY_MAX_SEC,
    Math.max(WIDGET_HIDE_DELAY_MIN_SEC, Math.round(safe)),
  );
};

/**
 * 拖动落点是否是合法的坐标对（脏值一律当「没记住过」，回落到停靠位）
 * @param value 存储里的原始值
 * @returns 是否为合法坐标
 */
const isWidgetPosition = (value: unknown): value is WatchWidgetPosition =>
  typeof value === 'object'
  && value !== null
  && Number.isFinite((value as WatchWidgetPosition).x)
  && Number.isFinite((value as WatchWidgetPosition).y);

/**
 * 读当前生效的小组件配置
 *
 * 读的是宿主的 reactive 容器（`settings.values`），因此必须在 computed / watch 里调用：
 * 用户在设置弹窗里一改，这里立刻重算，下面的 `shouldShowBar` 跟着翻转。
 * 每个值都做归一化：存储里可能躺着老版本或手改的脏值，而 power 一旦取到未知值，
 * 后面 `=== OFF` 判断失效，小浮窗会在用户以为关闭的时候弹出来。
 * @param settings 插件设置存取句柄
 * @returns 归一化后的小组件配置
 */
export const readWidgetConfig = (settings: PluginSettingsStore): WatchWidgetConfig => {
  const power = settings.get<unknown>(WIDGET_SETTING_KEYS.POWER, WATCH_WIDGET_POWER_DEFAULT);
  const mode = settings.get<unknown>(WIDGET_SETTING_KEYS.MODE, WATCH_WIDGET_MODE_DEFAULT);
  const delay = settings.get<unknown>(
    WIDGET_SETTING_KEYS.HIDE_DELAY_SEC,
    WATCH_WIDGET_HIDE_DELAY_SEC_DEFAULT,
  );
  const position = settings.get<unknown>(WIDGET_SETTING_KEYS.POSITION, null);
  return {
    power: isWidgetPower(power) ? power : WATCH_WIDGET_POWER.OFF,
    mode: isWidgetMode(mode) ? mode : WATCH_WIDGET_MODE.ALWAYS,
    hideDelaySec: clampDelay(delay),
    position: isWidgetPosition(position) ? position : null,
  };
};

/**
 * 拖动落点回写（写的是**未声明**的键：宿主表单没有坐标控件，但 set 支持任意可序列化键）
 * @param settings 插件设置存取句柄
 * @param position 拖动落点（物理像素）
 */
export const rememberBarPosition = (
  settings: PluginSettingsStore,
  position: WatchWidgetPosition,
): void => {
  settings.set(WIDGET_SETTING_KEYS.POSITION, position);
};

/**
 * 是否还残留着「旧的任务栏小组件」独立包且处于已挂载状态
 *
 * 为什么要检测：旧包一旦挂载，会与合并后的小组件抢同一个窗口 label ——
 * 两个来源同时对同一个窗口 emit 快照、各自跑光标轮询，表现为快照双份推送 +
 * 条自己忽隐忽现。留它就是给用户制造一个「偶发灵异」。
 *
 * 判据用**已挂载 / 挂载中**而不是「装了没」：等待依赖 / 被禁用 / 挂载失败的包
 * 不会再抢窗口，不必拦。
 * @param runtime 内核运行时只读视图（缺失视为无残留）
 * @returns 是否残留且已挂载
 */
export const legacyWidgetInstalled = (runtime: PluginRuntimeReader | undefined): boolean => {
  const status = runtime?.get(LEGACY_WATCH_WIDGET_PLUGIN_ID)?.status;
  return status === PLUGIN_STATUS.MOUNTED || status === PLUGIN_STATUS.MOUNTING;
};
