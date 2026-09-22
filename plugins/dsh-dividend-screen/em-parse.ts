/**
 * 插件 dsh-dividend-screen（股息筛选）· 纯解析层
 *
 * 三个解析函数只做「上游文本 → 类型化行」，不联网、无副作用，
 * 冒烟测试直接喂真实响应文本断言（见 `.ai/tmp/dividend-screen-smoke.mjs`）。
 *
 * 数值纪律：`"-"` / 空 / 非数一律 null —— 绝不把「无数据」当 0
 * （0 是合法业务值：分红为零、增速为零都真实存在，混进 null 会污染推算）。
 */
import {
  EM_BALANCE_FIELD,
  EM_DIVIDEND_FIELD,
  EM_PERF_FIELD,
  EM_RANK_FIELD,
  SHARES_PER_TEN_BONUS,
} from './constants';
import type {
  DebtSnapshot,
  DividendAggregate,
  DividendEvent,
  PerfRow,
  RankBaseRow,
} from './types';

/**
 * 数值字段（非有限数一律 null）
 * @param value 原始字段值
 * @returns 数值；无法解析为 null
 */
export const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const text = value.trim();
    if (text === '' || text === '-') return null;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

/**
 * 文本字段（非字符串一律空串）
 * @param value 原始字段值
 * @returns 去空白后的文本
 */
export const toText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * 解析 clist 股息率排行单页（纯函数）
 *
 * `data.diff` 带 `np=1` 时是数组，历史形态也可能是对象映射，两种都兼容；
 * `data.total` 是上游自报的全市场行数（样本池覆盖率的分母）。
 * @param text 响应文本（UTF-8 JSON）
 * @returns `{ rows, total }`；rows 按返回顺序（已按股息率降序），total 解析不到为 null
 */
export const parseRankPage = (text: string): { rows: RankBaseRow[]; total: number | null } => {
  let payload: { data?: { diff?: unknown; total?: unknown } };
  try {
    payload = JSON.parse(text) as { data?: { diff?: unknown; total?: unknown } };
  } catch {
    return { rows: [], total: null };
  }

  const total = toNumber(payload.data?.total);
  const diff = payload.data?.diff;
  const rawRows: unknown[] = Array.isArray(diff)
    ? diff
    : diff && typeof diff === 'object'
      ? Object.values(diff)
      : [];

  const rows: RankBaseRow[] = [];
  for (const raw of rawRows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const code = toText(row[EM_RANK_FIELD.CODE]);
    const name = toText(row[EM_RANK_FIELD.NAME]);
    if (!code || !name) continue;
    rows.push({
      code,
      name,
      price: toNumber(row[EM_RANK_FIELD.PRICE]),
      changePercent: toNumber(row[EM_RANK_FIELD.CHANGE_PERCENT]),
      marketCap: toNumber(row[EM_RANK_FIELD.MARKET_CAP]),
      pb: toNumber(row[EM_RANK_FIELD.PB]),
      totalShares: toNumber(row[EM_RANK_FIELD.TOTAL_SHARES]),
      peTtm: toNumber(row[EM_RANK_FIELD.PE_TTM]),
      ttmYield: toNumber(row[EM_RANK_FIELD.DIVIDEND_YIELD]),
    });
  }
  return { rows, total };
};

/**
 * 解析 datacenter 业绩报表响应（纯函数）
 * @param text 响应文本（UTF-8 JSON）
 * @returns 业绩行（未披露的股票不在返回里，调用方以「缺席 = 未披露」处理）
 */
export const parsePerfRows = (text: string): PerfRow[] => {
  let payload: { result?: { data?: unknown } };
  try {
    payload = JSON.parse(text) as { result?: { data?: unknown } };
  } catch {
    return [];
  }
  const rawRows = payload.result?.data;
  if (!Array.isArray(rawRows)) return [];

  const rows: PerfRow[] = [];
  for (const raw of rawRows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const code = toText(row[EM_PERF_FIELD.CODE]);
    if (!code) continue;
    rows.push({
      code,
      netProfit: toNumber(row[EM_PERF_FIELD.NET_PROFIT]),
      netProfitYoY: toNumber(row[EM_PERF_FIELD.NET_PROFIT_YOY]),
      revenueYoY: toNumber(row[EM_PERF_FIELD.REVENUE_YOY]),
      industry: toText(row[EM_PERF_FIELD.INDUSTRY]),
      ocfPerShare: toNumber(row[EM_PERF_FIELD.OCF_PER_SHARE]),
    });
  }
  return rows;
};

