<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  QUICK_NOTE_ASSOCIATE_BUTTON,
  QUICK_NOTE_ASSOCIATE_CLEAR_ARIA,
  QUICK_NOTE_ASSOCIATED_TITLE,
} from './constants';
import { QUICK_NOTE_MAX_LENGTH, type NoteStockRef, type QuickNoteRepo } from './service';
import type { QuickNoteDeps } from './types';

/**
 * 速记面板（插件 dsh-quick-note 的 drawer 面板内容）
 *
 * 侧栏里只放入口按钮（drawer 形态），内容在右侧抽屉展开 —— 编辑类内容需要宽度，
 * 这也是 `mode: 'drawer'` 存在的意义。数据来自插件自己提供的 `note:repo` 服务，
 * 面板组件与数据源由插件内部绑定，宿主完全不参与。
 *
 * v1.1.0：保存时可关联一只股票 —— 经 `app:stock-picker` 打开全站统一的标的搜索弹窗
 * （宿主渲染、含「上次搜索」）挑一只，关联后的速记会出现在该股的个股详情扩展区里。
 *
 * 宿主依赖全部来自 `deps`（见 `types.ts` 的 `QuickNoteDeps`）：本插件以单文件产物分发，
 * 运行时没有 import 可用，UI 组件 / 格式化 / 打开个股 / 选股弹窗一律走注入。
 */
const props = defineProps<{
  /** 速记仓储（插件在 apply 里经 props 注入自己的服务实现） */
  repo: QuickNoteRepo;
  /** 宿主能力容器（插件在 apply 里从 ctx 取齐后注入） */
  deps: QuickNoteDeps;
  /** 本面板的全局键（`panel:close` 关抽屉时用） */
  panelKey: string;
}>();

/** 草稿正文 */
const draft = ref('');

/** 已保存的速记（新的在前；repo.list() 返回响应式数组，增删自动跟随） */
const notes = computed(() => props.repo.list());

/** 是否还有可删除的条目 */
const hasNotes = computed(() => notes.value.length > 0);

// ---------- 股票关联选择器 ----------
/** 当前选中的关联股票（null = 不关联） */
const pickedStock = ref<NoteStockRef | null>(null);

/**
 * 打开宿主选股弹窗挑一只作为关联
 *
 * 弹窗由宿主渲染（`app:stock-picker`，与顶栏搜索同一组件）：面板被折叠 / 组件被卸载
 * 都不影响结果回传，插件也不必自己写一个更差且样式不统一的搜索框。
 */
const onAssociate = async (): Promise<void> => {
  const picked = await props.deps.stockPicker.pick();
  if (picked) pickedStock.value = { symbol: picked.code, name: picked.name };
};

/** 清除当前关联 */
const onClearPicked = (): void => {
  pickedStock.value = null;
};

/** 保存当前草稿（空白内容不落库；关联随笔记一并写入） */
const onSave = (): void => {
  if (!props.repo.create(draft.value, pickedStock.value ?? undefined)) return;
  draft.value = '';
  pickedStock.value = null;
};

/** 保存并关闭抽屉（drawer 形态下的快捷动作，按面板 key 关，不依赖宿主 inject 上下文） */
const onSaveAndClose = (): void => {
  onSave();
  props.deps.closePanel(props.panelKey);
};

/**
 * 删除一条速记
 * @param id 速记 id
 */
const onRemove = (id: string): void => {
  props.repo.remove(id);
};

/**
 * 点速记上的关联标签：打开该股的个股详情（右侧详情侧栏）
 * @param symbol 完整符号
 */
const onOpenStock = (symbol: string): void => {
  props.deps.stockOpen.openSidebar(symbol);
};

/**
 * 编辑区内快捷键：Ctrl/Cmd + Enter 保存
 * @param event 键盘事件
 */
const onKeydown = (event: KeyboardEvent): void => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    onSave();
  }
};

/**
 * 完整符号 → 裸代码（标签里只展示 6 位代码，宿主口径）
 * @param symbol 完整符号
 * @returns 裸代码
 */
const bareCode = (symbol: string): string => props.deps.format.toBareCode(symbol);

/**
 * 相对时间（`3分钟前` / `昨天` / `9-18`）
 * @param timestamp 毫秒时间戳
 * @returns 相对时间文案
 */
