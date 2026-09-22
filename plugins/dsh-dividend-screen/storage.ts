/**
 * 插件 dsh-dividend-screen（股息筛选）· 本地快照仓储
 *
 * 四张表（插件独立表，物理名 `plugin_dsh_dividend_screen_*`；Tauri 端 SQLite /
 * 浏览器端 JSON 表仿真）：
 * - `screen_rows`：一次扫描一只股票一行，**全部展示指标已在扫描时算好**——
 *   读库即可渲染整页，重进页面零联网（用户明确要求：持久化缓存，避免重复查询触发上游限速）；
 * - `scan_meta`：键值行，存扫描元信息（报告期 / 覆盖 / 告警）；
 * - `config`：键值行，存用户自定义规则配置（`rules.ts` 清洗后回填，坏配置自动修复）；
 * - `watchlist`：股息自选（代码 + 加入时的名称），整表全量替换（条目少，写放大可忽略）。
 *
 * 快照语义：`saveScan` 全量替换（clear + insert，行数 ≤ 样本池上限 500，
 * 远低于逐行 upsert 的写放大）；旧快照只有「被新扫描覆盖」一种失效方式。
 *
 * ⚠️ 列声明只写业务列：`id` / `created_at` / `updated_at` 由宿主自动维护，
 * 插件重复声明会让建表语句出现同名列（SQLite 报 duplicate column name）。
 */
import { ref } from 'vue';
import { DIVIDEND_CONFIG_KEY, DIVIDEND_PROJECT_STATUS } from './constants';
import { createDefaultRules, sanitizeRuleConfigs } from './rules';
import type { ProjectStatus } from './constants';
import type { RuleConfig } from './types';
import type { PluginDatabase, PluginDbColumn, PluginDbRow } from '../../host/types/plugin.types';
import type { DividendScanMeta, DividendScreenRow } from './types';

/** 展示行表名（物理表 `plugin_dsh_dividend_screen_screen_rows`） */
export const DIVIDEND_ROWS_TABLE = 'screen_rows';

/** 扫描元信息表名（物理表 `plugin_dsh_dividend_screen_scan_meta`） */
export const DIVIDEND_META_TABLE = 'scan_meta';

/** 规则配置表名（物理表 `plugin_dsh_dividend_screen_config`） */
export const DIVIDEND_CONFIG_TABLE = 'config';

/** 股息自选表名（物理表 `plugin_dsh_dividend_screen_watchlist`） */
export const DIVIDEND_WATCH_TABLE = 'watchlist';

/** 扫描元信息在表里的键 */
export const DIVIDEND_META_KEY = 'last_scan';

/** 展示行表的列声明（snake_case；数值列 real，文本列 text，代码列建索引） */
export const DIVIDEND_ROWS_COLUMNS: readonly PluginDbColumn[] = [
  { name: 'code', type: 'text', indexed: true },
  { name: 'name', type: 'text' },
  { name: 'industry', type: 'text' },
  { name: 'price', type: 'real' },
  { name: 'change_percent', type: 'real' },
  { name: 'market_cap', type: 'real' },
  { name: 'pb', type: 'real' },
  { name: 'pe_ttm', type: 'real' },
  { name: 'total_shares', type: 'real' },
  { name: 'ttm_yield', type: 'real' },
  { name: 'dps_last', type: 'real' },
  { name: 'dividend_total_last', type: 'real' },
  { name: 'np_fy_last', type: 'real' },
  { name: 'payout_last', type: 'real' },
  { name: 'np_h1', type: 'real' },
  { name: 'np_h1_last', type: 'real' },
  { name: 'np_yoy', type: 'real' },
  { name: 'rev_yoy', type: 'real' },
  { name: 'growth_h1', type: 'real' },
  { name: 'np_proj', type: 'real' },
  { name: 'dps_proj', type: 'real' },
  { name: 'yield_proj', type: 'real' },
  { name: 'yield_last', type: 'real' },
  { name: 'interim_dps', type: 'real' },
  { name: 'dividend_years', type: 'real' },
  { name: 'ocf_per_share_last', type: 'real' },
  { name: 'cash_cover_last', type: 'real' },
  { name: 'debt_ratio', type: 'real' },
  { name: 'status', type: 'text' },
];

