/**
 * 自选盯盘插件 · 私有常量
 *
 * 插件自成一体：只在本插件内使用的魔法值随插件目录，跨插件复用才上提到 `src/constants/`
 */
// 宿主模块只剩 `import type`：打包后完全消失（产物里不允许任何 import），
// 但源码仍然享受完整的类型检查
import type { Trend } from '../../host/constants/trend.constants';
import type { HeaderMarqueeTone } from '../../host/types/plugin.types';
import type { NotifyTone } from '../../host/types/notify.types';

/** 顶栏条目 id（内核会拼成 `dsh-sidebar-watch#<id>` 全局键） */
export const WATCH_HEADER_ITEM_ID = 'watch';

/** 顶栏条目名（触发按钮提示 / 下拉面板标题；无可轮播内容时的占位文案） */
export const WATCH_HEADER_ITEM_TITLE = '自选盯盘';

/** 顶栏条目图标（MenuIcon key：铃铛，与阈值提醒语义一致） */
export const WATCH_HEADER_ITEM_ICON = 'bell';

/** 加载中的骨架行数 */
export const WATCH_SKELETON_ROWS = 4;

/** 空态引导文案（说清候选从哪来，避免用户以为面板坏了） */
export const WATCH_EMPTY_HINT = '在自选股「操作」列点一下「盯盘」，这只票就会盯在这里';

/** 轮播行里「名称 现价 涨跌幅」的分隔符 */
export const WATCH_MARQUEE_SEPARATOR = ' ';

/**
 * 轮播语气（与宿主 `HEADER_MARQUEE_TONE` 同字面量）
 *
 * 本插件以单文件产物分发，拿不到宿主的常量对象，因此这里私有一份**字面量**：
 * 值不一致会在类型层（`satisfies`）直接报错，不会等到运行时才发现轮播不上色。
 */
const WATCH_MARQUEE_TONE = {
  UP: 'up',
  DOWN: 'down',
  FLAT: 'flat',
} as const satisfies Record<string, HeaderMarqueeTone>;

/**
 * 涨跌方向 → 轮播行色调
 *
 * 插件只声明语气（涨 / 跌 / 平），具体色值由宿主按涨跌主题映射
 * （见 `constants/header.constants.ts` 的 HEADER_MARQUEE_TONE_CLASS）。
 */
export const WATCH_MARQUEE_TONE_BY_TREND: Record<Trend, HeaderMarqueeTone> = {
  up: WATCH_MARQUEE_TONE.UP,
  down: WATCH_MARQUEE_TONE.DOWN,
  flat: WATCH_MARQUEE_TONE.FLAT,
};

/** 行操作 id（内核会拼成 `dsh-sidebar-watch#<id>` 全局键） */
export const STOCK_ROW_ACTION_ID = 'watch-toggle';

/** 行操作文案（未加入候选时） */
export const STOCK_ROW_ACTION_TITLE = '盯盘';

/** 行操作文案（已在候选池里） */
export const STOCK_ROW_ACTION_ACTIVE_TITLE = '取消盯盘';

/** 行操作图标（MenuIcon key：眼睛 = 盯盘） */
export const STOCK_ROW_ACTION_ICON = 'eye';

// ---------- 阈值提醒 ----------

/** 阈值类型 */
export const WATCH_ALERT_KIND = {
  /** 未设阈值 */
  NONE: '',
  /** 按价格设阈值（元） */
  PRICE: 'price',
  /** 按涨跌幅设阈值（%） */
  CHANGE: 'change',
} as const satisfies Record<string, string>;

/** 阈值比较方向 */
export const WATCH_ALERT_DIRECTION = {
  /** 涨到 / 达到或超过 */
  ABOVE: 'above',
  /** 跌到 / 达到或低于 */
  BELOW: 'below',
} as const satisfies Record<string, string>;

/** 阈值类型下拉选项文案 */
export const WATCH_ALERT_KIND_LABEL: Record<string, string> = {
  [WATCH_ALERT_KIND.NONE]: '不提醒',
  [WATCH_ALERT_KIND.PRICE]: '价格',
  [WATCH_ALERT_KIND.CHANGE]: '涨跌幅',
};

