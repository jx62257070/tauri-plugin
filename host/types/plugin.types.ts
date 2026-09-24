/**
 * 插件系统类型契约（内核 ↔ 插件 ↔ 宿主 三方唯一事实源）
 *
 * 设计对标 DeepSeek Harness（dsh）的 Cordis 内核，三条主线：
 * - **服务（Service）**：插件经 `ctx.provide` 贡献能力、经 `ctx.consume` 注入依赖，
 *   依赖由服务名决定而非文件里的 import 顺序；
 * - **事件（Typed Events）**：`AppEventMap` 为内置事件表，插件可用 `declare module`
 *   扩展，也可发任意字符串事件（走宽松分支）；
 * - **可逆副作用（Reversible Effects）**：一切注册（面板 / 菜单 / 路由 / 命令 / 服务 /
 *   事件订阅 / 定时器）都返回 `Disposable`，插件卸载时由内核统一撤销。
 *
 * 因此「卸载插件」等价于「把它的所有贡献抹掉」，不需要为插件写专门的反向逻辑。
 */
import type * as Vue from 'vue';
import type { Component, Ref } from 'vue';
import type { Trend } from '../constants/trend.constants';
import type { ThemeColor } from '../constants/theme-color.constants';
import type { TrendTheme } from '../constants/trend-theme.constants';
import type { BuiltinMcpServer } from '../agent/mcp/types';
import type { NotifyService } from './notify.types';
import type { PollingOptions, PollingScheduler } from './polling.types';
import type { FullQuote, SearchResult } from './stock-quote.types';
import type { WatchWidgetSettings } from './watch-widget.types';
import type { HEADER_MARQUEE_TONE, PLUGIN_ORIGIN, PLUGIN_STATUS } from '../constants/plugin.constants';

/** 可逆副作用句柄：调用 `dispose()` 撤销一次注册（幂等） */
export interface Disposable {
  /** 撤销副作用（重复调用无副作用） */
  dispose: () => void;
}

/** 侧栏面板渲染位置：`nav` 导航菜单区（默认）/ `footer` 侧栏底部（设置入口之上） */
export type SidebarPanelPosition = 'nav' | 'footer';

/** 侧栏面板展示形态：`inline` 直接渲染在侧栏内 / `drawer` 侧栏内只放入口按钮，内容走右侧抽屉 */
export type SidebarPanelMode = 'inline' | 'drawer';

/** 插件面板的承载形态（宿主 provide 给面板组件的上下文口径：内联 / 抽屉 / 顶栏下拉） */
export type PluginPanelHostMode = SidebarPanelMode | 'header';

/**
 * 左侧栏面板贡献（插件在左侧栏新增面板的唯一入口）
 *
 * `mode: 'inline'` 时面板组件直接渲染在侧栏内（适合盯盘清单、指标概览等常驻信息）；
 * `mode: 'drawer'` 时侧栏内只渲染一个入口按钮，点击后内容在右侧抽屉里展开
 * （适合编辑器、配置面板等需要宽度的内容）。
 */
export interface SidebarPanelContribution {
  /** 面板 id（插件内唯一，内核会拼成 `<pluginId>#<id>` 全局键） */
  id: string;
  /** 面板标题（侧栏区块标题 / 抽屉标题 / 折叠态 tooltip） */
  title: string;
  /** 图标 key（MenuIcon 渲染；缺省时不显示图标） */
  icon?: string;
  /** 展示形态，默认 `inline` */
  mode?: SidebarPanelMode;
  /** 渲染位置，默认 `nav` */
  position?: SidebarPanelPosition;
  /** 排序权重，越小越靠前（默认 100） */
  order?: number;
  /** 面板组件（宿主用 `<component :is>` 渲染） */
  component: Component;
  /** 传给面板组件的 props */
  props?: Record<string, unknown>;
  /** 侧栏收起为图标栏时是否仍渲染（仅 inline 有意义，默认 false） */
  visibleWhenCollapsed?: boolean;
}

/** 已注册的侧栏面板（内核补全默认值 + 归属插件后的形态） */
export interface RegisteredSidebarPanel {
  /** 全局唯一键：`<pluginId>#<id>` */
  key: string;
  /** 归属插件 id */
  pluginId: string;
  /** 面板 id（插件内声明值） */
  id: string;
  /** 面板标题 */
  title: string;
  /** 图标 key（已补默认值：缺省为空串） */
  icon: string;
  /** 展示形态（已补默认值） */
  mode: SidebarPanelMode;
  /** 渲染位置（已补默认值） */
  position: SidebarPanelPosition;
  /** 排序权重（已补默认值） */
  order: number;
  /** 面板组件 */
  component: Component;
  /** 传给面板组件的 props */
  props: Record<string, unknown>;
  /** 侧栏收起时是否仍渲染（已补默认值） */
  visibleWhenCollapsed: boolean;
}

/**
 * 左侧导航菜单项贡献
 *
 * 声明 `component` 时内核会**同时**注册该 path 的布局子路由（最常用场景）；
 * 只做菜单入口、路由另有来源时不传 `component`。
 */
export interface MenuItemContribution {
  /** 路由路径（须以 `/` 开头，且不得与宿主菜单冲突） */
  path: string;
  /** 菜单标题 */
  title: string;
  /** 图标 key（MenuIcon 渲染） */
  icon: string;
  /** 页面组件（传了则自动注册该路径的布局子路由） */
  component?: Component;
  /** 传给页面组件的 props */
  props?: Record<string, unknown>;
  /** 排序权重，越小越靠前（默认 500，即排在宿主菜单之后） */
  order?: number;
  /**
   * 是否声明为「插件页随插件撤销时的兜底落点」（默认 false）
   *
   * 用户正停在某个插件的页面上、而该插件被关闭 / 卸载 / 挂载失败回滚时，
   * 宿主会把用户送到这里，避免他停在一个已经不存在、下次导航就 404 的页面上。
   * 多个页面同时声明时取 `order` 最小者；声明随插件卸载一起消失，
   * 所以**本页自己也关掉时**宿主会自然退到「侧栏第一个菜单」（见 `resolveRouteFallback`）。
   */
  fallbackLanding?: boolean;
}

/** 已注册的插件菜单项（内核补全默认值 + 归属插件后的形态） */
export interface RegisteredMenuItem extends MenuItemContribution {
  /** 全局唯一键：`<pluginId>#<path>` */
  key: string;
  /** 归属插件 id */
  pluginId: string;
  /** 图标 key（已补默认值：缺省为 `menu`） */
  icon: string;
  /** 排序权重（已补默认值） */
  order: number;
  /** 是否为兜底落点（已补默认值：缺省 false） */
  fallbackLanding: boolean;
}

/** 路由贡献（不进菜单的隐藏页面，如详情子页、独立窗口页） */
export interface RouteContribution {
  /** 路由路径 */
  path: string;
  /** 路由名（可选，供 `router.push({ name })` 使用） */
  name?: string;
  /** 页面组件 */
  component: Component;
  /** 传给页面组件的 props */
  props?: Record<string, unknown>;
  /** 路由 meta（title 会用于顶栏标题与浏览器标题） */
  meta?: Record<string, unknown>;
  /**
   * 是否挂在主布局（`/` 路由）之下，默认 true。
   * 独立窗口页（不经过 MainLayout）传 false，会注册为顶层路由。
   */
  underLayout?: boolean;
}

/** 已注册的插件路由（内核补全默认值 + 归属插件后的形态） */
export interface RegisteredRoute extends RouteContribution {
  /** 全局唯一键：`<pluginId>#<path>` */
  key: string;
  /** 归属插件 id */
  pluginId: string;
  /** 是否挂在主布局之下（已补默认值） */
  underLayout: boolean;
}

/**
 * 「用户正停留的插件页随插件一起撤销」的上下文
 *
 * 插件被关闭 / 卸载 / 挂载失败回滚时，它的路由会被桥接层从 router 上摘掉；
 * 如果此刻用户正好停在那个页面上，页面其实已经不存在了，宿主需要接走他。
 */
