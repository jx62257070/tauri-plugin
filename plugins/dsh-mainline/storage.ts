/**
 * 插件 dsh-mainline（股票主线）· 本地快照仓储
 *
 * 两张表（插件独立表，落 `plugin_dsh_mainline_*`；Tauri 端 SQLite / 浏览器端 appStorage 仿真）：
 * - `board_history`：每板块**每数据源**一行，日线序列整体存 `json` 列 ——
 *   一次扫描最多写 90 行（避免「一年 × 90 板块」上万行的逐条插入），
 *   读出来即可本地重算分位与阶段，不联网；
 * - `scan_meta`：键值行，存扫描元信息、沪深成交额序列、**同花顺板块清单缓存**。
 *
 * ⚠️ 两个数据源（同花顺 / 东财）的序列**分开存放、永不拼接**：
 * 行唯一键是 `来源:板块代码`，水合与 upsert 都必须用同形键 ——
 * 否则要么误把另一来源的行当重复行删掉，要么重启后首扫整批重复插入。
 *
 * 与技能的 `snapshot` 设计同源：**分位序列靠自己累积**，样本不足时判定层如实降置信度。
 */
import { ref } from 'vue';
import { MAINLINE_MAX_HISTORY_DAYS, MAINLINE_SOURCE } from './constants';
import type { MainlineSource } from './constants';
import type { PluginDatabase, PluginDbColumn, PluginDbRow } from '../../host/types/plugin.types';
import type {
  BoardSeries,
  MainlineScanMeta,
  MainlineSnapshot,
  MarketTurnoverPoint,
  ThsBoardRef,
} from './types';

/** 板块历史表名（物理表 `plugin_dsh_mainline_board_history`） */
export const MAINLINE_BOARD_TABLE = 'board_history';

/** 扫描元信息表名（物理表 `plugin_dsh_mainline_scan_meta`） */
export const MAINLINE_META_TABLE = 'scan_meta';

/** 扫描元信息在表里的键 */
export const MAINLINE_META_KEY = 'last_scan';

/** 沪深成交额序列在表里的键 */
const MAINLINE_MARKET_KEY = 'market_turnover';

/** 同花顺板块清单缓存在表里的键（清单页故障时用它继续取同花顺日线） */
const MAINLINE_REFS_KEY = 'board_refs';

/**
 * 板块历史表的列声明
 *
 * ⚠️ 只声明**业务列**：`id` / `created_at` / `updated_at` 由宿主自动维护并固定写进建表语句，
 * 插件重复声明会让建表语句出现两个同名列（SQLite 报 `duplicate column name`）——
 * 宿主已在 `toColumnMap` 里拒绝保留列，冒烟也用真 SQLite 执行过一次建表。
 */
export const MAINLINE_BOARD_COLUMNS: readonly PluginDbColumn[] = [
  { name: 'board_code', type: 'text', indexed: true },
  { name: 'board_name', type: 'text' },
  { name: 'source', type: 'text', indexed: true },
  { name: 'days', type: 'json' },
];

/** 扫描元信息表的列声明（键值行，同样只声明业务列） */
export const MAINLINE_META_COLUMNS: readonly PluginDbColumn[] = [
  { name: 'meta_key', type: 'text', indexed: true },
  { name: 'meta_value', type: 'json' },
];

/** 板块历史表的一行 */
interface BoardHistoryRow extends Record<string, unknown> {
  /** 板块代码（88xxxx + 来源，唯一） */
  board_code: string;
  /** 板块名称 */
  board_name: string;
  /** 数据源（早于来源标记写入的历史行为空 → 视为同花顺） */
  source?: string;
  /** 逐日行情（json 列，升序） */
  days: unknown;
}

/** 元信息表的一行 */
interface MetaRow extends Record<string, unknown> {
  /** 键（唯一） */
  meta_key: string;
  /** 值（json 列，承载元信息对象 / 成交额序列 / 板块清单） */
  meta_value: unknown;
}

/**
 * 行内数据源（早于来源标记的历史行按同花顺处理）
 * @param value 库里的来源字段
 * @returns 数据源
 */
const toSource = (value: unknown): MainlineSource =>
  value === MAINLINE_SOURCE.EM ? MAINLINE_SOURCE.EM : MAINLINE_SOURCE.THS;

/**
 * 把库里读出的 json 值还原成日线序列（脏数据一律过滤成空序列）
 * @param value json 列值
 * @returns 日线序列（升序）
 */
const parseDays = (value: unknown): BoardSeries['days'] => {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is BoardSeries['days'][number] =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as { date?: unknown }).date === 'string' &&
      Number.isFinite((item as { close?: unknown }).close),
  );
};

