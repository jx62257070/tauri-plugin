/**
 * 插件 dsh-mainline（股票主线）· 扫描编排
 *
 * 一次扫描 = 板块清单（清单页 / 本地缓存 / 内置兜底）+ 沪深成交额 + 每板块日 K
 * + 基准日涨停池 → 统一按**基准交易日**截面落库。
 *
 * 数据源策略（L2.5 简化版，见 `.ai/开发方案/2026-09-18-数据源兜底方案.md`）：
 * 1. 板块清单：清单页现取 → 本地缓存（上次成功扫描落库）→ 内置兜底清单。
 *    清单页（`q.10jqka.com.cn`）与日线主机（`d.10jqka.com.cn`）是两个域，可以单独故障，
 *    所以清单页挂掉**不等于**要换源：仍用缓存清单取同花顺日线，只是缺当日结构快照。
 * 2. 日线：一律先按**同花顺**取（单板块失败走同源回退链 last.js / 去年文件 + 本地旧数据）；
 * 3. 只有「清单解析出的**全部**板块日线都失败」才判定同花顺整体不可用 → **整表降级东财**
 *    （逐板块跨源混排是禁区：接缝处成交额口径会跳变，直接污染量能倍数与占比分位）。
 *    切换后两个来源的序列在库里分开存放，同花顺恢复后自动切回且历史不丢。
 *
 * 频率红线（AGENTS / SERVER_API 硬性要求）：
 * - 同花顺：同上游并发 ≤ `MAINLINE_SCAN_CONCURRENCY`（3），连续请求间隔 `MAINLINE_SCAN_DELAY_MS`；
 * - 东财：**必须串行**（`EM_SCAN_CONCURRENCY` = 1）且间隔 ≥ `EM_SCAN_DELAY_MS`（突发限速）；
 * - 两条路径都**只在用户点击时触发**，不进轮询。
 *
 * 增量策略：日 K 每次全量重取，与**同源**的本地历史按日期合并去重；
 * 结构字段（涨停/宽度/净流入）只可能落在基准日那一行，合并时以保留为默认
 * （日 K 不含这些字段，直接覆盖会把上次采到的结构数据抹掉）。
 */
import { resolveBenchmark, trimAfter } from './benchmark';
import { enrichBenchmarkDay, mergeDays, type BenchmarkStructure } from './board-merge';
import { fetchEmBoardKline, fetchEmBoardUniverse, matchThsToEm, shouldFallbackToEm } from './em-data';
import { aggregateLimitUp, fetchLimitUpPool } from './limit-up';
import { fetchThsBoardKline, fetchThsBoardPage } from './ths-data';
import {
  EM_SCAN_CONCURRENCY,
  EM_SCAN_DELAY_MS,
  EM_SCAN_RETRY_DELAY_MS,
  MAINLINE_FALLBACK_REASON,
  MAINLINE_REFS_SOURCE,
  MAINLINE_SCAN_CONCURRENCY,
  MAINLINE_SCAN_DELAY_MS,
  MAINLINE_SCAN_RETRY_DELAY_MS,
  MAINLINE_SOURCE,
  MAINLINE_THS_BOARD_FALLBACK,
} from './constants';
import type { MainlineRepo } from './storage';
import type { MainlineDeps } from './types';
import type { MainlineRefsSource, MainlineSource } from './constants';
import type {
  BoardDaily,
  BoardSeries,
  BoardSnapshot,
  LimitUpAggregate,
  MainlineScanMeta,
  MainlineSnapshot,
  MarketTurnoverPoint,
  ThsBoardRef,
} from './types';

/** 扫描进度回调载荷 */
export interface MainlineScanProgress {
  /** 已完成板块数 */
  done: number;
  /** 板块总数 */
  total: number;
}