export interface VanishedRouteInfo {
  /** 消失的页面路径（用户原本停留的页，不含 query） */
  path: string;
  /** 页面标题（路由 `meta.title`；页面没声明时为空串） */
  title: string;
  /** 页面归属插件 id */
  pluginId: string;
  /** 页面归属插件名（插件已整体注销时退化为 id） */
  pluginName: string;
}

/** 插件路由桥的可选宿主策略 */
export interface PluginRouteBridgeOptions {
  /**
   * 当前停留的插件页随插件撤销时的收尾（跳去哪 + 要不要提示用户）
   *
   * 桥只负责**检测**（它知道哪条路由刚被撤销），去哪由宿主决定：
   * 内核不认识宿主有哪些页面，落点由宿主自己声明（`fallbackLanding`）解析，不在这里写死。
   * 缺省不处理 —— 用户之后自己导航时由 404 兜底接走。
   * @param info 消失页面的上下文
   */
  onVanishedRoute?: (info: VanishedRouteInfo) => void;
}

/**
 * 右侧停靠面板贡献
 *
 * 宿主侧栏（个股详情）之外的插件内容容器；插件需自行调用
 * `useDockPanelStore().openPluginPanel(panelKey)` 打开。
 */
export interface DockPanelContribution {
  /** 面板 id（插件内唯一） */
  id: string;
  /** 面板标题（停靠面板头部展示） */
  title: string;
  /** 面板组件 */
  component: Component;
  /** 传给面板组件的 props */
  props?: Record<string, unknown>;
}

/** 已注册的停靠面板 */
export interface RegisteredDockPanel extends Required<DockPanelContribution> {
  /** 全局唯一键：`<pluginId>#<id>` */
  key: string;
  /** 归属插件 id */
  pluginId: string;
}

/** 顶栏轮播行的语义色调（取值见 constants/plugin.constants.ts 的 HEADER_MARQUEE_TONE） */
export type HeaderMarqueeTone = (typeof HEADER_MARQUEE_TONE)[keyof typeof HEADER_MARQUEE_TONE];

/**
 * 顶栏条目收起态的「单条轮播」行
 *
 * 宿主只按 `tone` 映射配色、按 `text` 单行截断展示，**不理解业务语义** ——
 * 与行操作贡献点同一个思路：插件声明「显示什么」，宿主只管「显示在哪」。
 */
export interface HeaderMarqueeLine {
  /** 整行展示文本（无 `label` 时整行截断展示；同时作为这行的无障碍朗读内容） */
  text: string;
  /**
   * 行首标签（如标的名称）
   *
   * 与 `price` / `percent` 成对给出时，宿主按「三段定宽」渲染：`label` 固定五字宽
   * 超长截断，`price` / `percent` 各按最坏宽度定宽完整显示 —— 顶栏只有一行位置，
   * 名称长短不一时宁可截名称，也不能把价格 / 涨跌幅挤掉。只给 `text` 则整行一起截断。
   */
  label?: string;
  /** 价格段（如「1266.98」），定宽不截断（与 `label` 之间不留间距） */
  price?: string;
  /** 涨跌幅段（如「+0.71%」），定宽不截断（与 `price` 之间留 `PRICE_PERCENT_GAP` 间距） */
  percent?: string;
  /** 语义色调（缺省中性）；涨跌方向由色调表达，插件不碰具体色值 */
  tone?: HeaderMarqueeTone;
}

/**
 * 顶栏条目贡献（应用顶栏右侧工具条上的一个入口）
 *
 * 用作「一眼能看到、点开才展开」的常驻信息入口：收起态只有一个图标 + 一条轮播信息
 * （`marquee` 提供数据源，宿主按 `marqueeIntervalMs` 轮流展示），点击展开下拉面板
 * 承载 `component` —— 于是插件既能长期露脸，又不会长期占版面。
 *
 * 宿主不硬编码任何具体插件：谁注册谁出现在顶栏，插件卸载即消失。
 */
export interface HeaderItemContribution {
  /** 条目 id（插件内唯一，内核会拼成 `<pluginId>#<id>` 全局键） */
  id: string;
  /** 条目名（下拉面板标题 / 无可轮播内容时的占位文案） */
  title: string;
  /** 图标 key（MenuIcon 渲染）。收起态不展示（顶栏位置金贵，留给轮播信息），设置页编排列表用它区分条目 */
  icon: string;
  /** 排序权重，越小越靠左（默认 100；宿主自带项不参与排序） */
  order?: number;
  /** 下拉面板内容组件（宿主在点击展开时挂载、收起时卸载） */
  component: Component;
  /** 传给下拉面板组件的 props */
  props?: Record<string, unknown>;
  /**
   * 收起态轮播行的数据源（在响应式作用域内求值，插件直接读自己的 ref 即可）
   *
   * 返回空数组 = 当前无可展示内容，触发按钮回落为「条目名」；
   * 返回单行 = 常显不轮播（宿主不会为一个定时器白跑）。
   * @returns 轮播行列表（宿主按间隔轮流取一条，上下滑动切换）
   */
  marquee?: () => readonly HeaderMarqueeLine[];
  /** 轮播间隔（毫秒，默认 4000，低于 HEADER_ITEM_MARQUEE_INTERVAL_MIN 会被夹到下限） */
  marqueeIntervalMs?: number;
}

/** 已注册的顶栏条目（内核补全默认值 + 归属插件后的形态） */
export interface RegisteredHeaderItem {
  /** 全局唯一键：`<pluginId>#<id>` */
  key: string;
  /** 归属插件 id */
  pluginId: string;
  /** 条目 id（插件内声明值） */
  id: string;
  /** 条目名 */
  title: string;
  /** 图标 key */
  icon: string;
  /** 排序权重（已补默认值） */
  order: number;
  /** 下拉面板内容组件 */
  component: Component;
  /** 传给下拉面板组件的 props（已补默认空对象） */
  props: Record<string, unknown>;
  /** 轮播行数据源（已补默认：恒返回空数组） */
  marquee: () => readonly HeaderMarqueeLine[];
  /** 轮播间隔（已夹到下限之上） */
  marqueeIntervalMs: number;
}

/**
 * 股票行操作的作用目标（宿主把被操作的那一行交给插件）
 *
 * 只暴露「哪只票」，不暴露行对象 / 表格实例：插件因此无法改宿主数据，
 * 只能对这只股票做自己的事（加入盯盘、打标签、发起分析…）。
 */
export interface StockRowTarget {
  /** 完整符号（如 `sh600519`） */
  symbol: string;
  /** 股票名称（行情未取到时为自选记录里的名称） */
  name: string;
}

/**
 * 股票行操作贡献（在股票行表格的「操作」列注入一个按钮）
 *
 * 宿主不硬编码任何具体插件：谁注册谁渲染、插件卸载即消失。
 * `isActive` 让插件表达「这一行已处于该动作的激活态」（如已在盯盘候选中），
 * 宿主据此高亮按钮并切换提示文案 —— 于是「加入 / 移出」这类开关型动作
 * 只需要插件声明两个文案 + 一个判定，宿主不必理解动作语义。
 */
export interface StockRowActionContribution {
  /** 动作 id（插件内唯一，内核会拼成 `<pluginId>#<id>` 全局键） */
  id: string;
  /** 动作名（按钮 tooltip / aria 文案，如「盯盘」） */
  title: string;
  /** 已激活时的动作名（缺省沿用 `title`，如「取消盯盘」） */
  activeTitle?: string;
  /** 图标 key（MenuIcon 渲染） */
  icon: string;
  /** 排序权重，越小越靠前（默认 100；宿主自带的删除按钮恒在最后） */
  order?: number;
  /**
   * 该行当前是否已处于激活态（缺省视为未激活）
   * @param row 行数据
   * @returns 是否激活
   */
  isActive?: (row: StockRowTarget) => boolean;
  /**
   * 执行动作
   * @param row 行数据
   */
  run: (row: StockRowTarget) => void;
}

