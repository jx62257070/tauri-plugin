/**
 * 插件 dsh-sidebar-watch · 盯盘候选仓储
 *
 * 本文件演示「通用数据层的第二个消费方」（第一个是 dsh-quick-note 的速记）：
 * 候选落在本插件独立表 `plugin_dsh_sidebar_watch_watch_candidates`
 * （Tauri 端 SQLite 动态表 / 浏览器端 appStorage JSON 表仿真，两端语义一致），
 * 插件永不直接写 SQL，只做「声明式建表 + CRUD」。
 *
 * 每条候选自带一份**阈值提醒规则**（价格 / 涨跌幅 + 方向 + 待触发态），
 * 与 symbol / name 同表落地 —— 重启后阈值与「已触发」状态都还在。
 * 规则本身的判定逻辑在 `alerts.ts`（纯函数），本文件只管存取。
 *
 * 对外经 `watch:repo` 服务暴露：其他插件 `ctx.consume('watch:repo')` 即可读写
 * 同一份候选池（服务声明见文件末尾的模块扩展）。
 */
import { ref } from 'vue';
import { PLUGIN_LOG_PREFIX } from '../../host/constants/plugin.constants';
import { createEmptyAlertRule, type WatchAlertRule } from './alerts';
import { WATCH_ALERT_KIND } from './constants';
import type { PluginDatabase } from '../../host/types/plugin.types';

/** 数据表名（物理表 = `plugin_dsh_sidebar_watch_watch_candidates`） */
export const WATCH_CANDIDATE_TABLE = 'watch_candidates';

/** 一条盯盘候选（symbol 唯一，池内按加入先后排序） */
export interface WatchCandidate {
  /** 完整符号（sh600519） */
  symbol: string;
  /** 加入时的名称快照（行情取不到时兜底展示） */
  name: string;
  /** 加入时间（毫秒时间戳） */
  addedAt: number;
  /** 阈值提醒规则（未设时 `kind` 为空串） */
  alert: WatchAlertRule;
}

/** 用户可编辑的阈值部分（`armed` 由盯盘引擎维护，不由用户直接设） */
export type WatchAlertPatch = Omit<WatchAlertRule, 'armed'>;

/** 盯盘候选仓储（插件对外贡献的能力） */
export interface WatchCandidateRepo {
  /**
   * 列出全部候选（加入顺序，早的在前；响应式）
   * @returns 候选数组
   */
  list: () => readonly WatchCandidate[];
  /**
   * 取单条候选
   * @param symbol 完整符号
   * @returns 候选；不存在返回 undefined
   */
  get: (symbol: string) => WatchCandidate | undefined;
  /**
   * 该符号是否已在候选池里
   * @param symbol 完整符号
   * @returns 是否已在池里
   */
  has: (symbol: string) => boolean;
  /**
   * 加入候选（已在池里或符号为空则忽略）
   * @param symbol 完整符号
   * @param name 股票名称
   */
  add: (symbol: string, name: string) => void;
  /**
   * 移出候选（不在池里则忽略）
   * @param symbol 完整符号
   */
  remove: (symbol: string) => void;
  /**
   * 切换候选状态
   * @param symbol 完整符号
   * @param name 股票名称
   * @returns 切换后是否在候选池里（true = 已加入）
   */
  toggle: (symbol: string, name: string) => boolean;
  /**
   * 设置阈值提醒（改阈值视为重新开始，`armed` 复位为 true）
   * @param symbol 完整符号
   * @param patch 阈值内容
   */
  setAlert: (symbol: string, patch: WatchAlertPatch) => void;
  /**
   * 清除阈值提醒
   * @param symbol 完整符号
   */
  clearAlert: (symbol: string) => void;
  /**
   * 标记「已提醒过」：闭嘴，等价格回到阈值内侧再重新武装
   * @param symbol 完整符号
   */
  markAlertFired: (symbol: string) => void;
  /**
   * 重新武装阈值（价格回到内侧并越过回差后调用）
   * @param symbol 完整符号
   */
  rearmAlert: (symbol: string) => void;
}

