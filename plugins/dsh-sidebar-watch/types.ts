/**
 * 插件 dsh-sidebar-watch（自选盯盘）· 宿主能力依赖声明
 *
 * 本插件最终以**单文件产物**形态分发（zip 包，运行时由宿主动态装载），
 * 运行时拿不到任何宿主模块 —— 所有宿主能力只能由 `plugin.ts` 在 `apply(ctx)`
 * 里从服务容器取好、经 props（或工厂入参）沿调用链注入下来。
 *
 * 这一个接口就是那条依赖链的显式声明：看它就知道插件用了宿主什么。
 */
// 宿主服务契约只需要**类型**：`import type` 打包后完全消失，产物里不存在任何
// 宿主模块的引用，但源码仍然享受完整的类型检查
import type {
  FormatService,
  PollingService,
  QuotesService,
  StockOpenService,
  UiKitService,
  WatchlistService,
} from '../../host/types/plugin.types';
import type { NotifyService } from '../../host/types/notify.types';

/**
 * 盯盘插件运行所需的宿主能力（依赖注入容器）
 */
export interface WatchDeps {
  /** 宿主 UI Kit（弹窗 / 骨架屏 / 按钮 / 输入框 / 图标） */
  ui: UiKitService;
  /** 格式化与涨跌语义（价格 / 百分比 / 涨跌色 / 符号归一化 / 按符号查报价） */
  format: FormatService;
  /** 行情报价（盯盘引擎每轮批量取现价） */
  quotes: QuotesService;
  /** 轮询调度器工厂（交易窗口 / 退避 / 可见性四份策略只有宿主一份实现） */
  polling: PollingService;
  /** 全站统一的个股打开交互（点提醒跳详情侧栏 / 点行跳详情整页） */
  stockOpen: StockOpenService;
  /** 自选股只读视图（监控范围 = 候选池 ∩ 自选股） */
  watchlist: WatchlistService;
  /** 应用级浮窗（阈值到价提醒；宿主未提供时只记日志） */
  notify?: NotifyService;
  /** 路由跳转（命令不在组件上下文里，拿不到 router） */
  navigate: (path: string) => void;
  /** 按面板 key 关闭面板（顶栏下拉点完自己收起，不再依赖宿主内部 inject 上下文） */
  closePanel: (panelKey: string) => void;
}