/** 扫描结果 */
export interface MainlineScanResult {
  /** 落库后的主板序列 */
  boards: BoardSeries[];
  /** 沪深成交额序列 */
  market: MarketTurnoverPoint[];
  /** 扫描元信息 */
  meta: MainlineScanMeta;
  /** 取数失败的板块代码（保留其本地旧 history，界面照旧展示） */
  failures: readonly string[];
  /** 基准日覆盖率是否降级（未找到覆盖率达标的交易日） */
  degraded: boolean;
  /** 结构指标是否取数失败（未能归属/未能采集） */
  structureFailed: boolean;
  /** 未能归属到板块的涨停行业名（界面提示用） */
  unmappedIndustries: readonly string[];
  /** 本次实际使用的数据源 */
  source: MainlineSource;
  /** 板块清单来源 */
  refsSource: MainlineRefsSource;
  /** 兜底模式下未能映射到东财板块的同花顺板块名 */
  emUnmapped: readonly string[];
}

/** 空聚合（涨停池不可用时占位， 为 0 但不会被采用） */
const EMPTY_LIMIT_UP: LimitUpAggregate = {
  byCode: new Map(),
  unmappedCount: 0,
  unmappedIndustries: [],
  total: 0,
};

/** 板块清单解析结果（含清单来源与清单页报错） */
interface RefResolution {
  /** 本次要扫描的板块清单 */
  refs: ThsBoardRef[];
  /** 清单页当日结构快照（非「现取」时为空 —— 快照只有清单页能给） */
  rows: BoardSnapshot[];
  /** 清单来源 */
  refsSource: MainlineRefsSource;
  /** 清单页原始报错（空串 = 清单页正常） */
  listError: string;
}

/**
 * 取板块清单：清单页现取 → 本地缓存 → 内置兜底
 *
 * 三级都失败不可能发生（内置兜底是常量），故本函数不抛错 —— 清单是扫描的**前提**，
 * 拿不到清单就没有任何可扫对象，那才是真失败；「清单从哪来」只影响结构指标是否可得。
 * @param deps 宿主能力集合（http / format / market / ui）
 * @param snapshot 本地快照（提供上次成功扫描缓存的清单）
 * @returns 清单解析结果
 */
const resolveBoardRefs = async (
  deps: MainlineDeps,
  snapshot: MainlineSnapshot,
): Promise<RefResolution> => {
  try {
    const page = await fetchThsBoardPage(deps);
    return {
      refs: page.refs,
      rows: page.rows,
      refsSource: MAINLINE_REFS_SOURCE.LIVE,
      listError: '',
    };
  } catch (error) {
    const listError = error instanceof Error ? error.message : String(error);
    console.warn('[plugin] dsh-mainline 板块清单页取数失败，改用缓存/内置清单', error);
    if (snapshot.refs.length > 0) {
      return { refs: snapshot.refs, rows: [], refsSource: MAINLINE_REFS_SOURCE.CACHE, listError };
    }
    return {
      refs: [...MAINLINE_THS_BOARD_FALLBACK],
      rows: [],
      refsSource: MAINLINE_REFS_SOURCE.STATIC,
      listError,
    };
  }
};

/** 单轮取数参数（同花顺与东财只在「取哪个板块的日线」「间隔多少」上不同） */
interface BoardFetchOptions {
  /** 待取板块 */
  refs: readonly ThsBoardRef[];
  /** 同源的本地已有序列（增量合并基础） */
  existingByCode: ReadonlyMap<string, BoardSeries>;
  /** 数据源（写进序列，供界面与仓储区分） */
  source: MainlineSource;
  /** 取单个板块日线 */
  fetchDays: (ref: ThsBoardRef) => Promise<BoardDaily[]>;
  /** 同上游并发上限 */
  concurrency: number;
  /** 轮内连续请求间隔（毫秒） */
  delayMs: number;
  /** 失败补采轮之前的等待与轮内间隔（毫秒） */
  retryDelayMs: number;
  /** 进度回调（只按首轮计数，补采轮不推进进度条） */
  onProgress?: (progress: MainlineScanProgress) => void;
}

