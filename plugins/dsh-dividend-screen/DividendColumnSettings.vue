<script setup lang="ts">
import { computed } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import {
  DIVIDEND_COLUMN_LABEL,
  DIVIDEND_CONFIGURABLE_COLUMN_KEYS,
  DIVIDEND_SETTINGS_COLUMN_KEY,
} from './constants';
import {
  normalizeDividendColumnConfig,
  visibleDividendColumns,
} from './column-config';
import type { PluginSettingsStore } from '../../host/types/plugin.types';

/**
 * 股息筛选 · 表头列设置（插件 settings 自定义组件，渲染在插件设置弹窗里）
 *
 * 拖拽手柄控制顺序（与路由编排同一套 vue-draggable-plus 交互）、勾选控制显隐，
 * **即时生效即时持久化**（宿主弹窗无确认按钮，与声明式 fields 的交互语义保持一致）；
 * 「恢复默认」回到代码声明顺序 + 全显。至少保留一列可见：最后一列的取消勾选会被忽略。
 */
const props = defineProps<{
  /** 插件设置存取句柄（宿主注入） */
  settings: PluginSettingsStore;
}>();

/** 归一后的当前配置（直接依赖 settings.values，保存后自动重渲染） */
const config = computed(() =>
  normalizeDividendColumnConfig(
    props.settings.values[DIVIDEND_SETTINGS_COLUMN_KEY],
    DIVIDEND_CONFIGURABLE_COLUMN_KEYS,
  ),
);

/** 可见列数 */
const visibleCount = computed(() => visibleDividendColumns(config.value).length);

/**
 * 列顺序的可写视图：拖拽结束后整组落库（隐藏集合不变，只按新顺序过滤对齐）
 */
const orderModel = computed({
  get: () => config.value.order,
  set: (order: string[]) => {
    props.settings.set(DIVIDEND_SETTINGS_COLUMN_KEY, {
      order,
      hidden: order.filter((key) => config.value.hidden.includes(key)),
    });
  },
});

/**
 * 切换一列的显隐（即时落库；收起最后一列的操作被忽略）
 * @param key 列键
 * @param checked 是否勾选（勾选 = 显示）
 */
const onToggle = (key: string, checked: boolean): void => {
  if (!checked && visibleCount.value <= 1) return;
  const current = config.value;
  const hidden = new Set(current.hidden);
  if (checked) hidden.delete(key);
  else hidden.add(key);
  props.settings.set(DIVIDEND_SETTINGS_COLUMN_KEY, {
    order: [...current.order],
    hidden: current.order.filter((candidate) => hidden.has(candidate)),
  });
};

/** 恢复默认：代码声明顺序 + 全部显示（只重置列配置，不动其他设置键） */
const onResetDefault = (): void => {
  props.settings.set(DIVIDEND_SETTINGS_COLUMN_KEY, {
    order: [...DIVIDEND_CONFIGURABLE_COLUMN_KEYS],
    hidden: [],
  });
};
</script>

<template>
  <div>
    <p class="mb-2 text-xs text-text-tertiary">
      勾选要显示的列，拖拽手柄调整顺序（即时生效）；「操作」列固定最左、「规则」列固定最右，不参与调整。
    </p>

    <VueDraggable
      v-model="orderModel"
      tag="ul"
      :animation="150"
      handle="[data-drag-handle]"
      :force-fallback="true"
      fallback-class="sortable-fallback bg-surface shadow-lg ring-1 ring-flat-weak"
      ghost-class="opacity-40"
      chosen-class="bg-flat-weak"
      class="space-y-1"
    >
      <li
        v-for="(key, index) in config.order"
        :key="key"
        class="flex select-none items-center gap-2.5 rounded-lg border border-flat-weak px-2.5 py-1.5 text-sm"
      >
        <!-- 拖拽手柄：内联 grip 图标而不是 `deps.ui.Icon` ——
             本组件由宿主的设置弹窗渲染，宿主只注入 settings，拿不到插件自己的 props。
             手柄用**属性选择器**而不是类名：只为「选中元素」存在的标记不是 Tailwind 工具类，
             产物 CSS 里永远不会有它的规则（样式审计会一直告警），样式交给下面这几个真正的工具类。 -->
        <svg
          data-drag-handle
          class="shrink-0 cursor-grab text-text-tertiary active:cursor-grabbing"
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <circle cx="9" cy="6" r="1" />
          <circle cx="15" cy="6" r="1" />
          <circle cx="9" cy="12" r="1" />
          <circle cx="15" cy="12" r="1" />
          <circle cx="9" cy="18" r="1" />
          <circle cx="15" cy="18" r="1" />
        </svg>
        <span class="w-5 shrink-0 text-right text-xs tabular-nums text-text-tertiary">
          {{ index + 1 }}
        </span>
        <label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            class="h-4 w-4 shrink-0 cursor-pointer rounded border-flat-weak accent-primary"
            :checked="!config.hidden.includes(key)"
            :aria-label="`显示${DIVIDEND_COLUMN_LABEL[key as keyof typeof DIVIDEND_COLUMN_LABEL]}`"
            @change="onToggle(key, ($event.target as HTMLInputElement).checked)"
          />
          <span
            class="truncate"
            :class="config.hidden.includes(key) ? 'text-text-tertiary line-through' : 'text-text'"
          >
            {{ DIVIDEND_COLUMN_LABEL[key as keyof typeof DIVIDEND_COLUMN_LABEL] }}
          </span>
        </label>
      </li>
    </VueDraggable>

    <button
      type="button"
      class="pressable mt-3 rounded-lg px-2 py-1 text-xs text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-95"
      @click="onResetDefault"
    >
      恢复默认列配置
    </button>
  </div>
</template>