/** 元信息表的列声明（键值行） */
export const DIVIDEND_META_COLUMNS: readonly PluginDbColumn[] = [
  { name: 'meta_key', type: 'text', indexed: true },
  { name: 'meta_value', type: 'json' },
];

/** 规则配置表的列声明（键值行；value 存 `RuleConfig[]` 的 JSON） */
export const DIVIDEND_CONFIG_COLUMNS: readonly PluginDbColumn[] = [
  { name: 'config_key', type: 'text', indexed: true },
  { name: 'config_value', type: 'json' },
];

/** 股息自选表的列声明（code 建索引；name 存加入时的名称，快照缺席时兜底展示） */
export const DIVIDEND_WATCH_COLUMNS: readonly PluginDbColumn[] = [
  { name: 'code', type: 'text', indexed: true },
  { name: 'name', type: 'text' },
];

/** 规则配置表的一行 */
interface ConfigRow extends Record<string, unknown> {
  /** 键 */
  config_key: string;
  /** 值（json 列） */
  config_value: unknown;
}

/** 元信息表的一行 */
interface MetaRow extends Record<string, unknown> {
  /** 键 */
  meta_key: string;
  /** 值（json 列） */
  meta_value: unknown;
}

/** 股息自选条目 */
export interface DividendWatchItem {
  /** 6 位裸代码 */
  code: string;
  /** 加入时的股票名称（最新快照缺席时的兜底展示） */
  name: string;
}

/** 股息筛选快照 */
export interface DividendSnapshot {
  /** 展示行（扫描时的默认序） */
  rows: DividendScreenRow[];
  /** 扫描元信息（未扫描过为 null） */
  meta: DividendScanMeta | null;
}

/** 股息筛选仓储 */
export interface DividendRepo {
  /**
   * 读当前快照（响应式；扫描落库后自动更新）
   * @returns 快照
   */
  snapshot: () => DividendSnapshot;
  /**
   * 落库一次扫描结果（全量替换；行序即默认展示序）
   * @param rows 展示行
   * @param meta 扫描元信息
   */
  saveScan: (rows: readonly DividendScreenRow[], meta: DividendScanMeta) => Promise<void>;
  /**
   * 读当前规则配置（响应式；保存后自动更新；未保存过 = 默认预置）
   * @returns 规则配置
   */
  ruleConfig: () => RuleConfig[];
  /**
   * 保存规则配置（全量替换；界面每次增删改规则后调用）
   * @param configs 规则配置
   */
  saveRuleConfig: (configs: readonly RuleConfig[]) => Promise<void>;
  /**
   * 读股息自选（响应式；加入 / 移出后自动更新；按加入顺序排列）
   * @returns 自选条目
   */
  watchlist: () => DividendWatchItem[];
  /**
   * 加入自选（已在自选内的代码自动跳过，保持原顺序）
   * @param items 待加入条目
   */
  addWatch: (items: readonly DividendWatchItem[]) => Promise<void>;
  /**
   * 移出自选（不在自选内的代码静默忽略）
   * @param codes 待移出的代码
   */
  removeWatch: (codes: readonly string[]) => Promise<void>;
}

/**
 * 把库里读出的行还原成展示行（脏数据兜底：数值列非数一律 null，状态列非法回退到未披露）
 * @param row 库里的一行
 * @returns 展示行
 */