/**
 * 把库里读出的 json 值还原成板块清单（脏数据一律过滤）
 * @param value json 列值
 * @returns 板块清单
 */
const parseRefs = (value: unknown): ThsBoardRef[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is ThsBoardRef =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as { code?: unknown }).code === 'string' &&
      typeof (item as { name?: unknown }).name === 'string',
  );
};

/** 主线快照仓储 */
export interface MainlineRepo {
  /**
   * 读当前快照（响应式；扫描落库后自动更新）
   *
   * `boards` 是**当前数据源**的序列 —— 同花顺与东财各存一套，界面永远只看一套，不混排。
   * @returns 快照
   */
  snapshot: () => MainlineSnapshot;
  /**
   * 取指定数据源的板块序列（扫描时要按来源分别做增量合并）
   * @param source 数据源
   * @returns 该来源的板块序列
   */
  seriesFor: (source: MainlineSource) => BoardSeries[];
  /**
   * 落库一次扫描结果（按「来源 + 板块」upsert；只保留最近 `MAINLINE_MAX_HISTORY_DAYS` 个交易日）
   * @param boards 各板块日线序列
   * @param market 沪深成交额序列
   * @param meta 扫描元信息
   */
  saveScan: (
    boards: BoardSeries[],
    market: MarketTurnoverPoint[],
    meta: MainlineScanMeta,
  ) => Promise<void>;
}

/**
 * 建表并水合快照
 * @param db 插件通用数据库（`ctx.db`）
 * @returns 主题快照仓储
 */
