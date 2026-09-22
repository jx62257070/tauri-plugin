/**
 * 行情相关类型统一出口：re-export stock-sdk 的报价模型
 *
 * 业务代码从本文件导入，避免直接依赖 SDK 内部路径；
 * 若 SDK 字段与展示需求有出入，在本目录补充映射类型
 */
export type { FullQuote, SimpleQuote, SearchResult } from 'stock-sdk';

/**
 * 报价卡片最小展示字段：完整报价（FullQuote）与轻量报价（如全球指数）通用
 *
 * StockQuoteCard 只消费这四个字段；结构化子类型无需拼凑完整 FullQuote
 */
export interface QuoteCardLike {
  /** 名称 */
  name: string;
  /** 最新价（无数据为 null） */
  price: number | null;
  /** 涨跌幅%（无数据为 null） */
  changePercent: number | null;
  /** 行情时间戳（缺失时卡片闪烁动画退化为按价格触发） */
  timestamp?: number | null;
}
