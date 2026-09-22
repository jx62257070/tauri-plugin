/**
 * 插件 dsh-quick-note · 私有类型与服务契约
 *
 * 本文件同时演示两件事：
 * - **服务声明合并**：往 `AppServiceMap` 里追加 `note:repo`，之后任何插件
 *   `ctx.consume('note:repo')` 都能拿到强类型实现（未启用本插件时返回 undefined）；
 * - **通用数据层消费**：速记数据落在本插件独立表 `plugin_dsh_quick_note_notes`
 *   （`ctx.db`，Tauri 端 SQLite / 浏览器端本地 JSON 表仿真），插件永不直接写 SQL。
 *
 * v1.1.0：速记可关联一只股票（自选股快选或全市场搜索），
 * 个股详情面板经「个股详情扩展区」贡献点展示该股的速记。
 */
import { ref } from 'vue';
import { PLUGIN_LOG_PREFIX } from '../../host/constants/plugin.constants';
import type { PluginDatabase, PluginStorage } from '../../host/types/plugin.types';

/** 速记关联的股票（关联在创建时一并落库，符号为归一化完整形态如 sh600519） */
export interface NoteStockRef {
  /** 完整符号（sh600519） */
  symbol: string;
  /** 股票名称（展示用） */
  name: string;
}

/** 一条速记 */
export interface QuickNote {
  /** 唯一 id */
  id: string;
  /** 正文 */
  text: string;
  /** 创建时间戳（毫秒） */
  createdAt: number;
  /** 关联的股票符号（未关联为 null） */
  symbol: string | null;
  /** 关联股票的名称（未关联为空串） */
  stockName: string;
}

/** 速记仓储（插件对外贡献的能力） */
export interface QuickNoteRepo {
  /**
   * 列出全部速记（新的在前，响应式）
   * @returns 速记数组
   */
  list: () => readonly QuickNote[];
  /**
   * 列出关联了某只股票的速记（新的在前，响应式）
   * @param symbol 完整符号
   * @returns 该股的速记数组
   */
  listBySymbol: (symbol: string) => readonly QuickNote[];
  /**
   * 取最近一条速记
   * @returns 最近一条；空仓返回 null
   */
  latest: () => QuickNote | null;
  /**
   * 新增一条速记（写数据表）
   * @param text 正文（空白内容会被忽略）
   * @param stock 关联的股票（可选；不传即普通速记）
   * @returns 新建的速记；内容为空时返回 null
   */
  create: (text: string, stock?: NoteStockRef) => QuickNote | null;
  /**
   * 删除一条速记
   * @param id 速记 id
   */
  remove: (id: string) => void;
}

// 把本插件的服务登记进全局服务契约表（宿主契约快照：host/ 由 scripts/sync-host-contract.mjs 同步）
declare module '../../host/types/plugin.types' {
  interface AppServiceMap {
    /** 速记仓储（由 dsh-quick-note 提供） */
    'note:repo': QuickNoteRepo;
  }

  interface AppEventMap {
    /** 新增了一条速记（其他插件可据此做聚合 / 提醒） */
    'note:saved': [note: QuickNote];
  }
}

/** 旧版（ctx.storage 时期）存放速记数组的键 —— 仅用于一次性迁移，之后即清 */
export const QUICK_NOTE_STORAGE_KEY = 'notes';

/** 速记数据表名（物理表 = `plugin_dsh_quick_note_notes`） */
export const QUICK_NOTE_TABLE = 'notes';

/** 速记正文长度上限（超出截断，避免单条占满侧栏） */
export const QUICK_NOTE_MAX_LENGTH = 2000;

/** 速记表的一行（列声明与 service 内部映射的唯一事实源） */
interface QuickNoteRow extends Record<string, unknown> {
  /** 速记 id（UUID） */
  note_id: string;
  /** 正文 */
  content: string;
  /** 创建时间戳（毫秒） */
  created_at_ms: number;
  /** 关联股票的完整符号（未关联为 null；v1.1.0 新增列，老库由宿主自动补列） */
  symbol: string | null;
  /** 关联股票名称（未关联为空串） */
  stock_name: string;
}

/**
 * 创建速记仓储（异步：先建表 / 水合 / 迁移旧数据，再返回可用的仓储）
 *
 * 内存里用 `ref` 持有数组，面板里的 computed 自动跟随增删刷新；
 * 落库走 `ctx.db`（宿主通用数据层），写失败只记日志、不打断交互。
 * @param db 插件自有数据库句柄（`ctx.db`）
 * @param legacyStorage 旧版插件存储（仅用于读取并迁移 ctx.storage 时期的历史数据）
 * @param onCreated 新增成功后的回调（插件用它广播 `note:saved` 事件）
 * @returns 速记仓储
 */