/** 取数结果 */
interface BoardFetchResult {
  /** 合并后的序列 */
  boards: BoardSeries[];
  /** 失败板块代码 */
  failures: string[];
  /** 最后一次失败的原始报错（用于判定「整体不可用」时给用户看的上游信息） */
  lastError: string;
}

/**
 * 并发拉取全部板块日线（带并发上限与同上游间隔）
 *
 * 两级容错：
 * - 单板块失败不中断整轮（代码记进 failures，上层保留其本地旧序列）；
 * - 整轮跑完对失败板块**补采一轮**（网关 502 呈突发簇分布，稍等即自愈）。
 * 但「**全部**板块都失败」时不做补采：这是上游整体不可用的信号，补采只是再等一轮，
 * 上层会据此决定是否整表降级东财。
 * @param deps 宿主能力集合（http / format / market / ui）
 * @param options 取数参数
 * @returns 合并后的序列、失败清单与最后一条报错
 */
const fetchAllBoardSeries = async (
  deps: MainlineDeps,
  options: BoardFetchOptions,
): Promise<BoardFetchResult> => {
  const { refs, existingByCode, source, fetchDays, concurrency, delayMs, retryDelayMs } = options;
  const onProgress = options.onProgress;
  const results = new Map<string, BoardSeries>();
  const failed = new Set<string>();
  let lastError = '';
  let done = 0;

  const runPass = async (
    passRefs: readonly ThsBoardRef[],
    passDelayMs: number,
    reportProgress: boolean,
  ): Promise<void> => {
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < passRefs.length) {
        const ref = passRefs[cursor];
        cursor += 1;
        try {
          const incoming = await fetchDays(ref);
          const existing = existingByCode.get(ref.code)?.days ?? [];
          results.set(ref.code, {
            code: ref.code,
            name: ref.name,
            source,
            days: mergeDays(existing, incoming),
          });
          failed.delete(ref.code);
        } catch (error) {
          // 单个板块失败不中断整轮：代码记进 failed，两轮都失败才由界面提示
          failed.add(ref.code);
          lastError = error instanceof Error ? error.message : String(error);
          console.warn(`[plugin] dsh-mainline 板块取数失败（${source}）：${ref.code}`, error);
        }
        done += 1;
        if (reportProgress) onProgress?.({ done, total: refs.length });
        await deps.format.delay(passDelayMs);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(concurrency, passRefs.length) }, () => worker()),
    );
  };

  await runPass(refs, delayMs, true);
  if (failed.size > 0 && failed.size < refs.length) {
    const retryRefs = refs.filter((ref) => failed.has(ref.code));
    await deps.format.delay(retryDelayMs);
    await runPass(retryRefs, retryDelayMs, false);
  }

  const boards = [...results.values()];
  // 补采仍失败的板块兜底本地旧序列（界面照旧展示，只是数据变旧）
  for (const code of failed) {
    const existing = existingByCode.get(code);
    if (existing) boards.push(existing);
  }
  return { boards, failures: [...failed], lastError };
};

/** 东财整表兜底的取数结果 */
interface EmScanResult extends BoardFetchResult {
  /** 同花顺板块代码 → 命中的东财板块快照（结构富化用） */
  snapshots: Map<string, BoardSnapshot>;
  /** 未能映射的同花顺板块名（界面如实列出） */
  unmapped: string[];
}

/**
 * 东财整表兜底（L2.5 核心）
 *
 * 流程：东财板块清单全表 → 名称映射（同花顺 90 → 东财代码）→ 按映射逐板块取日线。
 * 映射不上的板块**保留为空序列**（不猜、但也别凭空消失），界面按「东财无同义板块」提示。
 * @param deps 宿主能力集合（http / format / market / ui）
 * @param refs 同花顺板块清单
 * @param year 当前年份
 * @param existingByCode 东财来源的本地已有序列
 * @param onProgress 进度回调
 * @returns 取数结果（清单取数失败会抛错，由上层如实报「兜底也失败」）
 */
