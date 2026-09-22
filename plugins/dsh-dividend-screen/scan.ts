/**
 * 插件 dsh-dividend-screen（股息筛选）· 扫描编排
 *
 * 一次扫描 = 股息率排行前 N（push2delay clist）→ 三个报告期业绩（datacenter 业绩报表，
 * `in` 代码分块）→ 多期分红合并查询（5 个年度 × 4 个季度报告期，一个 `in` 过滤一次查完；
 * 年报期数连续分红年数，中期 / 季度期供「去年分红合计」与 TTM 除息日归集）
 * → 两个报告期的负债率摘要 → 推算合成（含连续分红年数 / 现金流覆盖等规则指标）→ 全量落库。
 *
 * 报告期随当前年份自适应：今年中报 = `${今年}-06-30`，去年中报 / 去年年报同理；
 * 中报披露季（8~9 月）部分股票尚未披露 → 状态记「中报未披露」，行保留、不静默丢。
 *
 * 频率纪律：全部串行 + 同上游间隔，总请求量 ≈ 排行页数 + 5 × 代码分块数
 * （业绩 3 + 分红 1 + 负债 1；样本池 200 时约 12 次）；只由用户点击触发，不轮询。
 */
import { chunkCodes, fetchDebtRatioByCodes, fetchDividendRank, fetchDividendsByCodes, fetchPerfByCodes, fetchRankRowByCode } from './em-data';
import { buildScreenRow, mergeFiscalYearDividends, sortScreenRows } from './project';
import { DIVIDEND_HISTORY_YEARS, DIVIDEND_PROJECT_STATUS } from './constants';
import type { DividendRepo } from './storage';
import type { DividendDeps, DividendScanMeta, DividendScanProgress, DividendScreenRow } from './types';

/** 扫描结果 */
export interface DividendScanResult {
  /** 落库后的展示行（默认序） */
  rows: DividendScreenRow[];
  /** 扫描元信息 */
  meta: DividendScanMeta;
}

/**
 * 生成参与推算的四个报告期（随当前年份自适应）
 * @returns 报告期集合
 */
export const resolveReportPeriods = (): DividendScanMeta['periods'] => {
  const year = new Date().getFullYear();
  return {
    h1: `${year}-06-30`,
    h1Last: `${year - 1}-06-30`,
    fyLast: `${year - 1}-12-31`,
    interim: `${year}-06-30`,
  };
};

/**
 * 生成连续分红年数的回看年度清单（锚年 = 去年年报，往前 `DIVIDEND_HISTORY_YEARS` 年）
 *
 * 每年取**全部四个季度报告期**：年报期给连续分红年数用；中期 / 季度期给「去年分红
 * 合计」（一年多次分红个股只取年报期会低估一半，招行 2026-09 实测）与 TTM
 * （按除权除息日归集，回看窗口可能落在中期 / 季度方案的除息日上）用。
 * 同一个 `in` 过滤一次查完，多日期零额外请求。
 * @param fyLast 去年年报报告期（如 `2025-12-31`）
 * @returns 报告期清单（含锚年各期；`in` 过滤不关心顺序）
 */
export const resolveDividendHistoryDates = (fyLast: string): string[] => {
  const anchorYear = Number(fyLast.slice(0, 4));
  const dates: string[] = [];
  for (let offset = 0; offset < DIVIDEND_HISTORY_YEARS; offset += 1) {
    const year = anchorYear - offset;
    dates.push(`${year}-12-31`, `${year}-09-30`, `${year}-06-30`, `${year}-03-31`);
  }
  return dates;
};

/**
 * 执行一次股息筛选扫描并落库
 * @param deps 宿主能力（取数与限速节拍经它注入；产物形态下没有 import 可用）
 * @param repo 快照仓储
 * @param universeLimit 样本池大小（按 TTM 股息率取前 N）
 * @param onProgress 进度回调（按请求数计）
 * @returns 扫描结果
 */