const relativeTime = (timestamp: number): string => props.deps.format.relativeTime(timestamp);
</script>

<template>
  <div class="space-y-4">
    <div>
      <textarea
        v-model="draft"
        :maxlength="QUICK_NOTE_MAX_LENGTH"
        rows="5"
        placeholder="记点什么…（Ctrl + Enter 保存）"
        class="w-full resize-y rounded-card border border-flat-weak bg-surface px-3 py-2 text-sm text-text placeholder:text-text-tertiary focus:border-primary focus:outline-none"
        @keydown="onKeydown"
      />

      <!-- 股票关联：宿主选股弹窗（app:stock-picker），确认后落为 pickedStock -->
      <div class="mt-2">
        <div v-if="pickedStock" class="flex items-center gap-2">
          <button
            type="button"
            class="pressable flex items-center gap-1.5 rounded-full bg-primary-weak px-2.5 py-1 text-xs text-primary active:scale-95"
            :title="QUICK_NOTE_ASSOCIATED_TITLE"
            @click="onAssociate"
          >
            <component :is="deps.ui.Icon" name="pencil" :size="12" />
            <span class="max-w-[180px] truncate">
              {{ pickedStock.name }} {{ bareCode(pickedStock.symbol) }}
            </span>
          </button>
          <button
            type="button"
            class="pressable rounded p-0.5 text-text-tertiary hover:text-text active:scale-90"
            :aria-label="QUICK_NOTE_ASSOCIATE_CLEAR_ARIA"
            @click="onClearPicked"
          >
            <component :is="deps.ui.Icon" name="close" :size="12" />
          </button>
        </div>
        <button
          v-else
          type="button"
          class="pressable flex items-center gap-1.5 rounded-full border border-flat-weak px-2.5 py-1 text-xs text-text-tertiary hover:border-primary hover:text-primary active:scale-95"
          @click="onAssociate"
        >
          <component :is="deps.ui.Icon" name="plus" :size="12" />
          {{ QUICK_NOTE_ASSOCIATE_BUTTON }}
        </button>
      </div>

      <div class="mt-2 flex items-center justify-between gap-3">
        <span class="text-xs text-text-tertiary">
          {{ draft.length }} / {{ QUICK_NOTE_MAX_LENGTH }}
        </span>
        <div class="flex items-center gap-2">
          <component
            :is="deps.ui.Button"
            variant="ghost"
            :disabled="draft.trim().length === 0"
            @click="onSaveAndClose"
          >
            保存并关闭
          </component>
          <component
            :is="deps.ui.Button"
            :disabled="draft.trim().length === 0"
            @click="onSave"
          >
            保存
          </component>
        </div>
      </div>
    </div>

    <div class="border-t border-flat-weak pt-3">
      <p class="mb-2 text-xs font-medium text-text-secondary">已保存（{{ notes.length }}）</p>
      <component :is="deps.ui.Empty" v-if="!hasNotes" text="还没有速记" />
      <ul v-else class="space-y-2">
        <li
          v-for="note in notes"
          :key="note.id"
          class="group rounded-card border border-flat-weak px-3 py-2"
        >
          <p class="whitespace-pre-wrap break-words text-sm text-text">{{ note.text }}</p>
          <div class="mt-1 flex items-center justify-between gap-2">
            <span class="flex min-w-0 items-center gap-2">
              <span class="text-xs text-text-tertiary">
                {{ relativeTime(note.createdAt) }}
              </span>
              <!-- 关联标签：点了直达该股详情（右侧详情侧栏） -->
              <button
                v-if="note.symbol"
                type="button"
                class="pressable min-w-0 rounded-full bg-flat-weak px-2 py-0.5 text-xs text-text-secondary hover:text-primary active:scale-95"
                :title="`打开 ${note.stockName || note.symbol} 详情`"
                @click="onOpenStock(note.symbol)"
              >
                <span class="max-w-[140px] truncate">
                  {{ note.stockName || bareCode(note.symbol) }}
                </span>
              </button>
            </span>
            <button
              type="button"
              class="pressable rounded p-1 text-text-tertiary opacity-0 transition-opacity hover:bg-flat-weak hover:text-text group-hover:opacity-100 active:scale-90"
              aria-label="删除这条速记"
              @click="onRemove(note.id)"
            >
              <component :is="deps.ui.Icon" name="trash" :size="12" />
            </button>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>