export const createQuickNoteRepo = async (
  db: PluginDatabase,
  legacyStorage: PluginStorage,
  onCreated?: (note: QuickNote) => void,
): Promise<QuickNoteRepo> => {
  await db.ensureTable(QUICK_NOTE_TABLE, [
    { name: 'note_id', type: 'text', indexed: true },
    { name: 'content', type: 'text' },
    { name: 'created_at_ms', type: 'integer', indexed: true },
    // v1.1.0 新增：股票关联。老库缺列时宿主 ensureTable 自动 ALTER 补上，无需迁移脚本
    { name: 'symbol', type: 'text', indexed: true },
    { name: 'stock_name', type: 'text' },
  ]);

  const items = ref<QuickNote[]>([]);

  /**
   * 库行 → QuickNote
   * @param row 数据表里读出的一行（含宿主维护字段）
   * @returns 插件侧的速记对象
   */
  const toNote = (row: QuickNoteRow & { id: number; createdAt: number; updatedAt: number }): QuickNote => ({
    id: row.note_id,
    text: row.content,
    createdAt: row.created_at_ms,
    symbol: row.symbol || null,
    stockName: row.stock_name || '',
  });

  // 水合：优先数据表；表为空且旧版 storage 有历史数据时做一次性迁移
  const rows = await db.select<QuickNoteRow>(QUICK_NOTE_TABLE, {
    orderBy: { column: 'created_at_ms', desc: true },
  });
  if (rows.length > 0) {
    items.value = rows.map(toNote);
  } else {
    const legacyNotes = legacyStorage.get<QuickNote[]>(QUICK_NOTE_STORAGE_KEY, []);
    for (const note of legacyNotes) {
      await db.insert(QUICK_NOTE_TABLE, {
        note_id: note.id,
        content: note.text.slice(0, QUICK_NOTE_MAX_LENGTH),
        created_at_ms: note.createdAt,
        symbol: null,
        stock_name: '',
      });
    }
    if (legacyNotes.length > 0) {
      // 旧形态没有 symbol / stockName 字段，必须补齐成 QuickNote 完整形态
      items.value = legacyNotes.map((note) => ({
        id: note.id,
        text: note.text.slice(0, QUICK_NOTE_MAX_LENGTH),
        createdAt: note.createdAt,
        symbol: null,
        stockName: '',
      }));
    }
  }
  // 旧存储键使命完成（无论是否迁移成功都不再作为数据源），清掉避免新旧并存
  legacyStorage.remove(QUICK_NOTE_STORAGE_KEY);

  /**
   * 静默落库（写失败只记录，不打断交互）
   * @param row 行数据
   */
  const insertQuietly = async (row: QuickNoteRow): Promise<void> => {
    try {
      await db.insert(QUICK_NOTE_TABLE, row);
    } catch (error) {
      console.error(`${PLUGIN_LOG_PREFIX} dsh-quick-note 速记落库失败`, error);
    }
  };

  return {
    list: (): readonly QuickNote[] => items.value,
    listBySymbol: (symbol: string): readonly QuickNote[] =>
      items.value.filter((note) => note.symbol === symbol),
    latest: (): QuickNote | null => items.value[0] ?? null,
    create: (text: string, stock?: NoteStockRef): QuickNote | null => {
      const trimmed = text.trim();
      if (!trimmed) return null;
      const note: QuickNote = {
        id: crypto.randomUUID(),
        text: trimmed.slice(0, QUICK_NOTE_MAX_LENGTH),
        createdAt: Date.now(),
        symbol: stock?.symbol ?? null,
        stockName: stock?.name ?? '',
      };
      items.value = [note, ...items.value];
      void insertQuietly({
        note_id: note.id,
        content: note.text,
        created_at_ms: note.createdAt,
        symbol: note.symbol,
        stock_name: note.stockName,
      });
      onCreated?.(note);
      return note;
    },
    remove: (id: string): void => {
      const before = items.value.length;
      items.value = items.value.filter((note) => note.id !== id);
      if (items.value.length === before) return;
      void (async (): Promise<void> => {
        try {
          const [row] = await db.select<QuickNoteRow>(QUICK_NOTE_TABLE, {
            where: { note_id: id },
          });
          if (row) await db.remove(QUICK_NOTE_TABLE, row.id);
        } catch (error) {
          console.error(`${PLUGIN_LOG_PREFIX} dsh-quick-note 速记删除失败`, error);
        }
      })();
    },
  };
};
