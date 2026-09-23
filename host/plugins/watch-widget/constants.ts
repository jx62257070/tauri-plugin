/**
 * 插件 dsh-watch-widget · 私有常量
 *
 * 窗口 label / 尺寸 / 事件名 / 显隐策略阈值全部集中于此。
 * 本插件的常量会被小组件独立入口（`src/widget/`）跨目录复用 —— 两端共享同一份
 * 事件名与路由参数是事件协议的一部分，不能各自写字面量。
 */

/** 盯盘条窗口 label（capabilities 按此授权；全局唯一） */
export const WATCH_WIDGET_WINDOW_LABEL = 'watch-widget';

/** 浮窗提醒的来源标签（创建失败等插件级提示用） */
export const WATCH_WIDGET_NOTIFY_SOURCE = '任务栏小组件';

/** 气泡窗口 label（capabilities 按此授权；全局唯一） */
export const WATCH_WIDGET_POPOVER_LABEL = 'watch-widget-popover';

/** 独立入口的视图路由参数名（`watch-widget.html?page=…`） */
export const WATCH_WIDGET_PAGE_PARAM = 'page';

/** 盯盘条视图路由 */
export const WATCH_WIDGET_BAR_ROUTE = '/watch-widget';

/** 气泡视图路由 */
export const WATCH_WIDGET_POPOVER_ROUTE = '/watch-widget-popover';

/** 盯盘条窗口加载地址（独立多页入口，规避 SPA 子路径回退问题） */
export const WATCH_WIDGET_WINDOW_URL = `watch-widget.html?${WATCH_WIDGET_PAGE_PARAM}=${WATCH_WIDGET_BAR_ROUTE}`;

/** 气泡窗口加载地址 */
export const WATCH_WIDGET_POPOVER_WINDOW_URL = `watch-widget.html?${WATCH_WIDGET_PAGE_PARAM}=${WATCH_WIDGET_POPOVER_ROUTE}`;

/** 盯盘条宽度（逻辑像素；窗口物理宽 = 该值 × 缩放比） */
export const WATCH_WIDGET_BAR_WIDTH = 288;

/** 盯盘条高度（逻辑像素）= 文本行 16 + 上下各 6 padding + 上下各 1 边框 */
export const WATCH_WIDGET_BAR_HEIGHT = 30;

/** 气泡宽度（逻辑像素；与条同宽、右对齐悬浮） */
export const WATCH_WIDGET_POPOVER_WIDTH = 288;

/** 气泡头部高度（逻辑像素） */
export const WATCH_WIDGET_POPOVER_HEADER_HEIGHT = 40;

/** 气泡单行高度（逻辑像素） */
export const WATCH_WIDGET_POPOVER_ROW_HEIGHT = 34;

/** 气泡底部留白（逻辑像素） */
export const WATCH_WIDGET_POPOVER_FOOTER_PADDING = 6;

/** 气泡最大行数（超出部分列表内滚动） */
export const WATCH_WIDGET_POPOVER_MAX_ROWS = 12;

/**
 * 气泡热力视图的等效行数（高度计算口径：总高 = 头部 40 + 5×34 + 底部 6 = 216）
 *
 * 热力视图展示 Top N 板块的迷你 treemap，高度与候选行数解耦 ——
 * 主窗口按此常量钳制布局高度，渲染端热力区净高 = 216 - 40 - 6 = 170
 */
export const WATCH_WIDGET_POPOVER_HEATMAP_ROWS = 5;

/** 气泡热力视图展示的板块数量（按总市值排序取前 N，与市场总览板块热力同口径） */
export const WATCH_WIDGET_POPOVER_HEATMAP_TOP_N = 10;

/**
 * 气泡内容视图（禁 enum：const 对象 + types/watch-widget.types.ts 派生类型）
 *
 * list = 候选列表（默认）；heatmap = 板块热力（市场总览「板块热力」迷你版，
 * 仅展示无交互）。视图状态归渲染端持有，切换时经 popover-view 事件上报主窗口。
 */
export const WATCH_WIDGET_POPOVER_VIEW = {
  LIST: 'list',
  HEATMAP: 'heatmap',
} as const;

/** 气泡与条的间距（逻辑像素） */
export const WATCH_WIDGET_POPOVER_GAP = 6;

/** 停靠时距屏幕 / 工作区边缘的边距（逻辑像素） */
export const WATCH_WIDGET_DOCK_MARGIN = 8;

/** 工作区查询失败时的任务栏高度回退值（物理像素；Win11 默认 48） */
export const WATCH_WIDGET_TASKBAR_FALLBACK = 48;

/** 鼠标靠近检测的轮询间隔（毫秒；纯本地 API，无网络开销） */
export const WATCH_WIDGET_CURSOR_POLL_MS = 600;

/** hover 模式的唤回热区边长（物理像素；停靠在屏幕右下角，鼠标进入即唤回） */
export const WATCH_WIDGET_REVEAL_ZONE = 160;

/** 单双击区分窗口（毫秒）：单击延后执行，双击到来时取消单击动作 */
export const WATCH_WIDGET_CLICK_DELAY_MS = 280;

/** 拖动结束判定窗口（毫秒）：条实时上报位置后，超过该窗口无新位置才记忆落点 */
export const WATCH_WIDGET_MOVE_SETTLE_MS = 300;

/** 气泡跟随条拖动的节流间隔（毫秒；跟随期间只平移不改尺寸） */
export const WATCH_WIDGET_POPOVER_FOLLOW_INTERVAL_MS = 50;

/** 条内轮播间隔（毫秒；多候选逐条轮播，单候选静止） */
export const WATCH_WIDGET_ROTATE_MS = 4000;

/** 跨窗口事件名（主窗口 ⇄ 小组件窗口的通信协议） */
export const WATCH_WIDGET_EVENTS = {
  /** 主窗口 → 小组件窗口：轮播行载荷（条与气泡共用同一事件） */
  LINES: 'watch-widget://lines',
  /** 小组件窗口 → 主窗口：请求当前快照（挂载即拉一次，免等下一轮轮询） */
  REQUEST: 'watch-widget://request',
  /** 盯盘条 → 主窗口：切换气泡显隐（气泡「收起」按钮同走此事件） */
  POPOVER_TOGGLE: 'watch-widget://popover-toggle',
  /** 气泡 → 主窗口：气泡内容视图切换（挂载时也上报一次，主窗口据此计算窗口高度） */
  POPOVER_VIEW: 'watch-widget://popover-view',
  /** 主窗口 → 气泡：板块热力快照（Top N，市场总览板块热力同口径；拉取成功才推送） */
  HEATMAP: 'watch-widget://heatmap',
  /** 盯盘条 → 主窗口：条被拖动（实时携带物理坐标；主窗口负责气泡跟随与落点记忆） */
  BAR_MOVED: 'watch-widget://bar-moved',
  /** 条 / 气泡 → 主窗口：打开某只股票（唤起主窗口 + 跳详情页，左列=盯盘候选） */
  OPEN_STOCK: 'watch-widget://open-stock',
  /**
   * 主窗口 → 小组件窗口：主题三要素（明暗 / 主题色 / 涨跌配色）实时同步。
   * 不走 storage 事件 —— WebView2 跨窗口 storage 事件在实测中不可靠，
   * 主题跟随必须走与行情数据同一条已验证的事件通道。
   */
  THEME: 'watch-widget://theme',
} as const satisfies Record<string, string>;