const hydrateRow = (row: PluginDbRow<Record<string, unknown>>): DividendScreenRow => {
  const num = (key: string): number | null => {
    const value = row[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };
  const text = (key: string): string => (typeof row[key] === 'string' ? (row[key] as string) : '');
  const dpsLast = num('dps_last');
  return {
    code: text('code'),
    name: text('name'),
    industry: text('industry'),
    price: num('price'),
    changePercent: num('change_percent'),
    marketCap: num('market_cap'),
    pb: num('pb'),
    peTtm: num('pe_ttm'),
    totalShares: num('total_shares'),
    ttmYield: num('ttm_yield'),
    // dpsLast 在写入侧恒为真实数值（无分红 = 0），水合侧兜底为 0 保持类型收紧
    dpsLast: dpsLast ?? 0,
    dividendTotalLast: num('dividend_total_last'),
    netProfitFyLast: num('np_fy_last'),
    payoutLast: num('payout_last'),
    netProfitH1: num('np_h1'),
    netProfitH1Last: num('np_h1_last'),
    netProfitYoY: num('np_yoy'),
    revenueYoY: num('rev_yoy'),
    growthH1: num('growth_h1'),
    projectedNetProfit: num('np_proj'),
    projectedDps: num('dps_proj'),
    projectedYield: num('yield_proj'),
    yieldLast: num('yield_last'),
    interimDps: num('interim_dps'),
    dividendYears: num('dividend_years'),
    ocfPerShareLast: num('ocf_per_share_last'),
    cashCoverLast: num('cash_cover_last'),
    debtRatio: num('debt_ratio'),
    status: toStatus(text('status')),
  };
};

/**
 * 库里的状态列还原成推算状态（非法值兜底回「中报未披露」）
 * @param value 状态列文本
 * @returns 推算状态
 */
const toStatus = (value: string): ProjectStatus => {
  const values: readonly string[] = Object.values(DIVIDEND_PROJECT_STATUS);
  return values.includes(value) ? (value as ProjectStatus) : DIVIDEND_PROJECT_STATUS.NO_REPORT;
};

/**
 * 建表并水合快照
 * @param db 插件通用数据库（`ctx.db`）
 * @returns 股息筛选仓储
 */
export const createDividendRepo = async (db: PluginDatabase): Promise<DividendRepo> => {
  await db.ensureTable(DIVIDEND_ROWS_TABLE, DIVIDEND_ROWS_COLUMNS);
  await db.ensureTable(DIVIDEND_META_TABLE, DIVIDEND_META_COLUMNS);
  await db.ensureTable(DIVIDEND_CONFIG_TABLE, DIVIDEND_CONFIG_COLUMNS);
  await db.ensureTable(DIVIDEND_WATCH_TABLE, DIVIDEND_WATCH_COLUMNS);

  const rows = ref<DividendScreenRow[]>([]);
  const meta = ref<DividendScanMeta | null>(null);
  const ruleConfigs = ref<RuleConfig[]>(createDefaultRules());
  const watchItems = ref<DividendWatchItem[]>([]);

  // 水合：读库即渲染，不联网
  const storedRows = await db.select<Record<string, unknown>>(DIVIDEND_ROWS_TABLE, {
    orderBy: { column: 'id' },
  });
  rows.value = storedRows.map(hydrateRow);

  const storedMeta = await db.select<MetaRow>(DIVIDEND_META_TABLE, {
    where: { meta_key: DIVIDEND_META_KEY },
  });
  const metaValue = storedMeta[0]?.meta_value;
  if (metaValue && typeof metaValue === 'object') {
    meta.value = metaValue as DividendScanMeta;
  }

  // 规则配置水合：坏配置（未知类型 / 非法结构）清洗丢弃，全坏则回退默认预置
  const storedConfig = await db.select<ConfigRow>(DIVIDEND_CONFIG_TABLE, {
    where: { config_key: DIVIDEND_CONFIG_KEY },
  });
  const sanitized = sanitizeRuleConfigs(storedConfig[0]?.config_value);
  if (sanitized) ruleConfigs.value = sanitized;

  /**
   * 行对象 → 落库行（saveScan 用；字段清单与列声明一一对应）
   * @param row 展示行
   * @returns 落库行
   */
  const toRowRecord = (row: DividendScreenRow): Record<string, unknown> => ({
    code: row.code,
    name: row.name,
    industry: row.industry,
    price: row.price,
    change_percent: row.changePercent,
    market_cap: row.marketCap,
    pb: row.pb,
    pe_ttm: row.peTtm,
    total_shares: row.totalShares,
    ttm_yield: row.ttmYield,
    dps_last: row.dpsLast,
    dividend_total_last: row.dividendTotalLast,
    np_fy_last: row.netProfitFyLast,
    payout_last: row.payoutLast,
    np_h1: row.netProfitH1,
    np_h1_last: row.netProfitH1Last,
    np_yoy: row.netProfitYoY,
    rev_yoy: row.revenueYoY,
    growth_h1: row.growthH1,
    np_proj: row.projectedNetProfit,
    dps_proj: row.projectedDps,
    yield_proj: row.projectedYield,
    yield_last: row.yieldLast,
    interim_dps: row.interimDps,
    dividend_years: row.dividendYears,
    ocf_per_share_last: row.ocfPerShareLast,
    cash_cover_last: row.cashCoverLast,
    debt_ratio: row.debtRatio,
    status: row.status,
  });

  /**
   * 全量重写自选表（add / remove 的共同实现；条目少，clear + insert 写放大可忽略）
   * @param items 新自选清单
   */
  const rewriteWatch = async (items: readonly DividendWatchItem[]): Promise<void> => {
    await db.clear(DIVIDEND_WATCH_TABLE);
    for (const item of items) {
      await db.insert(DIVIDEND_WATCH_TABLE, { code: item.code, name: item.name });
    }
    watchItems.value = [...items];
  };

  return {
    snapshot: (): DividendSnapshot => ({ rows: rows.value, meta: meta.value }),

    ruleConfig: (): RuleConfig[] => ruleConfigs.value,

    watchlist: (): DividendWatchItem[] => watchItems.value,

    addWatch: async (incoming) => {
      const known = new Set(watchItems.value.map((item) => item.code));
      const additions = incoming.filter((item) => item.code !== '' && !known.has(item.code));
      if (additions.length === 0) return;
      await rewriteWatch([...watchItems.value, ...additions]);
    },

    removeWatch: async (codes) => {
      const dropped = new Set(codes);
      const remaining = watchItems.value.filter((item) => !dropped.has(item.code));
      if (remaining.length === watchItems.value.length) return;
      await rewriteWatch(remaining);
    },

    saveRuleConfig: async (configs) => {
      // 全量替换：配置表只有规则这一个键，clear 全表语义等价 upsert
      await db.clear(DIVIDEND_CONFIG_TABLE);
      await db.insert(DIVIDEND_CONFIG_TABLE, {
        config_key: DIVIDEND_CONFIG_KEY,
        config_value: [...configs],
      });
      ruleConfigs.value = sanitizeRuleConfigs([...configs]) ?? createDefaultRules();
    },

    saveScan: async (nextRows, nextMeta) => {
      // 全量替换：快照语义，旧数据没有保留价值（新扫描覆盖同口径的最新数据）
      await db.clear(DIVIDEND_ROWS_TABLE);
      for (const row of nextRows) {
        await db.insert(DIVIDEND_ROWS_TABLE, toRowRecord(row));
      }

      // 元信息键值行：同键先清后插（clear 全表只影响这一个键，语义等价 upsert）
      await db.clear(DIVIDEND_META_TABLE);
      await db.insert(DIVIDEND_META_TABLE, {
        meta_key: DIVIDEND_META_KEY,
        meta_value: nextMeta,
      });

      // 内存快照同步换新引用（界面是 computed，靠引用变化驱动）
      rows.value = [...nextRows];
      meta.value = nextMeta;
    },
  };
};

declare module '../../host/types/plugin.types' {
  /** 本插件对外贡献的服务 */
  interface AppServiceMap {
    /** 股息筛选快照仓储（读快照渲染整页，不联网；由 dsh-dividend-screen 提供） */
    'dividend:repo': DividendRepo;
  }
}