/** 候选表的一行（列声明与内部映射的唯一事实源） */
interface WatchCandidateRow extends Record<string, unknown> {
  /** 完整符号（唯一） */
  symbol: string;
  /** 股票名称 */
  name: string;
  /** 加入时间（毫秒时间戳） */
  added_at: number;
  /** 阈值类型（'' / 'price' / 'change'） */
  alert_kind: string | null;
  /** 阈值数值（价格为元、涨跌幅为百分数） */
  alert_value: number | null;
  /** 比较方向（1 = 涨到 / 0 = 跌到） */
  alert_above: number | null;
  /** 待触发态（1 = 待触发 / 0 = 已提醒过） */
  alert_armed: number | null;
}

/**
 * 把库里的一行还原成阈值规则（老行缺列 / 脏值一律回落到「未设阈值」）
 * @param row 候选表的一行
 * @returns 阈值规则
 */
const parseAlertRule = (row: WatchCandidateRow): WatchAlertRule => {
  const kind =
    row.alert_kind === WATCH_ALERT_KIND.PRICE || row.alert_kind === WATCH_ALERT_KIND.CHANGE
      ? row.alert_kind
      : WATCH_ALERT_KIND.NONE;
  const raw = row.alert_value === null || row.alert_value === undefined
    ? null
    : Number(row.alert_value);
  const value = raw !== null && Number.isFinite(raw) ? raw : null;
  return {
    kind: value === null ? WATCH_ALERT_KIND.NONE : kind,
    value,
    above: Number(row.alert_above ?? 1) !== 0,
    armed: Number(row.alert_armed ?? 1) !== 0,
  };
};

/**
 * 把阈值规则摊平成待写入的列
 * @param rule 阈值规则
 * @returns 列名 → 值
 */
const toAlertColumns = (rule: WatchAlertRule): Record<string, unknown> => ({
  alert_kind: rule.kind,
  alert_value: rule.value,
  alert_above: rule.above ? 1 : 0,
  alert_armed: rule.armed ? 1 : 0,
});

/**
 * 创建盯盘候选仓储（异步：先建表 / 水合，再返回可用的仓储）
 *
 * 内存用 `ref` 持有候选数组（面板 computed 自动跟随增删刷新），落库走 `ctx.db`。
 * 写库排进**串行队列**：内存立即变、库操作按顺序执行 —— 这样「刚加入就移除」
 * 也能先插后删（否则可能拿着还没生成的宿主主键去删）。落库失败只记日志，
 * 不打断交互（内存态与库不一致时以重启后水合为准）。
 * @param db 插件自有数据库句柄（`ctx.db`）
 * @returns 盯盘候选仓储
 */