/** 已注册的股票行操作（内核补全默认值 + 归属插件后的形态） */
export interface RegisteredStockRowAction {
  /** 全局唯一键：`<pluginId>#<id>` */
  key: string;
  /** 归属插件 id */
  pluginId: string;
  /** 动作 id（插件内声明值） */
  id: string;
  /** 动作名（按钮提示文案） */
  title: string;
  /** 激活态动作名（已补默认值：缺省等于 title） */
  activeTitle: string;
  /** 图标 key（MenuIcon 渲染） */
  icon: string;
  /** 排序权重（已补默认值） */
  order: number;
  /** 激活态判定（已补默认值：恒为 false） */
  isActive: (row: StockRowTarget) => boolean;
  /** 执行体 */
  run: (row: StockRowTarget) => void;
}

/**
 * 个股详情扩展区贡献（在右侧个股详情面板底部注入一个区块）
 *
 * 宿主只提供承载位置并传入当前股票符号，区块内容完全由插件决定 ——
 * 宿主不硬编码任何具体插件（速记 / 标签 / 备注等都走这个通用口子），
 * 插件卸载即整体消失。组件会收到 `props: { symbol }`（归一化完整符号）。
 */
export interface StockDetailSectionContribution {
  /** 区块 id（插件内唯一，内核会拼成 `<pluginId>#<id>` 全局键） */
  id: string;
  /** 区块标题（卡片标题栏文案） */
  title: string;
  /** 排序权重，越小越靠前（默认 100；同值按注册先后） */
  order?: number;
  /** 区块组件（props 为 `{ symbol: string }` 与本字段合并） */
  component: Component;
  /** 传给区块组件的额外 props（如插件注入自己的仓储服务） */
  props?: Record<string, unknown>;
}

/** 已注册的个股详情扩展区（内核补全默认值 + 归属插件后的形态） */
export interface RegisteredStockDetailSection {
  /** 全局唯一键：`<pluginId>#<id>` */
  key: string;
  /** 归属插件 id */
  pluginId: string;
  /** 区块 id（插件内声明值） */
  id: string;
  /** 区块标题 */
  title: string;
  /** 排序权重（已补默认值） */
  order: number;
  /** 区块组件 */
  component: Component;
  /** 传给区块组件的额外 props（已补默认空对象） */
  props: Record<string, unknown>;
}

/**
 * 命令贡献（可挂全局快捷键的可执行动作）
 *
 * 快捷键用形如 `Ctrl+Alt+N` / `Shift+Tab` 的描述串，宿主在 capture 阶段统一匹配，
 * 插件不需要自己挂 `keydown`（避免多个插件抢事件、以及卸载后监听泄漏）。
 */
export interface CommandContribution {
  /** 命令 id（插件内唯一） */
  id: string;
  /** 命令标题（命令面板 / 插件详情展示） */
  title: string;
  /** 快捷键描述串（如 `Ctrl+Alt+N`；可空 = 只可编程调用） */
  keys?: string;
  /** 执行体 */
  run: () => void;
}

/** 已注册的命令 */
export interface RegisteredCommand extends CommandContribution {
  /** 全局唯一键：`<pluginId>#<id>` */
  key: string;
  /** 归属插件 id */
  pluginId: string;
}

/** 插件日志器（内核统一加 `[plugin:<id>]` 前缀，便于日志页筛选） */
export interface PluginLogger {
  /**
   * 记录一条普通信息
   * @param message 日志内容
   * @param args 附加参数
   */
  info: (message: string, ...args: unknown[]) => void;
  /**
   * 记录一条告警
   * @param message 日志内容
   * @param args 附加参数
   */
  warn: (message: string, ...args: unknown[]) => void;
  /**
   * 记录一条错误
   * @param message 日志内容
   * @param args 附加参数
   */
  error: (message: string, ...args: unknown[]) => void;
}

/** 插件自有持久化（按 `plugin:<id>` 命名空间隔离，互不串数据） */
export interface PluginStorage {
  /**
   * 读取一个键（不存在或反序列化失败时返回默认值）
   * @param key 键名
   * @param fallback 默认值
   * @returns 反序列化后的值或默认值
   */
  get: <T>(key: string, fallback: T) => T;
  /**
   * 写入一个键（JSON 序列化后落 localStorage）
   * @param key 键名
   * @param value 任意可序列化值
   */
  set: (key: string, value: unknown) => void;
  /**
   * 删除一个键
   * @param key 键名
   */
  remove: (key: string) => void;
}

/** 插件数据库列类型（`json` 物理存 TEXT，写入 stringify / 读出 parse，承载任意可序列化值） */
export type PluginDbColumnType = 'text' | 'integer' | 'real' | 'json';

/** 插件数据库列声明（`ctx.db.ensureTable` 用） */
export interface PluginDbColumn {
  /** 列名（snake_case，宿主校验合法性，非法直接抛错） */
  name: string;
  /** 存储类型 */
  type: PluginDbColumnType;
  /** 是否建索引（等值 / 排序查询频繁的列开 true） */
  indexed?: boolean;
}

/** 插件数据库查询条件（等值过滤，宿主参数化，插件拼不进任何 SQL） */
export interface PluginDbQuery {
  /** 等值过滤：列名 → 值（仅声明过的列可参与） */
  where?: Record<string, string | number | boolean>;
  /** 排序 */
  orderBy?: {
    /** 排序列 */
    column: string;
    /** 是否降序（默认升序） */
    desc?: boolean;
  };
  /** 返回条数上限 */
  limit?: number;
  /** 跳过条数（配合 limit 分页） */
  offset?: number;
}

/** 读出的一行（宿主自动附加 id 与时间戳三列） */
export type PluginDbRow<T extends Record<string, unknown>> = T & {
  /** 行主键（宿主生成，update / remove 的定位键） */
  id: number;
  /** 创建时间（毫秒时间戳，宿主维护） */
  createdAt: number;
  /** 更新时间（毫秒时间戳，宿主维护） */
  updatedAt: number;
};

/**
 * 插件通用数据库（每插件独立表：`plugin_<插件id>_<表名>`）
 *
 * 插件只做「声明式建表 + CRUD」，**永不写 SQL**：Tauri 端落 SQLite 动态表，
 * 浏览器端无 SQLite 自动降级为本地 JSON 表仿真，两端语义一致。
 * 建表幂等（可重复调用）；未 ensureTable 就读写会抛错，约束插件先声明结构。
 */
export interface PluginDatabase {
  /**
   * 声明一张本插件的数据表（幂等：表已存在不重建，缺列自动 ALTER 补上）
   *
   * 想改表结构只需在声明里加列 —— 老库会在下次挂载时补列，插件不必写迁移逻辑。
   * 新增列一律按可空列补（插件读取时自行兜底默认值）。
   * @param table 表名（snake_case，插件内唯一）
   * @param columns 列声明（至少一列；重复列名抛错）
   */
  ensureTable: (table: string, columns: readonly PluginDbColumn[]) => Promise<void>;
  /**
   * 插入一行
   * @param table 表名（须先 ensureTable）
   * @param row 行数据（键必须都是声明过的列；返回宿主生成的主键）
   * @returns 新行主键 id
   */
  insert: (table: string, row: Record<string, unknown>) => Promise<number>;
  /**
   * 查询行（按声明列反序列化，自动附带 id / createdAt / updatedAt）
   * @param table 表名
   * @param query 过滤 / 排序 / 分页条件（缺省取全部，默认按 id 升序）
   * @returns 行数组
   */
  select: <T extends Record<string, unknown>>(
    table: string,
    query?: PluginDbQuery,
  ) => Promise<PluginDbRow<T>[]>;
  /**
   * 按主键更新一行（patch 只含要改的列，宿主自动刷新 updatedAt）
   * @param table 表名
   * @param id 行主键
   * @param patch 待更新列（键必须都是声明过的列）
   */
  update: (table: string, id: number, patch: Record<string, unknown>) => Promise<void>;
  /**
   * 按主键删除一行
   * @param table 表名
   * @param id 行主键
   */
  remove: (table: string, id: number) => Promise<void>;
  /**
   * 统计行数（可带等值过滤）
   * @param table 表名
   * @param where 等值过滤（缺省统计全表）
   * @returns 行数
   */
  count: (table: string, where?: PluginDbQuery['where']) => Promise<number>;
  /**
   * 清空一张表（不删表，结构保留）
   * @param table 表名
   */
  clear: (table: string) => Promise<void>;
}

