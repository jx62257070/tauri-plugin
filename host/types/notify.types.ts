/**
 * 应用通知（右侧浮窗）类型契约
 *
 * 这是**宿主级**能力：任何插件都能经 `ctx.consume('app:notify')` 弹一条浮窗提醒，
 * 承载组件由宿主渲染在右下角（跨路由常驻，不受插件面板挂载状态影响）。
 * 语义色沿用全站涨跌 token，因此浮窗天然跟随 `data-trend` 主题。
 */
import type { NOTIFY_TONE } from '../constants/notify.constants';

/** 浮窗语气（决定强调色；取值见 constants/notify.constants.ts 的 NOTIFY_TONE） */
export type NotifyTone = (typeof NOTIFY_TONE)[keyof typeof NOTIFY_TONE];

/** 请求弹出一条浮窗的参数 */
export interface NotifyOptions {
  /** 主标题（建议「股票名 + 阈值条件」，如「贵州茅台 涨到 1700.00」） */
  title: string;
  /** 次要说明（如「现价 1702.30（+3.21%）」） */
  body?: string;
  /** 语气，默认中性 `flat` */
  tone?: NotifyTone;
  /** 自动消失时长（毫秒）；传 0 表示常驻直到手动关闭。默认见 NOTIFY_DEFAULT_TIMEOUT_MS */
  timeoutMs?: number;
  /** 来源标签（显示在标题上方的小字，如「盯盘提醒」） */
  source?: string;
  /**
   * 去重键：同键浮窗只保留最新一条（旧的被替换并重置倒计时），
   * 用于「同一只票连续触发」时避免刷屏
   */
  dedupeKey?: string;
  /**
   * 浮窗被点击时执行（如打开个股详情）
   *
   * 执行后浮窗自动关闭。注意：回调由调用方（插件）提供，
   * 宿主只负责在点击时调用一次。
   */
  onClick?: () => void;
}

/** 已入队的浮窗（宿主补全 id / 时间戳后的形态） */
export interface AppNotification extends Required<Omit<NotifyOptions, 'onClick'>> {
  /** 唯一 id（宿主生成） */
  id: string;
  /** 入队时间（毫秒时间戳；同时作为展示顺序依据） */
  at: number;
  /** 点击回调（可空） */
  onClick?: () => void;
}

/**
 * 应用通知服务（宿主经 `app:notify` 提供，插件 `ctx.consume` 注入）
 */
export interface NotifyService {
  /**
   * 弹出一条浮窗
   * @param options 浮窗参数
   * @returns 该浮窗的 id（可用于手动关闭）
   */
  notify: (options: NotifyOptions) => string;
  /**
   * 关闭一条浮窗
   * @param id 浮窗 id
   */
  dismiss: (id: string) => void;
  /**
   * 关掉某个来源的全部浮窗（如插件卸载时清掉自己的提醒）
   * @param source 来源标签
   */
  dismissBySource: (source: string) => void;
}
