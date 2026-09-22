/**
 * 插件 dsh-mainline（股票主线）· 取数层
 *
 * 纯解析函数（`parseBoardListHtml` / `parseBoardListSnapshotHtml` / `parseKlineJsonp`）
 * + fetch 包装：解析全部收在纯函数里，冒烟测试可直接喂固定文本断言（不联网）。
 *
 * 数据源与编码（实测）：
 * - 清单页 `q.10jqka.com.cn/thshy/` 是 **GBK** HTML，链接形如
 *   `…/thshy/detail/code/881121/`；必须按 GBK 解码，否则板块名全是乱码。
 *   该页锚点含**全部 90 个行业板块**，表格自带
 *   `涨跌幅 / 总成交额(亿元) / 净流入(亿元) / 上涨家数 / 下跌家数 / 均价 / 领涨股`，
 *   于是「板块宽度 + 资金流」是零增量请求拿到的；⚠️ **表格每页只有 50 行**，
 *   90 个板块分布在两页（50 + 40，第二页须走 ajax 形态），取完要数行数。
 * - 板块日 K `d.10jqka.com.cn/v6/line/48_<code>/<复权>/<file>.js` 是 JSONP 文
 *   `quotebridge_v6_line_48_881121_01_2026({"data":"日期,开,高,低,收,量,额,…;…"})`，
 *   行内字段序为 `日期,开,高,低,收,成交量(股),成交额(元),…`。
 *   文件有**三种形态**，按 `buildKlineCandidates` 的顺序回退：当年 → 近端 `last`
 *   → 去年，每种都试前复权 `01` 与不复权 `00`。近端 `last.js`（≈140 个交易日）
 *   与年 K 同源同口径、重叠日期数值逐日一致，是 502 的主要救援手段。
 * - 两处都要带同花顺 Referer；请求统一经 `proxyFetch`（Tauri 走 Rust 直连 /
 *   浏览器走同源 `/stock-proxy`，域名 `10jqka.com.cn` 已在白名单内）。
 */
import type { MainlineDeps } from './types';
import {
  MAINLINE_SCAN_DELAY_MS,
  MAINLINE_SOURCE,
  THS_BOARD_KLINE_ADJUST_FALLBACK,
  THS_BOARD_KLINE_ADJUST_PRIMARY,
  THS_BOARD_KLINE_FILE_LAST,
  THS_BOARD_KLINE_URL_ATTEMPTS,
  THS_BOARD_KLINE_URL_BASE,
  THS_BOARD_KLINE_URL_MIDDLE,
  THS_BOARD_KLINE_YEAR_FALLBACK,
  THS_BOARD_LIST_MAX_PAGES,
  THS_BOARD_LIST_NEXT_PAGE,
  THS_BOARD_LIST_PAGE_URL_BASE,
  THS_BOARD_LIST_PAGE_URL_SUFFIX,
  THS_BOARD_LIST_URL,
  THS_HTTP_SERVER_ERROR_MIN,
  THS_INDUSTRY_CODE_PREFIX,
  THS_REFERER,
  YUAN_PER_YI,
} from './constants';
import type { BoardDaily, BoardSnapshot, ThsBoardRef } from './types';

/** 清单页里板块链接的代码提取（`detail/code/<6 位数字>/`） */
const BOARD_LIST_CODE_PATTERN = /\/thshy\/detail\/code\/(\d{6})\//g;

/** 清单页里 `…/detail/code/881121/" … >半导体</a>` 的名称提取 */
const BOARD_LIST_ANCHOR_PATTERN =
  /href="[^"]*\/thshy\/detail\/code\/(\d{6})\/"[^>]*>([^<]{1,20})<\/a>/g;

/** 清单页表格行（快照解析用） */
const BOARD_ROW_PATTERN = /<tr[^>]*>([\s\S]*?)<\/tr>/g;

/** 行内的单元格 */
const BOARD_CELL_PATTERN = /<td[^>]*>([\s\S]*?)<\/td>/g;