/** 左侧栏面板贡献点 */
export interface SidebarContributor {
  /**
   * 注册一个左侧栏面板
   * @param panel 面板声明
   * @returns 撤销句柄（插件卸载时内核自动调用）
   */
  add: (panel: SidebarPanelContribution) => Disposable;
}

/** 左侧导航菜单贡献点 */
export interface MenuContributor {
  /**
   * 注册一个左侧导航菜单项（带 `component` 时同时注册页面路由）
   * @param item 菜单声明
   * @returns 撤销句柄
   */
  add: (item: MenuItemContribution) => Disposable;
}

/** 路由贡献点 */
export interface RouterContributor {
  /**
   * 注册一条路由（不进左侧导航）
   * @param route 路由声明
   * @returns 撤销句柄
   */
  add: (route: RouteContribution) => Disposable;
}

/** 右侧停靠面板贡献点 */
export interface DockContributor {
  /**
   * 注册一个右侧停靠面板
   * @param panel 面板声明
   * @returns 撤销句柄
   */
  add: (panel: DockPanelContribution) => Disposable;
}

/** 顶栏条目贡献点（应用顶栏右侧工具条由插件注入入口） */
export interface HeaderContributor {
  /**
   * 注册一个顶栏条目（收起态图标 + 轮播，点击展开下拉面板）
   * @param item 条目声明
   * @returns 撤销句柄（插件卸载时内核自动调用）
   */
  add: (item: HeaderItemContribution) => Disposable;
}

/** 命令贡献点 */
export interface CommandContributor {
  /**
   * 注册一个命令（可带全局快捷键）
   * @param command 命令声明
   * @returns 撤销句柄
   */
  add: (command: CommandContribution) => Disposable;
}

/** 股票行操作贡献点（自选股等「股票行」表格的操作列由插件注入按钮） */
export interface StockRowContributor {
  /**
   * 注册一个股票行操作
   * @param action 动作声明
   * @returns 撤销句柄（插件卸载时内核自动调用）
   */
  add: (action: StockRowActionContribution) => Disposable;
}

/** 个股详情扩展区贡献点（个股详情面板的扩展区块由插件注入） */
export interface StockDetailContributor {
  /**
   * 注册一个个股详情扩展区块
   * @param section 区块声明
   * @returns 撤销句柄（插件卸载时内核自动调用）
   */
  add: (section: StockDetailSectionContribution) => Disposable;
}

/** Agent 工具贡献点（把插件能力暴露给内置 MCP，Agent 即可调用） */
export interface AgentContributor {
  /**
   * 注册一台内置 MCP 服务器（工具随插件挂载生效、卸载失效）
   * @param server 内置 MCP 服务器声明
   * @returns 撤销句柄
   */
  addServer: (server: BuiltinMcpServer) => Disposable;
}

/**
 * 应用内置事件表
 *
 * 插件可通过模块扩展追加自定义事件：
 * ```ts
 * declare module '../types/plugin.types' {
 *   interface AppEventMap { 'note:saved': [id: string] }
 * }
 * ```
 */
export interface AppEventMap {
  /** 某插件挂载完成（贡献点已全部生效） */
  'plugin:mounted': [info: PluginRuntimeInfo];
  /** 某插件卸载完成（贡献点已全部撤销） */
  'plugin:unmounted': [info: PluginRuntimeInfo];
  /** 某插件挂载失败 */
  'plugin:failed': [info: PluginRuntimeInfo, error: unknown];
  /** 左侧栏面板注册表变化 */
  'sidebar:changed': [panels: readonly RegisteredSidebarPanel[]];
  /** 顶栏条目注册表变化 */
  'header:changed': [items: readonly RegisteredHeaderItem[]];
  /** 路由切换（宿主在 router.afterEach 中广播） */
  'route:changed': [to: string, from: string];
}

/**
 * 标的搜索服务契约（`app:stock-search`）
 *
 * 宿主把 stock-sdk 的腾讯搜索（代码 / 名称 / 拼音）封装成无 UI 的通用 API：
 * 插件自建搜索输入框与结果展示，不依赖宿主的搜索弹窗组件。
 */
export interface StockSearchService {
  /**
   * 模糊搜索标的
   * @param keyword 关键词（建议 ≥2 字符，**由调用方防抖**，避免上游被无效请求轰炸）
   * @returns 搜索结果列表（code 为 `sh600519` 完整形态，含指数 / 港美股，调用方自行按 category / market 过滤）
   */
  search: (keyword: string) => Promise<SearchResult[]>;
}

/**
 * 应用服务契约表
 *
 * 插件用模块扩展声明自己的服务即可获得类型安全的 provide / consume：
 * ```ts
 * declare module '../types/plugin.types' {
 *   interface AppServiceMap { 'note:repo': NoteRepo }
 * }
 * ```
 */
/**
 * 行情报价服务（`app:quotes`）
 *
 * 宿主收费化简入口：插件不必自己拼上游 URL、不必处理代理与转码。
 * 频率红线见 PLUGIN_API.md §10 —— 报价类请求**不要轮询**，用户点击触发或低频刷新。
 */
export interface QuotesService {
  /**
   * 按代码批量取实时快照（腾讯源）
   * @param codes 代码列表（裸代码如 `300339`，或 `sz300339` 完整符号）
   * @returns 报价列表（上游拿不到的代码不会出现在这里）
   */
  fetchFullQuotes: (codes: readonly string[]) => Promise<FullQuote[]>;
}

/**
 * 确认弹窗入参（`app:ui` 的 `confirm`）
 */
export interface UiConfirmOptions {
  /** 标题（默认「确认」） */
  title?: string;
  /** 正文文案 */
  content?: string;
  /** 确认按钮文案（默认「确定」） */
  okText?: string;
  /** 取消按钮文案（默认「取消」） */
  cancelText?: string;
  /** 确认按钮变体：primary 主色 / danger 危险（默认 primary） */
  okVariant?: 'primary' | 'danger';
}

/**
 * 宿主 UI Kit 服务（`app:ui`）
 *
 * 第三方插件既 import 不了宿主组件，写了 Tailwind 类也可能没有 CSS（构建期只扫描
 * 宿主源码）。UI Kit 是这个问题的正解：宿主把自己正在用的组件原样发给插件，
 * 插件用它拼出来的界面天然与原生页面同风格，且**不受样式丢失影响**。
 *
 * 组件 props 与各 Base* 组件一致（比如 Input / Switch / Tabs 都是 v-model），
 * 用法：`h(ui.Button, { variant: 'ghost', onClick }, () => '删除')`。
 */
export interface UiKitService {
  /** 按钮（primary / ghost / danger 三变体，默认 slot 为文案） */
  Button: Component;
  /** 单行输入（`modelValue` 双向绑定，placeholder / type） */
  Input: Component;
  /** 开关（`modelValue` 双向绑定） */
  Switch: Component;
  /** 标签胶囊（primary / up / down / flat 四色调） */
  Tag: Component;
  /** 带标题区的卡片（title / fill，extra 插槽） */
  Card: Component;
  /** 空态占位（text） */
  Empty: Component;
  /** 分段 / 下划线两档 tab（options + modelValue） */
  Tabs: Component;
  /**
   * 配置驱动的表格（columns / rows / rowKey）
   *
   * 自定义单元格用**与列 key 同名的作用域插槽**：`h(ui.Table, props, { code: ({ row }) => … })`。
   * 表头排序（列 `sortable`）/ 行展开（`expandable` + `#expanded` 插槽）均可用
   */
  Table: Component;
  /**
   * 通用弹窗（title + `open` 双向绑定 + 默认 / #filters / #footer 三插槽）
   *
   * 与 `confirm()` 的区别：`confirm` 是宿主渲染的一次性确认，Modal 是插件自己持有的一块界面
   */
  Modal: Component;
  /** 右侧抽屉（title + `open` 双向绑定 + width），承载整页体量内容 */
  Drawer: Component;
  /** 图标（name 取 MenuIcon 的 icon key） */
  Icon: Component;
  /** 骨架屏（首屏无数据时的占位；列表刷新不要翻 loading，见 PLUGIN_API.md §10） */
  Skeleton: Component;
  /** 弹一条应用级确认弹窗（宿主渲染，返回用户是否确认） */
  confirm: (options?: UiConfirmOptions) => Promise<boolean>;
}

