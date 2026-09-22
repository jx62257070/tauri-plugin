<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  QUICK_NOTE_MAX_LENGTH,
  type NoteStockRef,
  type QuickNote,
  type QuickNoteRepo,
} from './service';
import type { QuickNoteDeps } from './types';
import {
  QUICK_NOTE_REMOVE_ARIA,
  QUICK_NOTE_SECTION_EMPTY,
  QUICK_NOTE_SECTION_PLACEHOLDER,
  QUICK_NOTE_SECTION_SAVE,
} from './constants';

/**
 * 个股详情扩展区 · 该股的速记（插件 dsh-quick-note 贡献）
 *
 * 经内核的「个股详情扩展区」贡献点挂到右侧个股详情面板底部，
 * 宿主只传当前股票符号；本组件消费插件自己的 note:repo，
 * 展示关联了这只股票的速记，并支持就地追加（自动带上关联）。
 *
 * 宿主依赖全部来自 `deps`（见 `types.ts`）：本插件以单文件产物分发，
 * 运行时没有 import 可用 —— UI 组件、格式化、自选股查名、行情兜底一律走注入。
 */
const props = defineProps<{
  /** 当前股票符号（宿主已归一化为完整形态，如 sh600519） */
  symbol: string;
  /** 速记仓储（插件在注册扩展区时经 props 注入自己的服务实现） */
  repo: QuickNoteRepo;
  /** 宿主能力容器（插件在 apply 里从 ctx 取齐后注入） */
  deps: QuickNoteDeps;
}>();

/** 就地输入的草稿 */
const draft = ref('');

/** 关联了当前股票的速记（新的在前，响应式） */
const notes = computed<readonly QuickNote[]>(() => props.repo.listBySymbol(props.symbol));

/**
 * 解析当前股票的名称（落库用，速记面板的关联标签读它展示）
 *
 * 自选股里有就直接取（零请求）；不在自选里才向行情源取一次快照兜底 ——
 * 名称只在这一次保存时用得上，取不到就退回符号，绝不因为改名失败而丢笔记。
 * @returns 股票名称（兜底为完整符号）
 */
const resolveStockName = async (): Promise<string> => {
  const fromWatchlist = props.deps.watchlist.nameOf(props.symbol);
  if (fromWatchlist) return fromWatchlist;
  try {
    const [quote] = await props.deps.quotes.fetchFullQuotes([props.symbol]);
    if (quote?.name) return quote.name;
  } catch {
    // 名称是展示信息，取不到就用符号，不打断保存
  }
  return props.symbol;
};

/**
 * 保存草稿：自动关联当前股票
 *
 * 先清空草稿（手感即时），名称异步补齐 —— 用户不会感知到那一次查名请求。
 */
const onSave = async (): Promise<void> => {
  const text = draft.value;
  if (!text.trim()) return;
  draft.value = '';
  const name = await resolveStockName();
  const stock: NoteStockRef = { symbol: props.symbol, name };
  props.repo.create(text, stock);
};

/**
 * 编辑区快捷键：Ctrl/Cmd + Enter 保存
 * @param event 键盘事件
 */
const onKeydown = (event: KeyboardEvent): void => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    void onSave();
  }
};

/**
 * 删除一条速记
 * @param id 速记 id
 */
const onRemove = (id: string): void => {
  props.repo.remove(id);
};

/**
 * 相对时间（`3分钟前` / `昨天` / `9-18`）
 * @param timestamp 毫秒时间戳
 * @returns 相对时间文案
 */
const relativeTime = (timestamp: number): string => props.deps.format.relativeTime(timestamp);
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-end gap-2">
      <textarea
        v-model="draft"
        :maxlength="QUICK_NOTE_MAX_LENGTH"
        rows="2"
        :placeholder="QUICK_NOTE_SECTION_PLACEHOLDER"
        class="w-full resize-y rounded-card border border-flat-weak bg-surface px-2.5 py-2 text-sm text-text placeholder:text-text-tertiary focus:border-primary focus:outline-none"
        @keydown="onKeydown"
      />
      <component
        :is="deps.ui.Button"
        variant="primary"
        :disabled="draft.trim().length === 0"
        @click="onSave"
      >
        {{ QUICK_NOTE_SECTION_SAVE }}
      </component>
    </div>

    <component :is="deps.ui.Empty" v-if="notes.length === 0" :text="QUICK_NOTE_SECTION_EMPTY" />
    <ul v-else class="space-y-2">
      <li
        v-for="note in notes"
        :key="note.id"
        class="group rounded-card border border-flat-weak px-3 py-2"
      >
        <p class="whitespace-pre-wrap break-words text-sm text-text">{{ note.text }}</p>
        <div class="mt-1 flex items-center justify-between gap-2">
          <span class="text-xs text-text-tertiary">
            {{ relativeTime(note.createdAt) }}
          </span>
          <button
            type="button"
            class="pressable rounded p-1 text-text-tertiary opacity-0 transition-opacity hover:bg-flat-weak hover:text-text group-hover:opacity-100 active:scale-90"
            :aria-label="QUICK_NOTE_REMOVE_ARIA"
            @click="onRemove(note.id)"
          >
            <component :is="deps.ui.Icon" name="trash" :size="12" />
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>