/** 行内 HTML 标签（取纯文本用） */
const HTML_TAG_PATTERN = /<[^>]*>/g;

/** 快照行识别用的板块代码（行内锚点） */
const BOARD_ROW_CODE_PATTERN = /\/thshy\/detail\/code\/(\d{6})\//;

/** 快照行的最少单元格数（列：序号/板块/涨跌幅/量/额/净流入/上涨/下跌/均价/领涨股/最新价/涨跌幅） */
const BOARD_ROW_MIN_CELLS = 12;

/** 快照行单元格下标（实测列头顺序固定） */
const BOARD_CELL_INDEX = {
  NAME: 1,
  CHANGE_PERCENT: 2,
  AMOUNT: 4,
  NET_INFLOW: 5,
  RISE: 6,
  FALL: 7,
  LEADER: 9,
} as const;

/** 快照行里代表「无数据」的占位文本 */
const VALUE_PLACEHOLDER = new Set(['-', '--', '', '—']);

/** 年 K 行内字段下标（0 起）：日期 / 开 / 高 / 低 / 收 / 成交量 / 成交额 */
const KLINE_FIELD = {
  DATE: 0,
  OPEN: 1,
  HIGH: 2,
  LOW: 3,
  CLOSE: 4,
  VOLUME: 5,
  AMOUNT: 6,
} as const;

/** 年 K 行的最少字段数（少于 7 段视为脏行丢弃） */
const KLINE_MIN_FIELDS = 7;

/** 年 K 日期字段形态：YYYYMMDD */
const KLINE_DATE_LENGTH = 8;

/** 一日涨跌幅计算基数（百分比） */
const PERCENT_SCALE = 100;

/**
 * 按 GBK 解码响应体（同花顺清单页为 GBK；Node 侧无 TextDecoder('gbk') 时退回 UTF-8）
 * @param buffer 响应原始字节
 * @returns 解码后的文本
 */