export const runDividendScan = async (
  deps: DividendDeps,
  repo: DividendRepo,
  universeLimit: number,
  onProgress?: (progress: DividendScanProgress) => void,
): Promise<DividendScanResult> => {
  const periods = resolveReportPeriods();

  // 1) 股息率排行前 N（先拿到样本池，后续所有请求都只为这批代码服务）
  let rankPages = 0;
  const rank = await fetchDividendRank(deps, universeLimit, () => {
    rankPages += 1;
  });
  const codes = rank.rows.map((row) => row.code);
  if (codes.length === 0) {
    throw new Error('排行接口未返回任何行（上游可能限速，稍后重试）');
  }

  // 进度总数按请求粒度计：已发生的排行页数 + 业绩 3 期 + 分红 1 次 + 负债 1 次的分块数
  const chunkCount = chunkCodes(codes).length;
  const totalRequests = rankPages + chunkCount * 5;
  let done = rankPages;
  /** 计一次完成并上报进度 */
  const tick = (): void => {
    done += 1;
    onProgress?.({ done, total: totalRequests });
  };
  onProgress?.({ done, total: totalRequests });

  // 2) 三个报告期业绩（今年中报 / 去年中报 / 去年年报；年报行含每股经营现金流）
  const perfH1 = await fetchPerfByCodes(deps, codes, periods.h1, tick);
  const perfH1Last = await fetchPerfByCodes(deps, codes, periods.h1Last, tick);
  const perfFyLast = await fetchPerfByCodes(deps, codes, periods.fyLast, tick);

  // 3) 多期分红一次查：5 个年度 × 4 季度期（连续分红年数 + 去年分红合计 + TTM 除息日）
  const divAll = await fetchDividendsByCodes(
    deps,
    codes,
    [...resolveDividendHistoryDates(periods.fyLast), periods.interim],
    tick,
  );

  // 4) 负债率：今年中报优先、去年年报兜底（覆盖中报披露进度差），逐代码取最新
  const debtAll = await fetchDebtRatioByCodes(deps, codes, [periods.h1, periods.fyLast], tick);

  // 5) 推算合成 + 默认排序（去年分红 = 去年财务年度内全部方案合计，见 mergeFiscalYearDividends）
  const rows = sortScreenRows(
    rank.rows.map((base) =>
      buildScreenRow({
        base,
        h1: perfH1.get(base.code),
        h1Last: perfH1Last.get(base.code),
        fyLast: perfFyLast.get(base.code),
        divLast: mergeFiscalYearDividends(divAll.get(base.code), periods.fyLast),
        divInterim: divAll.get(base.code)?.get(periods.interim),
        fyDividends: divAll.get(base.code),
        fyLastDate: periods.fyLast,
        debt: debtAll.get(base.code),
      }),
    ),
  );

  const meta: DividendScanMeta = {
    scannedAt: Date.now(),
    universeLimit,
    universeTotal: rank.total,
    rowCount: rows.length,
    publishedCount: rows.filter((row) => row.netProfitH1 !== null).length,
    projectableCount: rows.filter((row) => row.status === DIVIDEND_PROJECT_STATUS.OK).length,
    periods,
    warnings: [],
  };

  await repo.saveScan(rows, meta);
  return { rows, meta };
};

/**
 * 按需拉取单只股票的完整展示行（自选 tab 搜索预览用）
 *
 * 样本池外的个股不走全量扫描：单股精确行情（ulist.np，1 次）+ 三期业绩 + 多期分红
 * + 负债（datacenter 各 1 次，单股不分块）≈ 6 次串行请求，推算口径与扫描完全同源
 * （同一个 `buildScreenRow`）。只由用户点击搜索结果触发，不轮询、不落库
 * ——预览是临时数据，进自选并扫描后才有持久化快照。
 * @param deps 宿主能力
 * @param code 6 位裸代码
 * @returns 展示行；上游未返回该股行情（退市 / 非沪深）为 null
 */
export const fetchScreenRowByCode = async (
  deps: DividendDeps,
  code: string,
): Promise<DividendScreenRow | null> => {
  const periods = resolveReportPeriods();
  const base = await fetchRankRowByCode(deps, code);
  if (!base) return null;

  const perfH1 = await fetchPerfByCodes(deps, [code], periods.h1);
  const perfH1Last = await fetchPerfByCodes(deps, [code], periods.h1Last);
  const perfFyLast = await fetchPerfByCodes(deps, [code], periods.fyLast);
  const divAll = await fetchDividendsByCodes(
    deps,
    [code],
    [...resolveDividendHistoryDates(periods.fyLast), periods.interim],
  );
  const debt = await fetchDebtRatioByCodes(deps, [code], [periods.h1, periods.fyLast]);

  return buildScreenRow({
    base,
    h1: perfH1.get(code),
    h1Last: perfH1Last.get(code),
    fyLast: perfFyLast.get(code),
    divLast: mergeFiscalYearDividends(divAll.get(code), periods.fyLast),
    divInterim: divAll.get(code)?.get(periods.interim),
    fyDividends: divAll.get(code),
    fyLastDate: periods.fyLast,
    debt: debt.get(code),
  });
};
