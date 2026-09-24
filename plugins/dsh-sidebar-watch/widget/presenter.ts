/**
 * 插件 dsh-sidebar-watch · 小组件展示载荷构造（纯函数）
 *
 * 与主体的 marquee.ts 同一思路：文案与口径一旦错了，小组件就是用户扫得最多的那行字，
 * 因此构造逻辑独立成纯函数、可被冒烟直跑。
 * 数据全部来自主窗口既有盯盘引擎的快照 —— 小组件窗口自身不发任何上游请求。
 *
 * 格式化与符号归一化一律走宿主 `app:format`（口径只有宿主一份）；
 * 上下文列表的 symbol 交给 `app:stock-open` 宿主侧归一化，这里保持原样。
 */
import { HEADER_MARQUEE_TONE } from '../../../host/constants/plugin.constants';
import { isAlertConfigured } from '../alerts';
import { buildMarqueeLines } from '../marquee';
import type { FormatService, StockContextItem } from '../../../host/types/plugin.types';
import type { WatchCandidate } from '../service';
import type { WatchWidgetRow } from './types';
import type { FullQuote } from '../../../host/types/stock-quote.types';

/**
 * 构造小组件轮播行（顶栏轮播同一份口径：名称 + 现价 + 涨跌幅 + 语气）
 *
 * 行与候选按下标一一对应（buildMarqueeLines 不做过滤、保持候选顺序），
 * symbol / 阈值触发态从候选侧补齐 —— 顶栏轮播行本身不带这两个交互字段。
 * @param candidates 候选（已过滤为仍在自选股里的）
 * @param quotes 报价快照（key 为上游原始 `code`，查询走 `format.findQuote`）
 * @param format 宿主格式化服务（价格 / 百分比 / 涨跌语气，口径只有宿主一份）
 * @returns 小组件载荷行（保持候选池顺序）
 */
export const buildWatchWidgetRows = (
  candidates: readonly WatchCandidate[],
  quotes: Readonly<Record<string, FullQuote>>,
  format: FormatService,
): WatchWidgetRow[] => {
  const lines = buildMarqueeLines(candidates, quotes, format);
  return lines.map((line, index) => {
    const candidate = candidates[index];
    return {
      symbol: candidate?.symbol ?? '',
      name: line.label ?? line.text,
      price: line.price ?? '--',
      percent: line.percent ?? '--',
      // 顶栏轮播行的语气是可选字段（类型层面），构造端恒有值，兜底按平盘中性色
      tone: line.tone ?? HEADER_MARQUEE_TONE.FLAT,
      fired: Boolean(candidate && isAlertConfigured(candidate.alert) && !candidate.alert.armed),
    };
  });
};

/**
 * 构造详情页左侧上下文列表（= 盯盘候选，与顶栏下拉「跳详情整页」同一口径）
 *
 * symbol 交给 `app:stock-open` 的宿主侧归一化（契约注释明确），这里保持候选原值；
 * 名称与价格从报价快照补齐，快照未覆盖时回退候选自身字段。
 * @param candidates 候选（已过滤为仍在自选股里的）
 * @param quotes 报价快照
 * @param format 宿主格式化服务（按本地符号查报价）
 * @returns 上下文股票列表
 */
export const buildWatchContextList = (
  candidates: readonly WatchCandidate[],
  quotes: Readonly<Record<string, FullQuote>>,
  format: FormatService,
): StockContextItem[] =>
  candidates.map((candidate) => {
    const quote = format.findQuote(quotes, candidate.symbol);
    return {
      symbol: candidate.symbol,
      name: quote?.name || candidate.name,
      price: quote?.price ?? null,
      changePercent: quote?.changePercent ?? null,
    };
  });