/**
 * 受控网络请求服务（`app:http`）
 *
 * 复用宿主的上游通道（Tauri 由 Rust 直连、浏览器走 /stock-proxy），因此
 * **只允许访问 `allowedHosts` 白名单内的域名** —— 既不新增开放代理面，
 * 也让插件不必自建 CORS 方案。
 */
export interface HttpService {
  /** 发起一个受上游白名单约束的请求（签名同 fetch） */
  fetch: typeof fetch;
  /** 当前允许访问的域名白名单（后缀匹配：`eastmoney.com` 覆盖其所有子域） */
  allowedHosts: readonly string[];
  /**
   * 判断某个 URL 是否允许访问（插件可先自检，避免请求被拒后才知道）
   * @param url 目标地址
   * @returns 是否允许
   */
  isAllowed: (url: string) => boolean;
}

/** 单个交易日的沪深两市成交额（单位：元） */
export interface MarketTurnoverPoint {
  /** 交易日（`YYYY-MM-DD`） */
  date: string;
  /** 上证成交额（元） */
  shanghaiAmount: number;
  /** 深证成交额（元） */
  shenzhenAmount: number;
  /** 两市合计（元） */
  totalAmount: number;
}

/**
 * 涨停池成员（`app:market` 的 `fetchLimitUpPool` 返回项）
 *
 * 由宿主从上游股池**挑字段映射**而来：上游字段名与口径随版本变化，
 * 这里只承诺插件真正用得到的那些，避免把上游的不稳定直接暴露给第三方。
 */
export interface LimitUpPoolMember {
  /** 股票代码（裸代码） */
  code: string;
  /** 股票名称 */
  name: string;
  /** 最新价（元） */
  price: number | null;
  /** 涨跌幅（百分数） */
  changePercent: number | null;
  /** 连板数（仅涨停池有值） */
  continuousBoardCount: number | null;
  /** 封板资金（元） */
  boardAmount: number | null;
  /** 所属行业名（东财口径，与板块分类体系不一定同源） */
  industry: string;
}

/**
 * 行业板块轻量快照（`app:market` 的 `fetchIndustryBoards` 返回项）
 *
 * 从 `IndustryBoard` 挑字段映射而来（与 `LimitUpPoolMember` 同款做法）：
 * 只承诺插件真正消费的字段，上游字段漂移不穿透到插件。
 */
export interface IndustryBoardSnapshot {
  /** 板块代码（BK1027 形态） */
  code: string;
  /** 板块名称 */
  name: string;
  /** 涨跌幅（百分数；上游未给时为 null） */
  changePercent: number | null;
  /** 总市值（元；上游未给时为 null） */
  totalMarketCap: number | null;
}

/**
 * 指数轻量快照（`app:market` 的 `fetchIndexQuotes` 返回项）
 *
 * 与 `GlobalIndexQuote` 同源（东财 ulist），但只暴露小组件「大盘走势」真正
 * 消费的字段；顺序即调用方展示顺序（A 股 4 个在前、海外 6 个在后）。
 */
export interface MarketIndexQuote {
  /** 指数代码（上游原值，如 000001 / HSI；仅作渲染 key，不做归一化承诺） */
  code: string;
  /** 指数名称 */
  name: string;
  /** 最新点位（上游未给时为 null） */
  price: number | null;
  /** 涨跌幅（百分数；上游未给时为 null） */
  changePercent: number | null;
}

/**
 * 市场级行情服务（`app:market`）
 *
 * 成交总额 / 涨停池这类**市场剖面**数据：取数口径固定在宿主这一侧，
 * 插件各自找源只会各说各话（不同源的指数样本、复权与停牌处理并不一致）。
 * 前两者为重量级网络请求：**只能由用户点击触发，不要轮询**。
 * `fetchIndustryBoards` 是单页 clist 轻接口，允许「小组件热力视图激活期间」
 * 这类短窗口低频轮询（见 §5.10）；`fetchIndexQuotes` 同理，允许「小组件大盘
 * 视图激活期间」30s 级低频轮询（东财 ulist 精确 secid 单次请求）。
 */
export interface MarketService {
  /**
   * 沪深两市逐日总成交额（腾讯指数日 K 源）
   * @returns 按日期升序、日期轴连续的成交额序列
   */
  fetchMarketTurnover: () => Promise<MarketTurnoverPoint[]>;
  /**
   * 指定交易日的涨停池
   * @param date 交易日（`YYYY-MM-DD`）；缺省为当日
   * @returns 池子成员（上游对过早日期返回空数组）
   */
  fetchLimitUpPool: (date?: string) => Promise<LimitUpPoolMember[]>;
  /**
   * 全部行业板块（东财源，与市场总览板块热力同源同口径）
   * @returns 全量行业板块（调用方自行排序 / 截取 Top N）
   */
  fetchIndustryBoards: () => Promise<IndustryBoardSnapshot[]>;
  /**
   * 小组件「大盘走势」的指数快照（市场总览同款 10 指数，双源 allSettled）
   * @returns 指数报价列表（A 股 4 + 海外 6，失败一路自动缺省；
   * 上游对个别 secid 缺数据时该条目不出现，调用方按空态兜底）
   */
  fetchIndexQuotes: () => Promise<MarketIndexQuote[]>;
}

/**
 * 个股打开服务（`app:stock-open`）
 *
 * 全站有两套「打开一只股票」的交互（右侧详情侧栏 / 详情整页），过去只有宿主内部
 * 的 `useStockOpen()` 能走到。插件拿不到这份逻辑就会各写一套跳转，
 * 于是「双击进详情页时左侧来源列表有没有东西」这种细节插件写不出、
 * 也不该让插件写 —— 这里是两条交互的唯一入口。
 */
export interface StockOpenService {
  /**
   * 单击语义：展开右侧个股详情侧栏（携带 `list` 时写入详情页左侧来源列表）
   * @param symbol 个股符号（裸代码或完整符号均可，宿主侧归一化）
   * @param list 来源列表（如插件自己表格的全部行，供详情页一键切换）
   */
  openSidebar: (symbol: string, list?: readonly StockContextItem[]) => void;
  /**
   * 双击语义：收起侧栏并进入个股详情整页
   * @param symbol 个股符号（裸代码或完整符号均可，宿主侧归一化）
   * @param list 来源列表（不给时写入仅当前一只，避免残留上一批）
   */
  openPage: (symbol: string, list?: readonly StockContextItem[]) => void;
}

/**
 * 详情页左侧「来源列表」的一项（`app:stock-open` 的 `list` 元素）
 *
 * 与宿主内部 `ContextStock` 同源，只是这里作为契约对外：
 * `symbol` 会由宿主归一化成完整符号（详情页高亮匹配就靠它），其余字段可选。
 */
export interface StockContextItem {
  /** 股票符号（裸代码 `600519` 或完整符号 `sh600519` 均可，宿主归一化） */
  symbol: string;
  /** 股票名称（缺省空串） */
  name?: string;
  /** 现价（元；来源列表无该字段时缺省 null） */
  price?: number | null;
  /** 当日涨跌幅（%；来源列表无该字段时缺省 null） */
  changePercent?: number | null;
}

/**
 * 自选股只读视图里的一只股票
 */
export interface WatchlistItem {
  /** 完整符号（sh600519 形态） */
  symbol: string;
  /** 股票名称 */
  name: string;
}

/**
 * 自选股分组只读视图（`app:watchlist` 的 `groups` 元素）
 */
export interface WatchlistGroupView {
  /** 分组 id */
  id: string;
  /** 分组名 */
  name: string;
  /** 组内股票 */
  stocks: readonly WatchlistItem[];
}