export const createWatchCandidateRepo = async (db: PluginDatabase): Promise<WatchCandidateRepo> => {
  // 列声明是唯一事实源：老库缺列时由 ensureTable 自动 ALTER 补上（加过阈值四列）
  await db.ensureTable(WATCH_CANDIDATE_TABLE, [
    { name: 'symbol', type: 'text', indexed: true },
    { name: 'name', type: 'text' },
    { name: 'added_at', type: 'integer', indexed: true },
    { name: 'alert_kind', type: 'text' },
    { name: 'alert_value', type: 'real' },
    { name: 'alert_above', type: 'integer' },
    { name: 'alert_armed', type: 'integer' },
  ]);

  const items = ref<WatchCandidate[]>([]);

  /** symbol → 数据表行主键（删除定位；内存记账，避免每次删除都先查库） */
  const rowIds = new Map<string, number>();

  // 水合：按加入时间升序；历史脏数据里重复的 symbol 只保留第一条
  const rows = await db.select<WatchCandidateRow>(WATCH_CANDIDATE_TABLE, {
    orderBy: { column: 'added_at' },
  });
  const hydrated = new Set<string>();
  for (const row of rows) {
    if (!row.symbol || hydrated.has(row.symbol)) continue;
    hydrated.add(row.symbol);
    items.value.push({
      symbol: row.symbol,
      name: row.name ?? row.symbol,
      addedAt: Number(row.added_at) || 0,
      alert: parseAlertRule(row),
    });
    rowIds.set(row.symbol, row.id);
  }

  /** 串行写队列（保证「先插后删」的顺序） */
  let writeChain: Promise<void> = Promise.resolve();

  /**
   * 排一个库操作进队列
   * @param task 库操作
   */
  const enqueue = (task: () => Promise<void>): void => {
    writeChain = writeChain.then(task).catch((error: unknown) => {
      console.error(`${PLUGIN_LOG_PREFIX} dsh-sidebar-watch 盯盘候选落库失败`, error);
    });
  };

  /**
   * 该符号是否已在候选池里
   * @param symbol 完整符号
   * @returns 是否已在池里
   */
  const has = (symbol: string): boolean =>
    items.value.some((item) => item.symbol === symbol);

  /**
   * 取单条候选
   * @param symbol 完整符号
   * @returns 候选；不存在返回 undefined
   */
  const get = (symbol: string): WatchCandidate | undefined =>
    items.value.find((item) => item.symbol === symbol);

  /**
   * 就地替换一条候选（数组换新引用以驱动面板 computed）并落库
   * @param symbol 完整符号
   * @param next 新的候选对象
   */
  const replaceItem = (symbol: string, next: WatchCandidate): void => {
    const index = items.value.findIndex((item) => item.symbol === symbol);
    if (index < 0) return;
    const copy = items.value.slice();
    copy[index] = next;
    items.value = copy;
    enqueue(async (): Promise<void> => {
      const id = rowIds.get(symbol);
      if (id === undefined) return;
      await db.update(WATCH_CANDIDATE_TABLE, id, toAlertColumns(next.alert));
    });
  };

  /**
   * 改某条候选的阈值规则（候选不在池里则忽略）
   * @param symbol 完整符号
   * @param patch 阈值内容
   */
  const setAlert = (symbol: string, patch: WatchAlertPatch): void => {
    const current = get(symbol);
    if (!current) return;
    replaceItem(symbol, { ...current, alert: { ...patch, armed: true } });
  };

  /**
   * 改某条候选的「待触发」标记（只改 armed；候选不在池里则忽略）
   * @param symbol 完整符号
   * @param armed 是否待触发
   */
  const setArmed = (symbol: string, armed: boolean): void => {
    const current = get(symbol);
    if (!current || current.alert.armed === armed) return;
    replaceItem(symbol, { ...current, alert: { ...current.alert, armed } });
  };

  /**
   * 加入候选（已在池里或符号为空则忽略）
   * @param symbol 完整符号
   * @param name 股票名称
   */
  const add = (symbol: string, name: string): void => {
    if (!symbol || has(symbol)) return;
    const candidate: WatchCandidate = {
      symbol,
      name,
      addedAt: Date.now(),
      alert: createEmptyAlertRule(),
    };
    items.value = [...items.value, candidate];
    enqueue(async (): Promise<void> => {
      const id = await db.insert(WATCH_CANDIDATE_TABLE, {
        symbol: candidate.symbol,
        name: candidate.name,
        added_at: candidate.addedAt,
        ...toAlertColumns(candidate.alert),
      });
      rowIds.set(candidate.symbol, id);
    });
  };

  /**
   * 移出候选（不在池里则忽略）
   * @param symbol 完整符号
   */
  const remove = (symbol: string): void => {
    if (!has(symbol)) return;
    items.value = items.value.filter((item) => item.symbol !== symbol);
    enqueue(async (): Promise<void> => {
      // 队列顺序保证此时插入已完成（id 已在账上）；查不到说明插入失败过，无需删
      const id = rowIds.get(symbol);
      if (id === undefined) return;
      await db.remove(WATCH_CANDIDATE_TABLE, id);
      rowIds.delete(symbol);
    });
  };

  return {
    list: (): readonly WatchCandidate[] => items.value,
    get,
    has,
    add,
    remove,
    toggle: (symbol: string, name: string): boolean => {
      if (has(symbol)) {
        remove(symbol);
        return false;
      }
      add(symbol, name);
      return true;
    },
    setAlert,
    clearAlert: (symbol: string): void => {
      setAlert(symbol, createEmptyAlertRule());
    },
    markAlertFired: (symbol: string): void => setArmed(symbol, false),
    rearmAlert: (symbol: string): void => setArmed(symbol, true),
  };
};

// 把本插件的服务登记进全局服务契约表
declare module '../../host/types/plugin.types' {
  interface AppServiceMap {
    /** 盯盘候选仓储（由 dsh-sidebar-watch 提供） */
    'watch:repo': WatchCandidateRepo;
  }
}