/** 比较方向下拉选项文案（价格态） */
export const WATCH_ALERT_DIRECTION_PRICE_LABEL: Record<string, string> = {
  [WATCH_ALERT_DIRECTION.ABOVE]: '涨到',
  [WATCH_ALERT_DIRECTION.BELOW]: '跌到',
};

/** 比较方向下拉选项文案（涨跌幅态） */
export const WATCH_ALERT_DIRECTION_CHANGE_LABEL: Record<string, string> = {
  [WATCH_ALERT_DIRECTION.ABOVE]: '涨幅达到',
  [WATCH_ALERT_DIRECTION.BELOW]: '跌幅达到',
};

/**
 * 价格阈值「重新武装」的相对回差
 *
 * 触发一次后不再重复提醒，直到价格回到阈值内侧并**多走这么多**才重新武装。
 * 没有回差的话，价格在阈值上下抖动会触发刷屏（真实盯盘里最常见的抱怨）。
 */
export const WATCH_ALERT_REARM_PRICE_RATIO = 0.001;

/** 涨跌幅阈值「重新武装」的绝对回差（百分点） */
export const WATCH_ALERT_REARM_CHANGE_MARGIN = 0.1;

/**
 * 新增候选「补拉报价」的防抖间隔（毫秒）
 *
 * 候选池出现还没取过价的 symbol 时立即补一轮报价（交易窗口外调度器不再轮询，
 * 不补的话新候选永远不进轮播 / 明细）；连续增删多只时防抖合并成一次取数，
 * 仍是单次批量请求，不碰东财频率红线。
 */
export const WATCH_QUOTE_CATCHUP_DEBOUNCE_MS = 800;

/** 阈值编辑器标题 */
export const WATCH_ALERT_EDITOR_TITLE = '阈值提醒';

/** 阈值编辑器说明文案 */
export const WATCH_ALERT_EDITOR_HINT = '到价后右下角弹提醒；触发过一次，等回到阈值内侧再重新生效';

/** 未设阈值时行内按钮的提示文案 */
export const WATCH_ALERT_BUTTON_TITLE = '设阈值提醒';

/** 已设阈值时行内按钮的提示文案 */
export const WATCH_ALERT_BUTTON_ACTIVE_TITLE = '调整阈值提醒';

/** 阈值输入框占位文案（价格态） */
export const WATCH_ALERT_INPUT_PLACEHOLDER_PRICE = '如 1700.00';

/** 阈值输入框占位文案（涨跌幅态） */
export const WATCH_ALERT_INPUT_PLACEHOLDER_CHANGE = '如 5.00';

/** 阈值提醒的浮窗来源标签（宿主用它做「同类只占一格」与插件卸载时的清场） */
export const WATCH_NOTIFY_SOURCE = '盯盘提醒';

/**
 * 阈值提醒的语气（与宿主 `NOTIFY_TONE` 同字面量）
 *
 * 只用到涨 / 跌两个：提醒语气跟的是**触发方向**（设了「跌到」就是坏消息），
 * 与当日涨跌无关。
 */
export const WATCH_ALERT_TONE = {
  UP: 'up',
  DOWN: 'down',
} as const satisfies Record<string, NotifyTone>;

/**
 * 提醒语气 → 文字色类名（与宿主 `NOTIFY_TONE_CLASS[*].label` 同口径）
 *
 * 直接用主题 token 类名而不是自己造色值：Tailwind 是构建期扫描的，
 * 插件独有的类名没有 CSS，只有 token 类（宿主自己也在用）才一定有样式。
 */
export const WATCH_ALERT_TONE_LABEL_CLASS: Record<string, string> = {
  [WATCH_ALERT_TONE.UP]: 'text-up',
  [WATCH_ALERT_TONE.DOWN]: 'text-down',
};

/**
 * 盘中轮询间隔（毫秒）
 *
 * 与宿主 `POLLING_INTERVAL.QUOTES_INTRADAY` 同值：盯的是自选股现价，
 * 快了没意义（上游就是这个刷新率），慢了阈值提醒会迟到。
 */
export const WATCH_POLL_INTERVAL_MS = 4_000;

/** 自选股页路由（命令「打开自选股页」与面板底部入口共用） */
export const WATCHLIST_ROUTE_PATH = '/watchlist';
