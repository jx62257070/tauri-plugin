/**
 * 插件 dsh-mainline（股票主线）· 东方财富兜底取数层（L2.5）
 *
 * 岗位：**只在「同花顺整体不可用」时上岗**（清单页与全部板块日线都取不到），整表降级为东财口径。
 * 单板块失败不走这里 —— 那属于同花顺自己的同源回退链（`ths-data.ts` 的 last.js / 去年文件）
 * 与本地旧数据（L0）的职责，为个别板块引入跨源台阶得不偿失。
 *
 * 纯函数（`parseEmBoardListJson` / `parseEmKlineJson` / `matchThsToEm`）与 fetch 包装分开，
 * 前者可离线冒烟断言（见 `.ai/tmp/mainline-ab-smoke.mjs`）。
 *
 * 数据源与字段（实测 2026-09-18，证据见 `.ai/开发方案/2026-09-18-数据源兜底方案.md`）：
 * - 板块清单 `push2delay.eastmoney.com/api/qt/clist/get?fs=m:90+t:2`：
 *   `data.diff` 每行 `f12` 代码 / `f14` 名称 / `f3` 涨跌幅 / `f6` 成交额(元) /
 *   `f62` 主力净流入(元) / `f104` 上涨家数 / `f105` 下跌家数 / `f128` 领涨股。
 *   实测共 496 个板块（一/二/三级混合）→ **不当板块全集用**，只当「名称 → 代码」映射表。
 * - 板块日 K `push2his.eastmoney.com/api/qt/stock/kline/get?secid=90.<code>`：
 *   `data.klines` 每行 `日期,开,收,高,低,成交量,成交额`（f51~f57，顺序实测如此；
 *   成交额单位元、日期已是 `YYYY-MM-DD`）。
 * - ⚠️ 东财行情域是**突发限速**：间隔 ≥1s 正常、短时连发立刻拒连（停顿约 20s 恢复）
 *   → 兜底轮必须串行（`EM_SCAN_CONCURRENCY = 1`）且间隔 ≥ `EM_SCAN_DELAY_MS`。
 * - 两处都要带东财 Referer；请求统一经 `proxyFetch`（`eastmoney.com` 已在代理白名单与
 *   Tauri capabilities 内）。
 */
import {
  EM_BOARD_FIELD,
  EM_BOARD_KLINE_URL,
  EM_BOARD_LIST_MAX_PAGES,
  EM_BOARD_LIST_PAGE_TOKEN,
  EM_BOARD_LIST_QUERY,
  EM_BOARD_LIST_URL,
  EM_BOARD_SECID_PREFIX,
  EM_FETCH_ATTEMPTS,
  EM_KLINE_ADJUST,
  EM_KLINE_END,
  EM_KLINE_FIELDS,
  EM_KLINE_KLT,
  EM_KLINE_META_FIELDS,
  EM_KLINE_YEARS_BACK,
  EM_REFERER,
  EM_SCAN_DELAY_MS,
  EM_SCAN_RETRY_DELAY_MS,
  EM_UNIVERSE_ROUNDS,
  MAINLINE_SOURCE,
  MAINLINE_THS_TO_EM_ALIAS,
} from './constants';
import type { BoardDaily, BoardSnapshot, EmMappingResult, MainlineDeps, ThsBoardRef } from './types';

/** 东财板块名尾部的罗马数字（Ⅱ / Ⅲ 等，用来标注二级 / 三级行业） */
const EM_BOARD_ROMAN_SUFFIX_PATTERN = /[\u2160-\u2169]+$/;

/** 二级行业标记（剥后缀重名时优先它：同花顺 90 个板块 ≈ 申万二级） */
const EM_BOARD_ROMAN_LEVEL_II = '\u2161';

/** 三级行业标记 */
const EM_BOARD_ROMAN_LEVEL_III = '\u2162';

/** 日 K 行的最少字段数（少于 7 段视为脏行丢弃） */
const EM_KLINE_MIN_FIELDS = 7;

/** 日 K 行内字段下标（实测顺序：日期 / 开 / 收 / 高 / 低 / 量 / 额） */
const EM_KLINE_FIELD = {
  DATE: 0,
  OPEN: 1,
  CLOSE: 2,
  HIGH: 3,
  LOW: 4,
  VOLUME: 5,
  AMOUNT: 6,
} as const;