const runEmScan = async (
  deps: MainlineDeps,
  refs: readonly ThsBoardRef[],
  year: number,
  existingByCode: ReadonlyMap<string, BoardSeries>,
  onProgress?: (progress: MainlineScanProgress) => void,
): Promise<EmScanResult> => {
  const emBoards = await fetchEmBoardUniverse(deps);
  const { mapped, unmapped } = matchThsToEm(refs, emBoards);

  const snapshots = new Map<string, BoardSnapshot>();
  for (const [code, board] of mapped) snapshots.set(code, board);

  const mappedRefs = refs.filter((ref) => mapped.has(ref.code));
  const result = await fetchAllBoardSeries(deps, {
    refs: mappedRefs,
    existingByCode,
    source: MAINLINE_SOURCE.EM,
    fetchDays: (ref) => {
      const emCode = mapped.get(ref.code)?.code ?? '';
      return fetchEmBoardKline(deps, emCode, year);
    },
    concurrency: EM_SCAN_CONCURRENCY,
    delayMs: EM_SCAN_DELAY_MS,
    retryDelayMs: EM_SCAN_RETRY_DELAY_MS,
    onProgress,
  });

  // 未映射的板块保留空序列：板块清单不变（用户不会觉得板块「消失」），
  // 判定层会给出「数据不足」，界面按「东财无同义板块」解释
  const boards = [...result.boards];
  for (const ref of refs) {
    if (mapped.has(ref.code)) continue;
    boards.push({ code: ref.code, name: ref.name, source: MAINLINE_SOURCE.EM, days: [] });
  }

  return { ...result, boards, snapshots, unmapped };
};

/**
 * 执行一次主线扫描并落库
 * @param repo 快照仓储
 * @param snapshot 当前本地快照（提供板块清单缓存与分来源的历史序列）
 * @param deps 宿主能力集合（http / format / market / ui）
 * @param onProgress 进度回调
 * @returns 扫描结果
 */