export const createMainlineRepo = async (db: PluginDatabase): Promise<MainlineRepo> => {
  await db.ensureTable(MAINLINE_BOARD_TABLE, MAINLINE_BOARD_COLUMNS);
  await db.ensureTable(MAINLINE_META_TABLE, MAINLINE_META_COLUMNS);

  // 分来源存放：同花顺与东财各一套序列，绝不拼接（跨源拼接会让成交额口径在接缝处跳变）
  const boards = ref<Record<MainlineSource, BoardSeries[]>>({
    [MAINLINE_SOURCE.THS]: [],
    [MAINLINE_SOURCE.EM]: [],
  });
  const market = ref<MarketTurnoverPoint[]>([]);
  const meta = ref<MainlineScanMeta | null>(null);
  const refs = ref<ThsBoardRef[]>([]);

  /** `来源:板块代码` → 数据表行主键（upsert 定位） */
  const rowIds = new Map<string, number>();

  // 水合：历史行按板块代码排序，保证界面首屏顺序稳定
  const boardRows = await db.select<BoardHistoryRow>(MAINLINE_BOARD_TABLE, {
    orderBy: { column: 'board_code' },
  });

  // 早前主键登记 bug 会让同一板块重复插入多行（见下方注释）—— 水合时按 updated_at 去重，
  // 保留最新一行并删掉冗余行：重复行会让看板出现同板块多行，且两行数据各自分叉。
  // ⚠️ 去重键必须带**数据源**：同一板块在两个来源下本来就是两条合法的行。
  const newestByKey = new Map<string, PluginDbRow<BoardHistoryRow>>();
  const redundantIds: number[] = [];
  for (const row of boardRows) {
    if (!row.board_code) continue;
    const key = `${toSource(row.source)}:${row.board_code}`;
    const current = newestByKey.get(key);
    if (!current) {
      newestByKey.set(key, row);
      continue;
    }
    const keep = row.updatedAt >= current.updatedAt ? row : current;
    redundantIds.push(keep === row ? current.id : row.id);
    newestByKey.set(key, keep);
  }
  for (const id of redundantIds) {
    await db.remove(MAINLINE_BOARD_TABLE, id);
  }

  for (const row of newestByKey.values()) {
    const source = toSource(row.source);
    // ⚠️ 主键登记必须与 upsert 的查找键同形（`${table}:${source}:${code}`）：
    // 早前这里记的是裸板块代码，导致重启后首次扫描查不到已有行、把 90 个板块
    // 整批重复插入（表行数翻倍，水合出的快照也出现重复板块）。
    rowIds.set(`${MAINLINE_BOARD_TABLE}:${source}:${row.board_code}`, row.id);
    boards.value[source].push({
      code: row.board_code,
      name: row.board_name || row.board_code,
      source,
      days: parseDays(row.days),
    });
  }

  const metaRows = await db.select<MetaRow>(MAINLINE_META_TABLE, {
    orderBy: { column: 'meta_key' },
  });
  const newestMetaByKey = new Map<string, PluginDbRow<MetaRow>>();
  const redundantMetaIds: number[] = [];
  for (const row of metaRows) {
    if (!row.meta_key) continue;
    const current = newestMetaByKey.get(row.meta_key);
    if (!current) {
      newestMetaByKey.set(row.meta_key, row);
      continue;
    }
    const keep = row.updatedAt >= current.updatedAt ? row : current;
    redundantMetaIds.push(keep === row ? current.id : row.id);
    newestMetaByKey.set(row.meta_key, keep);
  }
  for (const id of redundantMetaIds) {
    await db.remove(MAINLINE_META_TABLE, id);
  }

  for (const row of newestMetaByKey.values()) {
    // 同样登记主键：不登记的话每次重启后首扫会再插一份元信息行（读时靠后写覆盖，属垃圾行）
    rowIds.set(`${MAINLINE_META_TABLE}:${row.meta_key}`, row.id);
    if (row.meta_key === MAINLINE_META_KEY && row.meta_value && typeof row.meta_value === 'object') {
      meta.value = row.meta_value as MainlineScanMeta;
    }
    if (row.meta_key === MAINLINE_MARKET_KEY && Array.isArray(row.meta_value)) {
      market.value = row.meta_value as MarketTurnoverPoint[];
    }
    if (row.meta_key === MAINLINE_REFS_KEY) {
      refs.value = parseRefs(row.meta_value);
    }
  }

  /**
   * 写一行（存在则更新，不存在则插入并登记主键）
   * @param table 表名
   * @param key 业务键
   * @param columns 列值
   */
  const upsert = async (
    table: string,
    key: string,
    columns: Record<string, unknown>,
  ): Promise<void> => {
    const lookupKey = `${table}:${key}`;
    const id = rowIds.get(lookupKey);
    if (id === undefined) {
      rowIds.set(lookupKey, await db.insert(table, columns));
      return;
    }
    await db.update(table, id, columns);
  };

  /**
   * 写元信息表的某个键（存在则更新 meta_value，不存在则插入）
   * @param key 元信息键
   * @param value 元信息值（json 列）
   */
  const upsertMeta = async (key: string, value: unknown): Promise<void> => {
    await upsert(MAINLINE_META_TABLE, key, { meta_key: key, meta_value: value });
  };

  return {
    snapshot: (): MainlineSnapshot => {
      const source = toSource(meta.value?.source);
      return {
        boards: boards.value[source],
        market: market.value,
        meta: meta.value,
        refs: refs.value,
        source,
      };
    },

    seriesFor: (source: MainlineSource): BoardSeries[] => boards.value[source],

    saveScan: async (
      nextBoards: BoardSeries[],
      nextMarket: MarketTurnoverPoint[],
      nextMeta: MainlineScanMeta,
    ): Promise<void> => {
      const source = toSource(nextMeta.source);
      // 时间列（created_at / updated_at）由宿主自动维护，插件不传
      for (const series of nextBoards) {
        const days = series.days.slice(-MAINLINE_MAX_HISTORY_DAYS);
        await upsert(MAINLINE_BOARD_TABLE, `${source}:${series.code}`, {
          board_code: series.code,
          board_name: series.name,
          source,
          days,
        });
      }
      await upsertMeta(MAINLINE_MARKET_KEY, nextMarket);
      await upsertMeta(MAINLINE_META_KEY, nextMeta);

      // 板块清单缓存：**只有同花顺扫描的清单能当缓存** ——
      // 东财模式下的清单是「映射命中的子集」，拿它当缓存会让下次清单页故障时少扫一批板块。
      if (source === MAINLINE_SOURCE.THS && nextBoards.length > 0) {
        const nextRefs: ThsBoardRef[] = nextBoards.map((series) => ({
          code: series.code,
          name: series.name,
        }));
        refs.value = nextRefs;
        await upsertMeta(MAINLINE_REFS_KEY, nextRefs);
      }

      // 内存快照同步换新引用（界面与判定层都是 computed，靠引用变化驱动）
      boards.value = {
        ...boards.value,
        [source]: nextBoards.map((series) => ({
          ...series,
          source,
          days: series.days.slice(-MAINLINE_MAX_HISTORY_DAYS),
        })),
      };
      market.value = nextMarket;
      meta.value = nextMeta;
    },
  };
};

declare module '../../host/types/plugin.types' {
  /** 本插件对外贡献的服务 */
  interface AppServiceMap {
    /** 主线快照仓储（读快照重算判定，不联网；由 dsh-mainline 提供） */
    'mainline:repo': MainlineRepo;
  }
}
