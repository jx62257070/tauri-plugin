<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  WATCH_ALERT_EDITOR_HINT,
  WATCH_ALERT_INPUT_PLACEHOLDER_CHANGE,
  WATCH_ALERT_INPUT_PLACEHOLDER_PRICE,
  WATCH_ALERT_KIND,
  WATCH_ALERT_KIND_LABEL,
} from './constants';
import { describeAlertRule, isAlertConfigured } from './alerts';
import type { WatchAlertKind, WatchAlertRule } from './alerts';
import type { WatchDeps } from './types';
import type { WatchAlertPatch } from './service';

/**
 * 盯盘阈值编辑器（放在 BaseModal 弹窗正文里使用，弹窗标题栏由宿主面板负责）
 *
 * 侧栏只有 224px 宽，行内展开塞不下 —— 点铃铛改为弹窗，
 * 这里按弹窗宽度放开间距，只产出「阈值内容」。
 *
 * **待触发态（armed）由插件的盯盘引擎维护** ——
 * 用户改阈值即视为重新开始，引擎会把 armed 复位，编辑器不必关心。
 */
const props = defineProps<{
  /** 当前阈值规则（未设时为默认空规则） */
  rule: WatchAlertRule;
  /** 宿主能力容器（UI Kit 里的按钮 / 输入框） */
  deps: WatchDeps;
}>();

const emit = defineEmits<{
  /** 保存阈值（数值已校验为正数） */
  save: [patch: WatchAlertPatch];
  /** 清除阈值提醒 */
  clear: [];
}>();

/** 当前选中的阈值类型（价格 / 涨跌幅；不提供「不提醒」，清除走单独按钮） */
const kind = ref<WatchAlertKind>(WATCH_ALERT_KIND.PRICE);

/** 比较方向是否为「涨到 / 涨幅达到」 */
const above = ref(true);

/** 阈值数值的输入原文（用字符串承接，避免输入中途被 Number 归一化吃掉小数点） */
const valueText = ref('');

/**
 * 用外部规则播种编辑器状态（首次进入 / 切换目标时）
 * @param rule 外部传入的阈值规则
 */
const seedFromRule = (rule: WatchAlertRule): void => {
  kind.value = rule.kind === WATCH_ALERT_KIND.CHANGE ? WATCH_ALERT_KIND.CHANGE : WATCH_ALERT_KIND.PRICE;
  above.value = rule.above;
  valueText.value = rule.value === null ? '' : String(rule.value);
};

watch(() => props.rule, seedFromRule, { immediate: true });

/** 输入解析出的数值（非法为 null） */
const parsedValue = computed<number | null>(() => {
  const trimmed = valueText.value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  // 阈值必须是正数：方向由「涨到 / 跌到」按钮表达，数值本身不带符号
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
});

/** 是否可以保存 */
const canSave = computed(() => parsedValue.value !== null);

/** 目标是否为价格 */
const isPrice = computed(() => kind.value === WATCH_ALERT_KIND.PRICE);

/** 方向按钮文案（随阈值类型变化：价格说「涨到」、涨跌幅说「涨幅达到」） */
const directionLabels = computed(() =>
  isPrice.value ? { above: '涨到', below: '跌到' } : { above: '涨幅达到', below: '跌幅达到' },
);

/** 数值输入框占位文案 */
const valuePlaceholder = computed(() =>
  isPrice.value ? WATCH_ALERT_INPUT_PLACEHOLDER_PRICE : WATCH_ALERT_INPUT_PLACEHOLDER_CHANGE,
);

/** 已配置的阈值简述（未配置时为空串） */
const currentSummary = computed(() => describeAlertRule(props.rule, props.deps.format));

/** 保存：数值合法时上报 */
const onSave = (): void => {
  const value = parsedValue.value;
  if (value === null) return;
  emit('save', { kind: kind.value, value, above: above.value });
};
</script>

<template>
  <div class="space-y-4">
    <div>
      <p class="mb-2 text-xs font-medium text-text-secondary">提醒什么</p>
      <!-- 阈值类型：价格 / 涨跌幅 -->
      <div class="flex gap-2">
        <button
          v-for="item in [WATCH_ALERT_KIND.PRICE, WATCH_ALERT_KIND.CHANGE]"
          :key="item"
          type="button"
          class="pressable flex-1 rounded-md px-3 py-1.5 text-sm active:scale-[0.98]"
          :class="
            kind === item
              ? 'bg-primary-weak font-medium text-primary'
              : 'bg-flat-weak/60 text-text-secondary hover:text-text'
          "
          @click="kind = item"
        >
          {{ WATCH_ALERT_KIND_LABEL[item] }}
        </button>
      </div>
    </div>

    <div>
      <p class="mb-2 text-xs font-medium text-text-secondary">往哪个方向</p>
      <!-- 方向：涨到 / 跌到（涨跌幅态文案自动切换） -->
      <div class="flex gap-2">
        <button
          type="button"
          class="pressable flex-1 rounded-md px-3 py-1.5 text-sm active:scale-[0.98]"
          :class="
            above
              ? 'bg-up-weak font-medium text-up'
              : 'bg-flat-weak/60 text-text-secondary hover:text-text'
          "
          @click="above = true"
        >
          {{ directionLabels.above }}
        </button>
        <button
          type="button"
          class="pressable flex-1 rounded-md px-3 py-1.5 text-sm active:scale-[0.98]"
          :class="
            !above
              ? 'bg-down-weak font-medium text-down'
              : 'bg-flat-weak/60 text-text-secondary hover:text-text'
          "
          @click="above = false"
        >
          {{ directionLabels.below }}
        </button>
      </div>
    </div>

    <div>
      <p class="mb-2 text-xs font-medium text-text-secondary">阈值数值</p>
      <component :is="deps.ui.Input" v-model="valueText" :placeholder="valuePlaceholder" />
    </div>

    <p class="text-xs leading-relaxed text-text-tertiary">{{ WATCH_ALERT_EDITOR_HINT }}</p>

    <div class="flex items-center justify-between gap-2 pt-1">
      <button
        v-if="isAlertConfigured(rule)"
        type="button"
        class="pressable text-xs text-text-tertiary hover:text-down active:scale-95"
        @click="emit('clear')"
      >
        清除提醒{{ currentSummary ? `（${currentSummary}）` : '' }}
      </button>
      <span v-else />
      <component :is="deps.ui.Button" variant="primary" :disabled="!canSave" @click="onSave">
        保存
      </component>
    </div>
  </div>
</template>