/**
 * 自选股只读服务（`app:watchlist`）
 *
 * 只给**读**：写操作（增删分组、加自选）仍是宿主页面的职责 ——
 * 插件一旦能改用户自选股，撤销语义与「谁加的」就都说不清了。
 *
 * 三个成员全是 getter 而不是快照数组：在插件自己的 `computed` / `watch` 里调用
 * 就能感知自选股变化（宿主 pinia state 的响应式依赖会正常被收集）。
 */
export interface WatchlistService {
  /**
   * 全部自选股符号（跨分组去重）
   * @returns 完整符号列表
   */
  symbols: () => readonly string[];
  /**
   * 分组结构（默认组在首位）
   * @returns 分组列表
   */
  groups: () => readonly WatchlistGroupView[];
  /**
   * 按符号查名称
   * @param symbol 完整符号
   * @returns 自选股里的名称；不在自选股里返回 undefined
   */
  nameOf: (symbol: string) => string | undefined;
}

/**
 * 选股弹窗服务（`app:stock-picker`）
 *
 * 弹窗就是全站统一的标的搜索（代码 / 名称 / 拼音、含「上次搜索」与键盘上下键），
 * 由**宿主渲染**并以 Promise 返回结果 —— 与 `app:ui` 的 `confirm()` 同一范式：
 * 插件自己搭一个搜索框只会更差（样式不统一、没有搜索历史、过滤口径容易写岔），
 * 而且一旦宿主搜索改版，插件那一份也不会跟着更新。
 */
export interface StockPickerService {
  /**
   * 打开选股弹窗
   * @returns 用户挑中的标的；取消 / 关闭为 null
   */
  pick: () => Promise<SearchResult | null>;
}

/**
 * 轮询调度服务（`app:polling`）
 *
 * 宿主把 `createPollingScheduler` 这一个入口交给插件：**交易窗口感知 / 失败指数退避 /
 * 页面可见性感知 / 轮询总开关**四份策略只有一份实现。插件自己写 `setInterval`
 * 迟早会两边写岔，而岔一次的代价是顶到上游频率红线（东财会封 IP）。
 *
 * 调度器属于**插件层**而不是组件层：面板有两层折叠会卸载组件，写在组件里的轮询会停摆。
 */
export interface PollingService {
  /**
   * 创建一个轮询调度器（自身不注册任何清理，调用方负责 `stop()`）
   * @param options 轮询选项（与宿主内部 `PollingOptions` 完全一致）
   * @returns 调度句柄
   */
  create: (options: PollingOptions) => PollingScheduler;
}

/**
 * 格式化与涨跌语义服务（`app:format`）
 *
 * 这一组看起来「只是几个小函数」，实际每一条都是**宿主口径**：
 * - 涨跌配色是中国市场约定（红涨绿跌），第三方自己写大概率写反；
 * - `delay` / `debounce` 是上游限速节拍的一部分，各自实现会触发封 IP；
 * - 符号三形态互转（裸码 / 完整符号 / 归一化）踩过两次坑，失灵时表现为整列 `--`。
 *
 * 所以宁可由宿主统一提供，也不让每个插件各写一份。
 */
export interface FormatService {
  /** 数值占位符（全站 `--` 口径） */
  placeholder: string;
  /**
   * 涨跌方向（红涨绿跌语义的唯一入口）
   * @param changePercent 涨跌幅（百分数数值）
   */
  trend: (changePercent: number | null | undefined) => Trend;
  /** 涨跌方向 → 文本色类名（对应主题 token） */
  trendClass: (trend: Trend) => string;
  /** 涨跌方向 → 胶囊类名（弱色底 + 语义文字色） */
  trendPillClass: (trend: Trend) => string;
  /** 带符号百分比（`+2.35%`） */
  percent: (value: number | null | undefined) => string;
  /** 不带符号百分比（`1.71%`） */
  percentUnsigned: (value: number | null | undefined) => string;
  /** 价格两位小数 */
  price: (value: number | null | undefined) => string;
  /** 相对时间（`3分钟前` / `昨天` / `9-18`） */
  relativeTime: (timestamp: number) => string;
  /** 等待指定毫秒（错开对同一上游的连续请求） */
  delay: (ms: number) => Promise<void>;
  /**
   * 防抖包装（搜索框等场景；定时器随闭包回收，无需额外清理）
   * @param fn 目标函数
   * @param wait 防抖窗口（毫秒）
   */
  debounce: <T extends unknown[]>(fn: (...args: T) => void, wait: number) => (...args: T) => void;
  /** 任意形态代码 → 完整符号（`sh600519`） */
  toFullSymbol: (input: string) => string;
  /** 完整符号 → 裸代码（`sz300339` → `300339`） */
  toBareCode: (symbol: string) => string;
  /**
   * A 股代码归一化 → 完整符号（`600519` / `sh600519` / `600519.SH` → `sh600519`）
   *
   * 与详情页路由里的符号同形态：只有归一化了，详情页左侧列表才能高亮到当前这只
   */
  normalizeCode: (input: string) => string;
  /** 报价映射按本地符号查报价（兼容上游返回的裸代码键） */
  findQuote: (quotesMap: Record<string, FullQuote>, symbol: string) => FullQuote | undefined;
}

/**
 * 市场状态服务（`app:market-status`）
 *
 * 市场开闭状态是宿主全站状态（交易日历 + 分钟级时钟），插件自己算必然分叉。
 */
export interface MarketStatusService {
  /**
   * 当前是否 A 股盘中（交易日 09:30-15:00，含午休；随宿主分钟级时钟响应式重算，
   * 交易日历未就绪按周一~周五降级，日历恢复后自愈）
   */
  isIntraday: Readonly<Ref<boolean>>;
}

/**
 * 任务栏小组件配置服务（`app:watch-widget-settings`）
 *
 * 配置 UI 在宿主设置页（含插件状态联动的显隐），数据归宿主 settings store 持久化；
 * 插件端只读快照 + 回写窗口拖动位置，自身不落库。
 */
export interface WatchWidgetSettingsService {
  /** 配置快照（响应式；宿主设置页改动即更新） */
  settings: Readonly<Ref<WatchWidgetSettings>>;
  /**
   * 局部更新配置（与宿主设置页同一落库出口）
   * @param patch 配置增量（电源 / 显示模式 / 隐藏延时 / 拖动位置）
   */
  set: (patch: Partial<WatchWidgetSettings>) => void;
}

/**
 * 主题服务（`app:theme`）
 *
 * 明暗 / 主题色 / 涨跌配色的宿主实时快照：插件要往独立窗口同步主题
 * （如任务栏小组件），自己读 storage 在 WebView2 跨窗口场景实测不可达。
 */
export interface ThemeService {
  /** 是否暗色（跟随系统 + 用户偏好，与宿主 useDark 同源） */
  isDark: Readonly<Ref<boolean>>;
  /** 主题色 */
  themeColor: Readonly<Ref<ThemeColor>>;
  /** 涨跌配色 */
  trendTheme: Readonly<Ref<TrendTheme>>;
}

