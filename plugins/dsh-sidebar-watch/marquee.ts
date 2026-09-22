/**
 * 插件 dsh-sidebar-watch · 顶栏轮播行
 *
 * 顶栏收起态展示的那一条「名称 现价 涨跌幅」，由这里构造。
 *
 * 单独成文件的原因：**它是纯函数**（只依赖几个纯 utils，不碰 pinia、不碰网络），
 * 因此可以被冒烟脚本直跑 —— 文案格式与语气（涨 / 跌 / 平）一旦错了，
 * 顶栏那条轮播就会长期挂着错信息，而它恰恰是用户扫得最多的一行。
 * 引擎（monitor.ts）负责取数与判阈值，展示口径放在这里，各自单一职责。
 */
import { WATCH_MARQUEE_SEPARATOR, WATCH_MARQUEE_TONE_BY_TREND } from './constants';
import type { WatchCandidate } from './service';
import type { FormatService, HeaderMarqueeLine } from '../../host/types/plugin.types';
import type { FullQuote } from '../../host/types/stock-quote.types';

/**
 * 造顶栏轮播行（收起态逐条展示的那一行：名称 + 现价 + 涨跌幅）
 *
 * **不做过滤**：还没取到报价的候选也出行（价格 / 涨跌幅用 `--` 占位）——
 * 新加的票要立刻在轮播里露脸，而不是等引擎补拉完报价才出现；
 * 占位只是暂时的，引擎对新候选会补一轮报价（见 monitor.ts），到时自动换成真实数字。
 *
 * @param candidates 候选（已过滤为仍在自选股里的）
 * @param quotes 报价快照（key 为上游原始 `code`，查询走 `format.findQuote`）
 * @param format 宿主格式化服务（价格 / 百分比 / 涨跌语气，口径只有宿主一份）
 * @returns 轮播行（保持候选池顺序）
 */
export const buildMarqueeLines = (
  candidates: readonly WatchCandidate[],
  quotes: Readonly<Record<string, FullQuote>>,
  format: FormatService,
): readonly HeaderMarqueeLine[] => {
  const lines: HeaderMarqueeLine[] = [];
  for (const candidate of candidates) {
    const quote = format.findQuote(quotes, candidate.symbol);
    const name = quote?.name || candidate.name;
    const price = format.price(quote?.price ?? null);
    const percent = format.percent(quote?.changePercent ?? null);
    lines.push({
      text: [name, price, percent].join(WATCH_MARQUEE_SEPARATOR),
      label: name,
      price,
      percent,
      // 只给语气：具体色值由宿主按涨跌主题映射（插件不碰色值）；无报价按「平」处理
      tone: WATCH_MARQUEE_TONE_BY_TREND[format.trend(quote?.changePercent ?? 0)],
    });
  }
  return lines;
};