/** 日 K 日期字段形态：YYYY-MM-DD */
const EM_KLINE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 一日涨跌幅计算基数（百分比） */
const PERCENT_SCALE = 100;

/**
 * 罗马后缀的优先级别（0 = 无后缀，1 = Ⅱ，2 = Ⅲ，3 = 其它）
 * @param name 东财板块名
 * @returns 优先级（越小越优先）
 */
const romanRank = (name: string): number => {
  const match = EM_BOARD_ROMAN_SUFFIX_PATTERN.exec(name);
  if (!match) return 0;
  if (match[0] === EM_BOARD_ROMAN_LEVEL_II) return 1;
  if (match[0] === EM_BOARD_ROMAN_LEVEL_III) return 2;
  return 3;
};

/**
 * 数值字段（`"-"` / 空 / 非数一律 null —— 绝不把「无数据」当 0）
 * @param value 原始字段值
 * @returns 数值；无法解析为 null
 */
const toNumber = (value: unknown): number | null => {
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
const toText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * 解析东财板块清单 JSON（纯函数，同时给出 `total`）
 *
 * `data.diff` 在带 `np=1` 时是数组，历史形态也可能是对象映射，两种都兼容。
 * `data.total` 是**上游自报的全表行数**，用来校验分页有没有漏收（配合稳定排序，
 * 实测 total 与全表去重行数一致；漏收时宁可报错也不静默少收，否则「未映射」名单会凭空变长）。
 * @param text 响应文本（UTF-8 JSON）
 * @returns `{ rows, total }`；rows 为板块快照（按代码去重，保持返回顺序），total 解析不到时为 null
 */
export const parseEmBoardListPageJson = (
  text: string,
): { rows: BoardSnapshot[]; total: number | null } => {
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

  const snapshots: BoardSnapshot[] = [];
  const seen = new Set<string>();
  for (const raw of rawRows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const code = toText(row[EM_BOARD_FIELD.CODE]);
    const name = toText(row[EM_BOARD_FIELD.NAME]);
    if (!code || !name || seen.has(code)) continue;
    seen.add(code);
    snapshots.push({
      code,
      name,
      source: MAINLINE_SOURCE.EM,
      changePercent: toNumber(row[EM_BOARD_FIELD.CHANGE_PERCENT]),
      amount: toNumber(row[EM_BOARD_FIELD.AMOUNT]),
      netInflow: toNumber(row[EM_BOARD_FIELD.NET_INFLOW]),
      riseCount: toNumber(row[EM_BOARD_FIELD.RISE]),
      fallCount: toNumber(row[EM_BOARD_FIELD.FALL]),
      leaderName: toText(row[EM_BOARD_FIELD.LEADER]),
    });
  }
  return { rows: snapshots, total };
};

/**
 * 解析东财板块清单 JSON（纯函数，只要行）
 * @param text 响应文本（UTF-8 JSON）
 * @returns 板块快照（按代码去重，保持返回顺序）
 */
export const parseEmBoardListJson = (text: string): BoardSnapshot[] =>
  parseEmBoardListPageJson(text).rows;

/**
 * 解析东财板块日 K JSON（纯函数）
 *
 * 涨跌幅与同花顺侧一致：由**相邻收盘价比值**算出（不用接口的涨跌幅字段），
 * 首日无前收 → 记 0，避免污染累计涨幅。
 * @param text 响应文本（UTF-8 JSON）
 * @returns 逐日行情（升序）；无数据返回空数组
 */
export const parseEmKlineJson = (text: string): BoardDaily[] => {
  let payload: { data?: { klines?: unknown } };
  try {
    payload = JSON.parse(text) as { data?: { klines?: unknown } };
  } catch {
    return [];
  }

  const klines = payload.data?.klines;
  if (!Array.isArray(klines)) return [];

  const days: BoardDaily[] = [];
  let previousClose: number | null = null;
  for (const raw of klines) {
    if (typeof raw !== 'string') continue;
    const fields = raw.split(',');
    if (fields.length < EM_KLINE_MIN_FIELDS) continue;

    const date = fields[EM_KLINE_FIELD.DATE];
    const close = Number(fields[EM_KLINE_FIELD.CLOSE]);
    const amount = Number(fields[EM_KLINE_FIELD.AMOUNT]);
    if (!EM_KLINE_DATE_PATTERN.test(date) || !Number.isFinite(close) || close <= 0) continue;

    days.push({
      date,
      close,
      changePercent:
        previousClose !== null && previousClose > 0
          ? ((close - previousClose) / previousClose) * PERCENT_SCALE
          : 0,
      amount: Number.isFinite(amount) && amount > 0 ? amount : 0,
    });
    previousClose = close;
  }
  return days;
};

/**
 * 把同花顺板块清单映射到东财板块（纯函数）
 *
 * 匹配只做**同层级语义等价**的两级 + 人工别名表：
 * ① 名称等值；② 剥掉东财的罗马数字后缀（重名时优先「Ⅱ」——同花顺 90 板块≈申万二级）；
 * ③ `MAINLINE_THS_TO_EM_ALIAS` 里语义等价但名称不同的（词序颠倒 / 申万改名）。
 * 不做「唯一前缀」兜底：实测它命中的全是「东财比同花顺粗一级」的板块
 * （`汽车整车` → 东财一级 `汽车`，而零部件已单独映射 → 会把零部件重复计入），
 * 映射不上就**不猜**，落进 `unmapped` 由界面如实列出。
 * @param refs 同花顺板块清单
 * @param emBoards 东财板块清单
 * @returns 映射结果（含未映射名单）
 */
export const matchThsToEm = (
  refs: readonly ThsBoardRef[],
  emBoards: readonly BoardSnapshot[],
): EmMappingResult => {
  const exact = new Map<string, BoardSnapshot>();
  for (const board of emBoards) {
    if (!exact.has(board.name)) exact.set(board.name, board);
  }

  // 剥罗马后缀：同名（如「白酒Ⅱ/白酒Ⅲ」）时保留级别更靠前的一个
  const stripped = new Map<string, BoardSnapshot>();
  for (const board of emBoards) {
    const base = board.name.replace(EM_BOARD_ROMAN_SUFFIX_PATTERN, '');
    if (base === board.name) continue;
    const current = stripped.get(base);
    if (!current || romanRank(board.name) < romanRank(current.name)) stripped.set(base, board);
  }

  /**
   * 名称 → 东财板块（等值 → 剥后缀）
   * @param name 待解析的名称（同花顺板块名，或别名表给出的东财名）
   * @returns 命中的东财板块；未命中 undefined
   */
  const resolve = (name: string): BoardSnapshot | undefined =>
    exact.get(name) ?? stripped.get(name);

  const mapped = new Map<string, BoardSnapshot>();
  const unmapped: string[] = [];
  for (const ref of refs) {
    const target = resolve(ref.name) ?? resolve(MAINLINE_THS_TO_EM_ALIAS[ref.name] ?? '');
    if (target) mapped.set(ref.code, target);
    else unmapped.push(ref.name);
  }
  return { mapped, unmapped };
};

/**
 * 是否应当整表降级东财（L2.5 触发条件，纯函数便于断言）
 *
 * 判定依据是「清单里的**全部**板块日线都取不到」—— 单板块失败属于同花顺自己的
 * 同源回退链（last.js / 去年文件）与本地旧数据该管的事，不该把整表切到另一个口径。
 * @param refCount 本次板块清单长度
 * @param failures 取数失败的板块代码
 * @returns 是否需要整表降级
 */
export const shouldFallbackToEm = (refCount: number, failures: readonly string[]): boolean =>
  refCount > 0 && failures.length === refCount;

/**
 * 拉取东财板块清单的指定页（连接被掐断时原地重试）
 * @param deps 宿主能力集合（http / format / market / ui）
 * @param page 页码（从 1 开始）
 * @returns 该页快照行与上游自报的全表行数
 */
const fetchEmBoardListPage = async (
  deps: MainlineDeps,
  page: number,
): Promise<{ rows: BoardSnapshot[]; total: number | null }> => {
  const query = EM_BOARD_LIST_QUERY.replace(EM_BOARD_LIST_PAGE_TOKEN, String(page));
  const url = `${EM_BOARD_LIST_URL}?${query}`;
  let lastError = '未知错误';
  for (let attempt = 0; attempt < EM_FETCH_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await deps.format.delay(EM_SCAN_DELAY_MS);
    try {
      const response = await deps.http.fetch(url, { headers: { Referer: EM_REFERER } });
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        continue;
      }
      return parseEmBoardListPageJson(await response.text());
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`东财板块清单第 ${page} 页不可用（${lastError}）`);
};

/**
 * 拉取东财板块清单全表（分页 + 串行间隔 + 完整性校验）
 *
 * 两道防线，都是为了「不静默少收」—— 清单不完整会让「未映射」名单凭空变长，
 * 把「其实有对应板块」误报成「东财没有同义板块」，直接影响整表降级的可信度：
 * 1. 排序用稳定字段（`EM_BOARD_LIST_SORT_FIELD`），行不会在页边界搬家；
 * 2. 收完与上游自报的 `total` 对账，短了就把整轮重跑一次（`EM_UNIVERSE_ROUNDS`），
 *    仍短则**抛错**，让上层如实报「兜底失败」而不是报「东财无同义板块」。
 * @param deps 宿主能力集合（http / format / market / ui）
 * @returns 全部板块快照（按代码去重）
 */
export const fetchEmBoardUniverse = async (deps: MainlineDeps): Promise<BoardSnapshot[]> => {
  let lastShort = '';
  for (let round = 0; round < EM_UNIVERSE_ROUNDS; round += 1) {
    if (round > 0) await deps.format.delay(EM_SCAN_RETRY_DELAY_MS);
    const merged = new Map<string, BoardSnapshot>();
    let total: number | null = null;
    for (let page = 1; page <= EM_BOARD_LIST_MAX_PAGES; page += 1) {
      // 频率红线：东财突发限速，同上游连续请求之间留间隔
      if (page > 1) await deps.format.delay(EM_SCAN_DELAY_MS);
      const pageData = await fetchEmBoardListPage(deps, page);
      if (pageData.total !== null) total = pageData.total;
      if (pageData.rows.length === 0) break;
      for (const row of pageData.rows) {
        if (merged.has(row.code)) continue;
        merged.set(row.code, row);
      }
    }
    const rows = [...merged.values()];
    if (total === null || rows.length >= total) return rows;
    lastShort = `上游自报 ${total} 个板块，实收 ${rows.length} 个`;
  }
  throw new Error(`东财板块清单不完整（${lastShort}）`);
};

/**
 * 拉取单个东财板块的日 K（连接被掐断时原地重试 `EM_FETCH_ATTEMPTS` 次）
 * @param deps 宿主能力集合（http / format / market / ui）
 * @param emCode 东财板块代码（BKxxxx）
 * @param year 当前年份（起始日期从 `year - EM_KLINE_YEARS_BACK` 年初算）
 * @returns 逐日行情（升序）；全部尝试都失败时抛错
 */
export const fetchEmBoardKline = async (
  deps: MainlineDeps,
  emCode: string,
  year: number,
): Promise<BoardDaily[]> => {
  const beg = `${year - EM_KLINE_YEARS_BACK}0101`;
  const url =
    `${EM_BOARD_KLINE_URL}?secid=${EM_BOARD_SECID_PREFIX}${emCode}` +
    `&fields1=${EM_KLINE_META_FIELDS}&fields2=${EM_KLINE_FIELDS}` +
    `&klt=${EM_KLINE_KLT}&fqt=${EM_KLINE_ADJUST}&beg=${beg}&end=${EM_KLINE_END}`;
  let lastError = '未知错误';
  for (let attempt = 0; attempt < EM_FETCH_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await deps.format.delay(EM_SCAN_DELAY_MS);
    try {
      const response = await deps.http.fetch(url, { headers: { Referer: EM_REFERER } });
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        continue;
      }
      const days = parseEmKlineJson(await response.text());
      if (days.length > 0) return days;
      lastError = '空数据';
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`东财板块日K不可用：${emCode}（${lastError}）`);
};