/** 应用初始化之前约定：调整上述服务后同步 PLUGIN_API.md 与 AGENTS.md（见 §12） */
export interface AppServiceMap {
  /** 应用版本号（内核挂载时自动提供，来源 APP_VERSION） */
  'app:version': string;
  /** 内核运行时自省只读句柄（插件工坊等观测型插件消费） */
  'kernel:runtime': PluginRuntimeReader;
  /** 宿主路由跳转（插件不直接依赖 router 实例，改走此服务） */
  'app:navigate': (path: string) => void;
  /**
   * 打开一个插件面板
   *
   * inline 面板：展开并滚动到可视区；drawer 面板：打开右侧抽屉。
   * 插件「注册面板」与「打开面板」因此可以分开：命令、事件回调都能唤醒面板。
   */
  'panel:open': (panelKey: string) => void;
  /**
   * 关闭一个插件面板（`panel:open` 的反向动作）
   *
   * drawer 面板关抽屉、顶栏条目收起下拉、inline 面板折叠。
   * 「保存并关闭」这类动作不再依赖 `inject` 宿主内部上下文 —— 插件知道自己的面板 key
   * （`<pluginId>#<id>`，注册时的那两个值拼出来），按 key 关即可。
   */
  'panel:close': (panelKey: string) => void;
  /** 全站统一的个股打开交互（右侧详情侧栏 / 详情整页），替代宿主内部 `useStockOpen` */
  'app:stock-open': StockOpenService;
  /** 自选股只读视图（符号 / 分组 / 查名），替代插件直接读 `stores/watchlist` */
  'app:watchlist': WatchlistService;
  /** 轮询调度器工厂（交易窗口 / 退避 / 可见性四份策略的唯一实现） */
  'app:polling': PollingService;
  /**
   * 弹一条应用级浮窗提醒（右下角常驻，跨路由）
   *
   * 宿主承载、插件只发起：浮窗**不依赖发起它的组件是否挂载**，
   * 因此「盯盘阈值告警」这类要长期生效的提醒不会因为面板被折叠就失效。
   */
  'app:notify': NotifyService;
  /** 标的搜索（代码 / 名称 / 拼音，腾讯源；宿主封装 stock-sdk，调用方自行防抖与过滤非 A 股） */
  'app:stock-search': StockSearchService;
  /**
   * 打开全站统一的选股弹窗（宿主渲染 + 搜索历史，Promise 返回结果）
   *
   * 插件要「让用户挑一只股票」时用这个，而不是自己搭一个搜索框 ——
   * 后者没有搜索历史、样式不统一，且宿主搜索改版后不会跟着更新。
   */
  'app:stock-picker': StockPickerService;
  /** 宿主 UI Kit（Button / Input / Tag / Card … + confirm），第三方插件做界面的唯一来源 */
  'app:ui': UiKitService;
  /** 受控网络请求（走宿主上游通道，仅允许白名单域名） */
  'app:http': HttpService;
  /** 行情报价：按代码批量取实时快照 */
  'app:quotes': QuotesService;
  /**
   * 市场剖面数据（沪深成交额 / 涨停池）
   *
   * 重接口，宿主统一取数口径；只能由用户点击触发。
   */
  'app:market': MarketService;
  /** 格式化与涨跌语义（红涨绿跌、百分比、相对时间、符号互转、限速节拍） */
  'app:format': FormatService;
  /** 市场状态：A 股盘中判定（交易日历 + 分钟级时钟，宿主唯一实现） */
  'app:market-status': MarketStatusService;
  /** 任务栏小组件配置（宿主设置页为 UI 与持久化归属，插件只读快照 + 回写位置） */
  'app:watch-widget-settings': WatchWidgetSettingsService;
  /** 主题实时快照（明暗 / 主题色 / 涨跌配色，供插件向独立窗口同步） */
  'app:theme': ThemeService;
}

/** 内核运行时只读视图（供插件自省，不暴露挂载 / 卸载能力） */
export interface PluginRuntimeReader {
  /**
   * 取全部插件运行时信息
   * @returns 运行时信息列表（按 id 升序）
   */
  list: () => readonly PluginRuntimeInfo[];
  /**
   * 取某个插件的运行时信息
   * @param id 插件 id
   * @returns 运行时信息；不存在返回 null
   */
  get: (id: string) => PluginRuntimeInfo | null;
  /**
   * 取当前生效的服务名列表
   * @returns 服务名数组
   */
  listServices: () => readonly string[];
  /**
   * 取最近 N 条内核事件记录（用于排障 / 观测页面）
   * @returns 由新到旧的事件记录
   */
  recentEvents: () => readonly PluginEventRecord[];
}

/** 内核事件记录（环形缓冲，仅供观测） */
export interface PluginEventRecord {
  /** 事件名 */
  name: string;
  /** 触发时间戳（毫秒） */
  at: number;
  /** 触发来源插件 id（宿主广播为空串） */
  source: string;
}

/** 插件运行时状态（取值见 constants/plugin.constants.ts 的 PLUGIN_STATUS） */
export type PluginStatus = (typeof PLUGIN_STATUS)[keyof typeof PLUGIN_STATUS];

/** 插件来源：`builtin` 随应用分发（不可删除）/ `user` 应用内安装（可卸载） */
export type PluginOrigin = (typeof PLUGIN_ORIGIN)[keyof typeof PLUGIN_ORIGIN];

/**
 * 用户插件持久化记录（应用内安装的插件，代码原文落 localStorage）
 *
 * 存**代码字符串**而不是求值结果：刷新后由加载器重新 import，
 * 与内置插件的「每次启动从源码挂载」保持同一生命周期模型。
 */
export interface UserPluginRecord {
  /** 插件 id（与定义内 id 一致，卸载 / 启停的键） */
  id: string;
  /** 展示名（安装时从定义解析冗余一份，弹窗不用先执行代码也能列表） */
  name: string;
  /** 语义化版本 */
  version: string;
  /** 一句话说明 */
  description: string;
  /** 作者（定义里没写时空串，展示层补「用户安装」） */
  author: string;
  /** 插件代码原文（预构建 ESM JS，`export default { …PluginDefinition }`） */
  code: string;
  /** 安装时间（ISO 8601） */
  installedAt: string;
  /**
   * 安装来源（可选，历史记录没有此字段）
   *
   * `zip` = 第三方 zip 产物包；`code` = 粘贴 / 选择单文件 JS。仅用于展示与排查。
   */
  source?: string;
}

/** 插件运行时信息（插件管理弹窗 / 插件工坊展示） */
export interface PluginRuntimeInfo {
  /** 插件 id */
  id: string;
  /** 展示名 */
  name: string;
  /** 语义化版本 */
  version: string;
  /** 一句话说明 */
  description: string;
  /** 作者 */
  author: string;
  /** 是否内置插件（随应用分发，不可删除） */
  builtin: boolean;
  /** 插件来源 */
  origin: PluginOrigin;
  /** 当前运行时状态 */
  status: PluginStatus;
  /** 依赖的插件 id 列表 */
  inject: readonly string[];
  /** 挂载失败原因（status = failed 时才有） */
  error: string;
  /** 该插件当前生效的贡献点计数（按贡献点分类） */
  contributions: PluginContributionCount;
  /** 已撤销（卸载）的副作用数量 */
  disposedEffects: number;
}

/** 单个插件的贡献点计数 */
export interface PluginContributionCount {
  /** 左侧栏面板数 */
  sidebarPanels: number;
  /** 顶栏条目数 */
  headerItems: number;
  /** 左侧导航菜单项数 */
  menuItems: number;
  /** 路由数 */
  routes: number;
  /** 右侧停靠面板数 */
  dockPanels: number;
  /** 命令数 */
  commands: number;
  /** 股票行操作数 */
  stockRowActions: number;
  /** 个股详情扩展区块数 */
  stockDetailSections: number;
  /** 内置 MCP 服务器数 */
  agentServers: number;
}

/** 插件配置：随插件定义一起下发的只读参数（对标 dsh 的配置层） */
export type PluginConfig = Record<string, unknown>;

/** 插件设置字段的类型（通用表单渲染器按类型分派控件） */
export type PluginSettingFieldType = 'boolean' | 'number' | 'text' | 'select';

/** select 类型字段的可选项 */
export interface PluginSettingFieldOption {
  /** 存储值 */
  value: string | number;
  /** 展示文案 */
  label: string;
}

/**
 * 插件设置字段声明（清单式 schema，宿主据此渲染通用设置表单）
 *
 * 复杂交互（如表格列显隐排序）用 `PluginSettingsDeclaration.component` 自定义，
 * 简单键值配置用 fields 由宿主统一渲染，插件零 UI 代码。
 */
export interface PluginSettingField {
  /** 配置键（存进 settings JSON 的字段名） */
  key: string;
  /** 展示名 */
  label: string;
  /** 一句话说明（字段下方的小字提示） */
  description?: string;
  /** 控件类型 */
  type: PluginSettingFieldType;
  /** 默认值（用户未配置时的生效值） */
  default?: string | number | boolean;
  /** number 类型的最小值 */
  min?: number;
  /** number 类型的最大值 */
  max?: number;
  /** number 类型的步长 */
  step?: number;
  /** select 类型的可选项 */
  options?: readonly PluginSettingFieldOption[];
}

