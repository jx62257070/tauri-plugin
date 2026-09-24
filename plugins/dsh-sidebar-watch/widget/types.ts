/**
 * 插件 dsh-sidebar-watch · 任务栏小组件的类型与入参
 *
 * 跨窗口载荷的字段与宿主渲染端（`src/widget/`）一一对应 —— 搬来时一个字段都没改，
 * 改字段等于改事件协议，两边必须同步。
 */
import type { ThemeColor } from '../../../host/constants/theme-color.constants';
import type { TrendTheme } from '../../../host/constants/trend-theme.constants';
import type {
  FormatService,
  MarketService,
  MarketStatusService,
  PluginContext,
  PluginLogger,
  PluginRuntimeReader,
  PluginSettingsStore,
  StockOpenService,
  ThemeService,
  WatchlistService,
  HeaderMarqueeTone,
} from '../../../host/types/plugin.types';
import type { NotifyService } from '../../../host/types/notify.types';
import type { WATCH_WIDGET_POPOVER_VIEW } from './constants';
import type { WatchWidgetMode, WatchWidgetPower } from './constants';
import type { WatchMonitor } from '../monitor';
import type { WatchCandidateRepo } from '../service';

/** 气泡内容视图（list 候选列表 / heatmap 板块热力 / market 大盘走势） */
export type WatchWidgetPopoverView =
  (typeof WATCH_WIDGET_POPOVER_VIEW)[keyof typeof WATCH_WIDGET_POPOVER_VIEW];

/** 单行展示载荷（主窗口 → 小组件窗口；不含色值，语气由渲染端按涨跌主题映射） */
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

/** 热力视图单板块 */
export interface WatchWidgetHeatmapBoard {
  /** 板块名称 */
  name: string;
  /** 涨跌幅（百分数；主窗口侧已把 null 归一为 0） */
  changePercent: number;
  /** 总市值（元，treemap 面积权重；主窗口侧已把 null 归一为 0） */
  totalMarketCap: number;
}

/** 大盘视图单指数行（主窗口按宿主 `app:format` 造好文案与语气） */
export interface WatchWidgetIndexRow {
  /** 指数代码（上游原值，仅作渲染 key） */
  code: string;
  /** 指数名称（A 股 4 个在前、海外 6 个在后，名称由宿主快照给出） */
  name: string;
  /** 最新点位文案（无报价时 `--`） */
  price: string;
  /** 涨跌幅文案（无报价时 `--`） */
  percent: string;
  /** 涨跌语气（渲染端按涨跌主题映射色值，载荷不携带色值） */
  tone: HeaderMarqueeTone;
}

/** 用户拖动后的停靠位置（物理像素） */
export interface WatchWidgetPosition {
  /** 物理像素 x */
  x: number;
  /** 物理像素 y */
  y: number;
}

/** 主题同步载荷 */
export interface WatchWidgetThemePayload {
  /** 是否暗色模式 */
  dark: boolean;
  /** 主题色（data-theme） */
  theme: ThemeColor;
  /** 涨跌配色主题（data-trend） */
  trend: TrendTheme;
}

/** `popover-view` 事件载荷（气泡 → 主窗口：视图切换 / 挂载自报） */
export interface WatchWidgetPopoverViewPayload {
  /** 切换后的视图 */
  view: WatchWidgetPopoverView;
}

/** 归一化后的小组件配置（一切读取都从这里过，脏值在此收敛） */
export interface WatchWidgetConfig {
  /** 三态电源 */
  power: WatchWidgetPower;
  /** 显示模式 */
  mode: WatchWidgetMode;
  /** 鼠标离开多少秒后自动隐藏（hover 模式生效） */
  hideDelaySec: number;
  /** 用户拖动后的位置（物理像素；null = 停靠工作区右下角） */
  position: WatchWidgetPosition | null;
}

/**
 * 宿主能力快照（**全部可能缺席**：缺一个必需项就整体跳过小组件）
 *
 * 只有 `market` 与 `notify` 是可缺的：前者缺席只是热力 / 大盘视图空态降级，
 * 后者缺席只是提示通道没了。其余五项缺任一项，小组件的体验就不成立。
 */
export interface WatchWidgetCaps {
  /** 格式化（价格 / 百分比 / 涨跌语气，口径只有宿主一份） */
  format: FormatService | undefined;
  /** 自选股只读视图（监控范围 = 候选池 ∩ 自选股） */
  watchlist: WatchlistService | undefined;
  /** 全站统一的个股打开交互 */
  stockOpen: StockOpenService | undefined;
  /** 盘中判定（智能开启态靠它跨界隐现） */
  marketStatus: MarketStatusService | undefined;
  /** 主题实时快照（明暗 / 主题色 / 涨跌配色） */
  theme: ThemeService | undefined;
  /** 可选：缺失时热力 / 大盘视图空态降级 */
  market: MarketService | undefined;
  /** 可选：缺失时创建失败只记日志 */
  notify: NotifyService | undefined;
}

/**
 * 挂载入参
 *
 * `repo` / `monitor` **必须**是主体 `apply` 里创建的那两个实例（由调用方直接传进来，
 * 因此天然是同一个）：第二份引擎会把上游行情请求翻倍、并把阈值的 `armed` 状态双写。
 */
export interface WatchWidgetMountOptions {
  /** 候选仓储（与顶栏盯盘主体同一份实例） */
  repo: WatchCandidateRepo;
  /** 盯盘引擎（与顶栏盯盘主体同一份实例；小组件只消费 `quotes`，绝不取数） */
  monitor: WatchMonitor;
  /** 插件日志器 */
  logger: PluginLogger;
  /** 插件设置存取（读 `widgetPower` / `widgetMode` / `widgetHideDelaySec` / `widgetPosition`） */
  settings: PluginSettingsStore;
  /** 内核运行时只读视图（残留旧包检测用；缺失视为无残留） */
  runtime: PluginRuntimeReader | undefined;
  /** 宿主能力快照 */
  caps: WatchWidgetCaps;
  /** 带清理的副作用执行器（插件卸载时自动撤销） */
  effect: PluginContext['effect'];
  /** 卸载回调注册器 */
  onDispose: PluginContext['onDispose'];
}