export const decodeGbk = (buffer: ArrayBuffer): string => {
  try {
    return new TextDecoder('gbk').decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
};

/**
 * 解析同花顺行业板块清单 HTML（纯函数）
 *
 * 同一板块会在页面里出现多次（字母分组导航 + 内容区），按代码去重后返回。
 * 只保留 88 开头（行业板块）的代码，概念板块（885xxx / 30xxxx）不在本期范围。
 * @param html 清单页 HTML 文本（已按 GBK 解码）
 * @returns 板块清单（按页面出现顺序去重）
 */
export const parseBoardListHtml = (html: string): ThsBoardRef[] => {
  const seen = new Set<string>();
  const boards: ThsBoardRef[] = [];

  for (const match of html.matchAll(BOARD_LIST_ANCHOR_PATTERN)) {
    const code = match[1];
    const name = match[2].trim();
    if (!code.startsWith(THS_INDUSTRY_CODE_PREFIX) || !name || seen.has(code)) {
      continue;
    }
    seen.add(code);
    boards.push({ code, name });
  }

  // 兜底：锚点文本缺失时，至少保证代码清单可用（名称以代码占位）
  if (boards.length === 0) {
    for (const match of html.matchAll(BOARD_LIST_CODE_PATTERN)) {
      const code = match[1];
      if (!code.startsWith(THS_INDUSTRY_CODE_PREFIX) || seen.has(code)) continue;
      seen.add(code);
      boards.push({ code, name: code });
    }
  }

  return boards;
};

/**
 * 解析同花顺板块年 K 的 JSONP 文本（纯函数）
 *
 * 涨跌幅不取接口字段（该接口里为空），一律由**相邻收盘价比值**算出，
 * 首日无前收 → 涨跌幅记 0，避免污染累计涨幅。
 * @param text 年 K JSONP 文本
 * @returns 逐日行情（升序）；空数据返回空数组
 */
export const parseKlineJsonp = (text: string): BoardDaily[] => {
  const start = text.indexOf('(');
  const end = text.lastIndexOf(')');
  if (start < 0 || end <= start) return [];

  let payload: { data?: unknown };
  try {
    payload = JSON.parse(text.slice(start + 1, end)) as { data?: unknown };
  } catch {
    return [];
  }
  if (typeof payload.data !== 'string' || payload.data.length === 0) return [];

  const days: BoardDaily[] = [];
  let previousClose: number | null = null;

  for (const row of payload.data.split(';')) {
    const fields = row.split(',');
    if (fields.length < KLINE_MIN_FIELDS) continue;

    const rawDate = fields[KLINE_FIELD.DATE];
    const close = Number(fields[KLINE_FIELD.CLOSE]);
    const amount = Number(fields[KLINE_FIELD.AMOUNT]);
    if (rawDate.length !== KLINE_DATE_LENGTH || !Number.isFinite(close) || close <= 0) continue;

    const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
    const changePercent =
      previousClose !== null && previousClose > 0
        ? ((close - previousClose) / previousClose) * PERCENT_SCALE
        : 0;
    previousClose = close;

    days.push({
      date,
      close,
      changePercent,
      amount: Number.isFinite(amount) && amount > 0 ? amount : 0,
    });
  }

  return days;
};

/**
 * 单元格纯文本（去标签、解码常见实体、收空白）
 * @param html 单元格 HTML
 * @returns 纯文本
 */
const cellText = (html: string): string =>
  html
    .replace(HTML_TAG_PATTERN, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .trim();

/**
 * 单元格数值（占位符与非数一律 null，绝不当 0 用）
 * @param html 单元格 HTML
 * @returns 数值；无法解析为 null
 */
const cellNumber = (html: string): number | null => {
  const text = cellText(html).replace(/,/g, '');
  if (VALUE_PLACEHOLDER.has(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
};

/**
 * 解析同花顺行业清单页的**快照行**（纯函数）
 *
 * 实测行结构（2026-09-18）：`序号 | 板块(带 detail/code 锚点) | 涨跌幅 | 总成交量(万手) |
 * 总成交额(亿元) | 净流入(亿元) | 上涨家数 | 下跌家数 | 均价 | 领涨股 | 最新价 | 涨跌幅`。
 * 这一页一次给全 90 个行业板块（第二页实测为空），所以涨跌家数与净流入是**零额外请求**拿到的。
 * @param html 清单页 HTML（已按 GBK 解码）
 * @returns 每个板块一行的快照（按页面顺序去重）
 */
export const parseBoardListSnapshotHtml = (html: string): BoardSnapshot[] => {
  const rows: BoardSnapshot[] = [];
  const seen = new Set<string>();

  for (const rowMatch of html.matchAll(BOARD_ROW_PATTERN)) {
    const rowHtml = rowMatch[1];
    const codeMatch = BOARD_ROW_CODE_PATTERN.exec(rowHtml);
    if (!codeMatch) continue;

    const code = codeMatch[1];
    if (!code.startsWith(THS_INDUSTRY_CODE_PREFIX) || seen.has(code)) continue;

    const cells = [...rowHtml.matchAll(BOARD_CELL_PATTERN)].map((cell) => cell[1]);
    if (cells.length < BOARD_ROW_MIN_CELLS) continue;
    seen.add(code);

    const amountYi = cellNumber(cells[BOARD_CELL_INDEX.AMOUNT]);
    const netInflowYi = cellNumber(cells[BOARD_CELL_INDEX.NET_INFLOW]);

    rows.push({
      code,
      name: cellText(cells[BOARD_CELL_INDEX.NAME]) || code,
      source: MAINLINE_SOURCE.THS,
      changePercent: cellNumber(cells[BOARD_CELL_INDEX.CHANGE_PERCENT]),
      amount: amountYi === null ? null : amountYi * YUAN_PER_YI,
      netInflow: netInflowYi === null ? null : netInflowYi * YUAN_PER_YI,
      riseCount: cellNumber(cells[BOARD_CELL_INDEX.RISE]),
      fallCount: cellNumber(cells[BOARD_CELL_INDEX.FALL]),
      leaderName: cellText(cells[BOARD_CELL_INDEX.LEADER]),
    });
  }

  return rows;
};

/**
 * 拉取同花顺行业清单页 HTML（GBK 解码后的文本）
 * @param deps 宿主能力集合（http / format / market / ui）
 * @returns 清单页 HTML
 */
const fetchBoardListHtml = async (deps: MainlineDeps): Promise<string> => {
  const response = await deps.http.fetch(THS_BOARD_LIST_URL, {
    headers: { Referer: THS_REFERER },
  });
  if (!response.ok) {
    throw new Error(`同花顺板块清单 HTTP ${response.status}`);
  }
  return decodeGbk(await response.arrayBuffer());
};

/**
 * 合并多页快照行（按代码去重，保持页序）
 * @param pages 每页的快照行
 * @returns 合并后的快照行
 */
export const mergeSnapshotRows = (
  pages: readonly (readonly BoardSnapshot[])[],
): BoardSnapshot[] => {
  const seen = new Set<string>();
  const merged: BoardSnapshot[] = [];
  for (const page of pages) {
    for (const row of page) {
      if (seen.has(row.code)) continue;
      seen.add(row.code);
      merged.push(row);
    }
  }
  return merged;
};

/**
 * 拉取同花顺行业清单页的指定分页（ajax 形态，只返回表格行）
 * @param deps 宿主能力集合（http / format / market / ui）
 * @param page 页码（从 2 开始）
 * @returns 该页 HTML（已按 GBK 解码）
 */
const fetchBoardListPageHtml = async (deps: MainlineDeps, page: number): Promise<string> => {
  const url = `${THS_BOARD_LIST_PAGE_URL_BASE}${page}${THS_BOARD_LIST_PAGE_URL_SUFFIX}`;
  const response = await deps.http.fetch(url, { headers: { Referer: THS_REFERER } });
  if (!response.ok) {
    throw new Error(`同花顺板块清单第 ${page} 页 HTTP ${response.status}`);
  }
  return decodeGbk(await response.arrayBuffer());
};

/**
 * 取某一页清单快照（含同上游间隔；失败返回 null 由调用方降级处理）
 * @param deps 宿主能力集合（http / format / market / ui）
 * @param page 页码
 * @returns 该页快照行；取数或解析失败为 null
 */
const tryFetchBoardListPage = async (
  deps: MainlineDeps,
  page: number,
): Promise<BoardSnapshot[] | null> => {
  try {
    // 频率红线：同一上游连续请求之间留间隔
    await deps.format.delay(MAINLINE_SCAN_DELAY_MS);
    return parseBoardListSnapshotHtml(await fetchBoardListPageHtml(deps, page));
  } catch (error) {
    console.warn(`[plugin] dsh-mainline 清单页第 ${page} 页取数失败`, error);
    return null;
  }
};

/**
 * 拉取同花顺行业清单页（**板块清单 + 全部分页的当日结构快照**）
 *
 * 首页一次请求拿到板块清单（锚点，90 个）与第一页表格（50 行），再翻页补齐剩余行 ——
 * 实测 90 个行业板块分布在 2 页（50 + 40）。
 *
 * 两种解析各自兜底：表格结构若被上游改版，`rows` 变少而 `refs` 仍在 ——
 * 扫描照常进行，只是结构指标覆盖不全（下层按「未采集」处理，界面如实标注），
 * 不会因为一个新字段解析失败就整轮扫描失败。翻页失败同样只降级、不抛错。
 * @param deps 宿主能力集合（http / format / market / ui）
 * @returns 板块清单与全部分页的快照行
 */
export const fetchThsBoardPage = async (deps: MainlineDeps): Promise<{
  refs: ThsBoardRef[];
  rows: BoardSnapshot[];
}> => {
  const html = await fetchBoardListHtml(deps);
  const refs = parseBoardListHtml(html);
  const pages: BoardSnapshot[][] = [parseBoardListSnapshotHtml(html)];

  for (let page = THS_BOARD_LIST_NEXT_PAGE; page <= THS_BOARD_LIST_MAX_PAGES; page += 1) {
    const pageRows = await tryFetchBoardListPage(deps, page);
    if (pageRows === null) break;
    const known = new Set(mergeSnapshotRows(pages).map((row) => row.code));
    if (pageRows.every((row) => known.has(row.code))) break;
    pages.push(pageRows);
  }

  const rows = mergeSnapshotRows(pages);
  if (refs.length === 0 && rows.length === 0) {
    throw new Error('同花顺板块清单解析为空');
  }
  return { refs: refs.length > 0 ? refs : rows.map((row) => ({ code: row.code, name: row.name })), rows };
};

/** 年 K 候选文件（`file` 为年份数字串或近端文件段 `last`） */
export interface ThsKlineCandidate {
  /** 文件名段：`2026` 或 `last` */
  file: string;
  /** 复权段：`01` 前复权 / `00` 不复权 */
  adjust: string;
}

/**
 * 构造板块日 K 的候选 URL 段（纯函数，便于冒烟断言回退顺序）
 *
 * 顺序：当年 01 → 当年 00 → **近端 01/last → 近端 00/last** → 去年 01 → 去年 00。
 * 近端文件排在去年之前：它是同源同口径的热点文件，实测能救回「年文件 502」的板块，
 * 且近半年数据对 5/20 日量能与 60 日价格分位比去年的旧数据更有用。
 * @param year 年份（如 2026）
 * @returns 候选列表（按尝试优先级）
 */
export const buildKlineCandidates = (year: number): ThsKlineCandidate[] => {
  const candidates: ThsKlineCandidate[] = [];
  const pushFile = (file: string): void => {
    candidates.push(
      { file, adjust: THS_BOARD_KLINE_ADJUST_PRIMARY },
      { file, adjust: THS_BOARD_KLINE_ADJUST_FALLBACK },
    );
  };

  pushFile(String(year));
  pushFile(THS_BOARD_KLINE_FILE_LAST);
  for (let back = 1; back <= THS_BOARD_KLINE_YEAR_FALLBACK; back += 1) {
    pushFile(String(year - back));
  }
  return candidates;
};

/**
 * 拉取单个板块的年度日 K（同花顺）
 *
 * 回退链见 `buildKlineCandidates`（当年/近端/去年的前复权与不复权共 6 个候选），
 * 首个解析出行的胜出；同一候选 URL 遇 5xx 网关错误会在原地小步重试一次。
 * @param deps 宿主能力集合（http / format / market / ui）
 * @param code 板块代码（88xxxx）
 * @param year 年份（如 2026）
 * @returns 逐日行情（升序）；全部候选都取不到时抛错
 */
export const fetchThsBoardKline = async (
  deps: MainlineDeps,
  code: string,
  year: number,
): Promise<BoardDaily[]> => {
  const candidates = buildKlineCandidates(year);

  let lastError = '';
  for (const candidate of candidates) {
    const url = `${THS_BOARD_KLINE_URL_BASE}${code}${THS_BOARD_KLINE_URL_MIDDLE}${candidate.adjust}/${candidate.file}.js`;
    // 网关会瞬时 5xx（实测同代码换复权参数立即 200），同一候选先原地小步重试再换下一个
    for (let attempt = 0; attempt < THS_BOARD_KLINE_URL_ATTEMPTS; attempt += 1) {
      try {
        const response = await deps.http.fetch(url, { headers: { Referer: THS_REFERER } });
        if (!response.ok) {
          lastError = `HTTP ${response.status}`;
          const retryable =
            response.status >= THS_HTTP_SERVER_ERROR_MIN &&
            attempt + 1 < THS_BOARD_KLINE_URL_ATTEMPTS;
          if (retryable) {
            await deps.format.delay(MAINLINE_SCAN_DELAY_MS);
            continue;
          }
          break;
        }
        const days = parseKlineJsonp(decodeGbk(await response.arrayBuffer()));
        if (days.length > 0) return days;
        lastError = '空数据';
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        break;
      }
    }
  }
  throw new Error(`同花顺板块日K不可用：${code}（${lastError}）`);
};