/**
 * 插件设置声明（挂在插件清单 `settings` 字段上）
 *
 * 二选一或混用：
 * - `fields`：声明式 schema，宿主渲染通用表单（改动即时生效）；
 * - `component`：插件自带设置组件，宿主渲染时注入 `settings`（PluginSettingsStore）prop，
 *   组件自行读写 settings 并负责自己的交互（适合列编辑器这类复杂 UI）。
 */
export interface PluginSettingsDeclaration {
  /** 设置区标题（缺省用插件名） */
  title?: string;
  /** 设置区说明（弹窗里渲染在标题下的小字） */
  description?: string;
  /** 声明式字段（宿主通用表单渲染） */
  fields?: readonly PluginSettingField[];
  /** 自定义设置组件（props 注入 settings: PluginSettingsStore） */
  component?: Component;
}

/** 插件设置存取句柄（值持久化在插件 storage 的 `settings` 键下，即插件 JSON 的 settings 字段） */
export interface PluginSettingsStore {
  /** 当前生效值（响应式对象，已并入声明默认值；computed 可直接依赖） */
  readonly values: Record<string, unknown>;
  /**
   * 读一个设置值
   * @param key 配置键
   * @param fallback 未配置时的回退值
   * @returns 当前值
   */
  get: <T>(key: string, fallback: T) => T;
  /**
   * 写一个设置值（即时持久化 + 响应式生效）
   * @param key 配置键
   * @param value 新值（可序列化）
   */
  set: (key: string, value: unknown) => void;
  /** 清空全部已保存设置，回到声明默认值 */
  reset: () => void;
}

/**
 * 插件定义（插件包的唯一出口）
 *
 * 插件 = 「一份声明（元信息 + 依赖）」+「一个 apply 入口（贡献点注册）」。
 * 元信息里的 `inject` 让内核按依赖拓扑决定挂载顺序与等待关系，
 * 因此插件之间的协作不依赖 import 顺序。
 */
export interface PluginDefinition {
  /** 全局唯一 id（kebab-case，内置插件约定 `dsh-` 前缀） */
  id: string;
  /** 展示名（中文） */
  name: string;
  /** 语义化版本 */
  version: string;
  /** 一句话说明（插件管理弹窗展示） */
  description: string;
  /** 作者（缺省「内置」） */
  author?: string;
  /**
   * 依赖声明（字符串既可为**插件 id** 也可为**服务名**，内核按「插件已挂载或服务已提供」判定就绪）：
   * 任一未就绪则本插件停在「等待依赖」状态，提供方挂载 / provide 后自动续挂
   */
  inject?: readonly string[];
  /** 插件配置（等价 dsh 的配置层：不改源码即可换实现 / 调参数） */
  config?: PluginConfig;
  /**
   * 插件设置声明（清单的 settings 字段：宿主据此渲染通用设置弹窗，
   * 运行时值经 `ctx.settings` 读写并持久化在插件 storage 的 `settings` 键下）
   */
  settings?: PluginSettingsDeclaration;
  /**
   * 挂载入口：所有贡献点都在这里经 `ctx` 声明
   *
   * 内核在调用前自动清理该插件的副作用作用域，因此 apply 抛错不会留下半挂载状态。
   * @param ctx 插件上下文
   */
  apply: (ctx: PluginContext) => void | Promise<void>;
}

/**
 * 插件上下文（插件与内核之间的唯一接口）
 *
 * 一切以 `ctx.` 开头的注册都会在插件卸载时自动撤销，插件**不需要**写反向逻辑。
 */
/**
 * 插件 Vue 运行时句柄（第三方插件写不了 import，这是它唯一的来源）
 *
 * 用户插件是运行时被包成 Blob URL 动态 import 的一段字符串，没有任何打包器参与
 * 模块解析，因此它**拿不到 `vue` 包**（写 `import { h } from 'vue'` 必然失败）。
 * 而渲染函数组件恰恰需要 h / ref 这一套才写得出「有状态、会重渲染」的 UI。
 *
 * 宿主把这些能力以句柄形式挂到 `ctx.vue` 上：插件既不需要 import，也不需要关心
 * 宿主用的是哪个 Vue 版本 —— 版本一致性由宿主保证。
 *
 * **这里是整个 vue 命名空间**（早期只挑了 9 个常用成员，结果插件用到 `shallowRef` /
 * `effectScope` 时拿不到）。保持全量还有一层意义：`.vue` 编译产物会引用
 * `createElementVNode` / `openBlock` / `mergeProps` 等一批内部 API，
 * 只有全量才能覆盖（详见 PLUGIN_WIKI §8.2 的打包一节）。
 */
export type PluginVueRuntime = Readonly<typeof Vue>;

/** 插件上下文（`apply(ctx)` 的唯一入参） */
export interface PluginContext {
  /** 当前插件 id */
  readonly pluginId: string;
  /** 当前插件配置（只读） */
  readonly config: PluginConfig;
  /** 插件日志器 */
  readonly logger: PluginLogger;
  /** 插件自有持久化（命名空间隔离） */
  readonly storage: PluginStorage;
  /** Vue 运行时句柄（h / ref / computed …，第三方插件写不了 import，能力从这里取） */
  readonly vue: PluginVueRuntime;
  /** 插件设置（清单 settings 字段的运行时存取，值持久化在 storage 的 `settings` 键下） */
  readonly settings: PluginSettingsStore;
  /** 插件通用数据库（每插件独立表，见 PluginDatabase） */
  readonly db: PluginDatabase;

  /** 左侧栏面板贡献点 */
  readonly sidebar: SidebarContributor;
  /** 左侧导航菜单贡献点 */
  readonly menu: MenuContributor;
  /** 路由贡献点 */
  readonly router: RouterContributor;
  /** 右侧停靠面板贡献点 */
  readonly dock: DockContributor;
  /** 顶栏条目贡献点（应用顶栏右侧工具条注入入口） */
  readonly header: HeaderContributor;
  /** 命令贡献点 */
  readonly command: CommandContributor;
  /** 股票行操作贡献点（在股票行表格的操作列注入按钮） */
  readonly stockRow: StockRowContributor;
  /** 个股详情扩展区贡献点（在个股详情面板注入扩展区块） */
  readonly stockDetail: StockDetailContributor;
  /** Agent 工具贡献点 */
  readonly agent: AgentContributor;

  /**
   * 执行一次带清理的副作用（立即执行，插件卸载时回调清理函数）
   * @param effect 副作用函数，可返回清理函数
   * @returns 撤销句柄（手动撤销后，卸载时不再重复清理）
   */
  effect: (effect: () => void | (() => void)) => Disposable;

  /**
   * 注册「插件卸载时执行」的回调（不立即执行，与 effect 的区别）
   * @param listener 卸载回调
   */
  onDispose: (listener: () => void) => void;

  /**
   * 贡献一个服务
   * @param name 服务名（见 AppServiceMap）
   * @param impl 服务实现
   */
  provide: <K extends keyof AppServiceMap>(name: K, impl: AppServiceMap[K]) => void;

  /**
   * 注入一个服务（依赖缺失时返回 undefined，插件应自行降级）
   * @param name 服务名
   * @returns 服务实现；未提供时 undefined
   */
  consume: <K extends keyof AppServiceMap>(name: K) => AppServiceMap[K] | undefined;

  /**
   * 订阅事件（内置事件名走 `AppEventMap` 强类型分支，插件自定义事件名走宽松分支）
   * @param name 事件名
   * @param handler 处理函数
   * @returns 取消订阅句柄（插件卸载时内核自动取消）
   */
  on: {
    <K extends keyof AppEventMap>(
      name: K,
      handler: (...args: AppEventMap[K]) => void,
    ): Disposable;
    (name: string, handler: (...args: unknown[]) => void): Disposable;
  };

  /**
   * 广播一个事件（插件自定义事件名走宽松分支）
   * @param name 事件名
   * @param args 事件参数
   */
  emit: (name: string, ...args: unknown[]) => void;
}