/**
 * 解析 datacenter 分红明细响应（纯函数，逐事件）
 *
 * 多期合并查询（`REPORT_DATE in (...)`）后事件按报告期分组，`reportDate`
 * 由上游 `REPORT_DATE` 截前 10 位得到（上游形如 `2025-12-31 00:00:00`）。
 * @param text 响应文本（UTF-8 JSON）
 * @returns 分红事件行（纯转增 / 派息字段为空 / 缺报告期的方案被过滤）
 */
export const parseDividendEvents = (text: string): DividendEvent[] => {
  let payload: { result?: { data?: unknown } };
  try {
    payload = JSON.parse(text) as { result?: { data?: unknown } };
  } catch {
    return [];
  }
  const rawRows = payload.result?.data;
  if (!Array.isArray(rawRows)) return [];

  const events: DividendEvent[] = [];
  for (const raw of rawRows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const code = toText(row[EM_DIVIDEND_FIELD.CODE]);
    const perTen = toNumber(row[EM_DIVIDEND_FIELD.BONUS_PER_TEN]);
    const reportDate = toText(row[EM_DIVIDEND_FIELD.REPORT_DATE]).slice(0, 10);
    if (!code || !reportDate || perTen === null || perTen <= 0) continue;
    events.push({
      code,
      dps: perTen / SHARES_PER_TEN_BONUS,
      totalShares: toNumber(row[EM_DIVIDEND_FIELD.TOTAL_SHARES]),
      reportDate,
      exDate: toText(row[EM_DIVIDEND_FIELD.EX_DATE]).slice(0, 10) || null,
    });
  }
  return events;
};

/**
 * 取两条实施日中最新的非空值（纯函数；同报告期多条方案时除息日可能不同）
 * @param a 现有聚合的实施日（可为 null）
 * @param b 新事件实施日（可为 null）
 * @returns 较新的非空实施日；两者皆空为 null
 */
const latestExDate = (a: string | null, b: string | null): string | null => {
  if (!a) return b ?? null;
  if (!b) return a;
  return a > b ? a : b;
};

/**
 * 按（代码 × 报告期）分组聚合分红事件（纯函数；同代码同报告期多条方案求和，
 * 实施日取最新非空 —— TTM 归集按实施日锚定）
 * @param events 分红事件行
 * @returns 代码 → 报告期（`YYYY-MM-DD`）→ 聚合结果
 */
export const groupDividendEventsByDate = (
  events: readonly DividendEvent[],
): Map<string, Map<string, DividendAggregate>> => {
  const grouped = new Map<string, Map<string, DividendAggregate>>();
  for (const event of events) {
    let byDate = grouped.get(event.code);
    if (!byDate) {
      byDate = new Map<string, DividendAggregate>();
      grouped.set(event.code, byDate);
    }
    const current = byDate.get(event.reportDate);
    if (current) {
      byDate.set(event.reportDate, {
        code: event.code,
        dps: current.dps + event.dps,
        totalShares: event.totalShares ?? current.totalShares,
        exDate: latestExDate(current.exDate ?? null, event.exDate ?? null),
      });
    } else {
      byDate.set(event.reportDate, {
        code: event.code,
        dps: event.dps,
        totalShares: event.totalShares,
        exDate: event.exDate ?? null,
      });
    }
  }
  return grouped;
};

/**
 * 解析 datacenter 资产负债表摘要响应（纯函数）
 * @param text 响应文本（UTF-8 JSON）
 * @returns 负债率行（同一代码多报告期时保留全部，由取数层择新）
 */
export const parseDebtRows = (text: string): DebtSnapshot[] => {
  let payload: { result?: { data?: unknown } };
  try {
    payload = JSON.parse(text) as { result?: { data?: unknown } };
  } catch {
    return [];
  }
  const rawRows = payload.result?.data;
  if (!Array.isArray(rawRows)) return [];

  const rows: DebtSnapshot[] = [];
  for (const raw of rawRows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const code = toText(row[EM_BALANCE_FIELD.CODE]);
    const reportDate = toText(row[EM_BALANCE_FIELD.REPORT_DATE]).slice(0, 10);
    const ratio = toNumber(row[EM_BALANCE_FIELD.DEBT_ASSET_RATIO]);
    if (!code || !reportDate || ratio === null) continue;
    rows.push({ code, ratio, reportDate });
  }
  return rows;
};