export const runMainlineScan = async (
  repo: MainlineRepo,
  snapshot: MainlineSnapshot,
  deps: MainlineDeps,
  onProgress?: (progress: MainlineScanProgress) => void,
): Promise<MainlineScanResult> => {
  const year = new Date().getFullYear();

  // 1) 板块清单三级解析（清单页 → 本地缓存 → 内置兜底）
  const { refs, rows, refsSource, listError } = await resolveBoardRefs(deps, snapshot);

  // 2) 沪深两市成交额（成交占比的分母；与板块源无关，先取到）
  const market: MarketTurnoverPoint[] = (await deps.market.fetchMarketTurnover()).map((item) => ({
    date: item.date,
    totalAmount: item.totalAmount,
  }));

  // 3) 主源：同花顺（即使清单来自缓存也先试同花顺日线 —— 清单页与日线主机是两个域）
  const thsExisting = new Map(
    repo.seriesFor(MAINLINE_SOURCE.THS).map((series) => [series.code, series]),
  );
  const ths = await fetchAllBoardSeries(deps, {
    refs,
    existingByCode: thsExisting,
    source: MAINLINE_SOURCE.THS,
    fetchDays: (ref) => fetchThsBoardKline(deps, ref.code, year),
    concurrency: MAINLINE_SCAN_CONCURRENCY,
    delayMs: MAINLINE_SCAN_DELAY_MS,
    retryDelayMs: MAINLINE_SCAN_RETRY_DELAY_MS,
    onProgress,
  });

  // 4) 全部板块日线都失败 → 判定同花顺整体不可用 → 整表降级东财（L2.5）
  const thsAllFailed = shouldFallbackToEm(refs.length, ths.failures);
  let boards = ths.boards;
  let failures: readonly string[] = ths.failures;
  let snapshots: ReadonlyMap<string, BoardSnapshot> = new Map(rows.map((row) => [row.code, row]));
  let source: MainlineSource = MAINLINE_SOURCE.THS;
  let effectiveRefsSource: MainlineRefsSource = refsSource;
  let fallbackReason = '';
  let fallbackError = '';
  let emUnmapped: string[] = [];

  if (thsAllFailed) {
    const emExisting = new Map(
      repo.seriesFor(MAINLINE_SOURCE.EM).map((series) => [series.code, series]),
    );
    try {
      const em = await runEmScan(deps, refs, year, emExisting, onProgress);
      boards = em.boards;
      failures = em.failures;
      snapshots = em.snapshots;
      emUnmapped = em.unmapped;
      source = MAINLINE_SOURCE.EM;
      effectiveRefsSource = MAINLINE_REFS_SOURCE.EM;
      fallbackReason = MAINLINE_FALLBACK_REASON.KLINE_ALL_FAILED;
      fallbackError = ths.lastError;
    } catch (error) {
      const emError = error instanceof Error ? error.message : String(error);
      // 兜底也失败：抛错让界面如实报出，本次不写库（保留上一次的本地快照）
      throw new Error(
        `同花顺整体不可用（${ths.lastError}）；东财兜底取数失败（${emError}）`,
        { cause: error },
      );
    }
  }

  // 5) 基准日：全板块统一口径日；未落定日的半日 bar 一律裁掉（不写进历史）
  const benchmark = resolveBenchmark(boards, market, new Date());
  const benchmarkDate = benchmark.date;
  const trimmed = trimAfter(boards, benchmarkDate);

  // 6) 涨停池取「基准日」的池子（东财涨停池与板块源无关，两种模式下都用它）
  let limitUp = EMPTY_LIMIT_UP;
  let limitUpOk = false;
  if (benchmarkDate.length > 0) {
    try {
      const pool = await fetchLimitUpPool(deps, benchmarkDate);
      // 空池一律视为取数失败：正常交易日不可能全市场零涨停，
      // 若当作「0 家」会把所有板块的涨停字段静默写成 0（宁可留空并提示）
      if (pool.length > 0) {
        limitUp = aggregateLimitUp(pool, refs);
        limitUpOk = true;
      }
    } catch (error) {
      console.warn('[plugin] dsh-mainline 涨停池取数失败', error);
    }
  }

  // 7) 结构富化：清单快照是「当前」截面，只有基准日 = 最新交易日且当日未被排除时才同源
  const latestMarketDate = market[market.length - 1]?.date ?? '';
  const snapshotMatches =
    benchmarkDate.length > 0 && benchmark.excludedDate === '' && benchmarkDate === latestMarketDate;
  const structure: BenchmarkStructure = {
    snapshots: snapshotMatches ? snapshots : new Map<string, BoardSnapshot>(),
    limitUp: limitUpOk ? limitUp.byCode : null,
  };
  const enriched = trimmed.map((series) => enrichBenchmarkDay(series, benchmarkDate, structure));

  const benchmarkMarket = market.find((point) => point.date === benchmarkDate) ?? null;
  const meta: MainlineScanMeta = {
    scannedAt: Date.now(),
    asOf: benchmarkDate,
    boardCount: enriched.length,
    coverage: benchmark.coverage,
    degraded: benchmark.degraded,
    excludedDate: benchmark.excludedDate,
    marketAmount: benchmarkMarket ? benchmarkMarket.totalAmount : null,
    limitUpTotal: limitUpOk ? limitUp.total : null,
    limitUpUnmapped: limitUpOk ? limitUp.unmappedCount : null,
    structureReady: snapshotMatches || limitUpOk,
    source,
    refsSource: effectiveRefsSource,
    listError,
    fallbackReason,
    fallbackError,
    emUnmapped,
  };

  await repo.saveScan(enriched, market, meta);
  return {
    boards: enriched,
    market,
    meta,
    failures,
    degraded: benchmark.degraded,
    structureFailed: !snapshotMatches || !limitUpOk,
    unmappedIndustries: limitUp.unmappedIndustries,
    source,
    refsSource: effectiveRefsSource,
    emUnmapped,
  };
};
