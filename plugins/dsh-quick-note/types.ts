/**
 * 插件 dsh-quick-note（速记）· 宿主能力依赖声明
 *
 * 本插件最终以**单文件产物**形态分发（zip 包，运行时由宿主动态装载），
 * 运行时拿不到任何宿主模块 —— 所有宿主能力只能由 `plugin.ts` 在 `apply(ctx)`
 * 里从服务容器取好、经 props 沿调用链注入下来。
 *
 * 这一个接口就是那条依赖链的显式声明：看它就知道插件用了宿主什么。
 */
// 宿主服务契约只需要**类型**：`import type` 打包后完全消失，产物里不存在任何
// 宿主模块的引用，但源码仍然享受完整的类型检查
import type {
  FormatService,
  QuotesService,
  StockOpenService,
  StockPickerService,
  UiKitService,
  WatchlistService,
} from '../../host/types/plugin.types';

/**
 * 速记插件运行所需的宿主能力（依赖注入容器）
 */
export interface QuickNoteDeps {
  /** 宿主 UI Kit（按钮 / 空态 / 图标） */
  ui: UiKitService;
  /** 格式化（相对时间、完整符号 → 裸代码） */
  format: FormatService;
  /** 全站统一的个股打开交互（点关联标签直达详情侧栏） */
  stockOpen: StockOpenService;
  /** 选股弹窗（宿主渲染，Promise 回传结果） */
  stockPicker: StockPickerService;
  /** 自选股只读视图（按符号查名称） */
  watchlist: WatchlistService;
  /** 行情报价（自选股里查不到名称时，用它兜底取一次现价快照拿名称） */
  quotes: QuotesService;
  /** 按面板 key 关闭面板（「保存并关闭」不再依赖宿主内部 inject 上下文） */
  closePanel: (panelKey: string) => void;
}
