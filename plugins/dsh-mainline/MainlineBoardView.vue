<script setup lang="ts">
import { computed, ref } from 'vue';
import { countByPhase, filterVerdicts, isFilterActive, togglePhase } from './filter';
import { judgeAll } from './judge';
import { runMainlineScan, type MainlineScanProgress } from './scan';
import {
  MAINLINE_CANDIDATE_BADGE,
  MAINLINE_COLUMN_LABEL,
  MAINLINE_CONFIDENCE_LABEL,
  MAINLINE_CONNECTED_INPUTS,
  MAINLINE_CONNECTED_TITLE,
  MAINLINE_COVERAGE_TEXT,
  MAINLINE_DEGRADED_NOTICE,
  MAINLINE_DETAIL_LABEL,
  MAINLINE_DETAIL_TITLE,
  MAINLINE_DETAIL_UNIT,
  MAINLINE_DISCLAIMER,
  MAINLINE_EMPTY_TEXT,
  MAINLINE_EM_CALIBER_NOTICE,
  MAINLINE_EM_SLOW_NOTICE,
  MAINLINE_EM_UNMAPPED_BADGE,
  MAINLINE_EM_UNMAPPED_TEXT,
  MAINLINE_FALLBACK_NOTICE,
  MAINLINE_FALLBACK_REASON_LABEL,
  MAINLINE_FILTER_CLEAR,
  MAINLINE_FILTER_EMPTY_TEXT,
  MAINLINE_FILTER_SUMMARY,
  MAINLINE_HEADER_LABEL,
  MAINLINE_INTRADAY_NOTICE,
  MAINLINE_LIMIT_UP_TEXT,
  MAINLINE_LIST_ONLY_NOTICE,
  MAINLINE_MENU_ICON,
  MAINLINE_METRIC_PLACEHOLDER,
  MAINLINE_MISSING_INPUTS,
  MAINLINE_MISSING_TITLE,
  MAINLINE_NO_SAMPLE_TEXT,
  MAINLINE_PAGE_SUBTITLE,
  MAINLINE_PAGE_TITLE,
  MAINLINE_PHASE_BADGE_CLASS,
  MAINLINE_PHASE_FILTER_HINT,
  MAINLINE_PHASE_LABEL,
  MAINLINE_PHASE_LIST,
  MAINLINE_REFS_SOURCE,
  MAINLINE_REFS_SOURCE_LABEL,
  MAINLINE_SCAN_BUTTON,
  MAINLINE_SCAN_FAILED,
  MAINLINE_SCAN_PROGRESS_SUFFIX,
  MAINLINE_SCAN_RUNNING,
  MAINLINE_SOURCE,
  MAINLINE_SOURCE_BADGE_CLASS,
  MAINLINE_SOURCE_LABEL,
  MAINLINE_STALE_BADGE,
  MAINLINE_STALE_NO_BAR_BADGE,
  MAINLINE_STRUCTURE_HOT_BADGE,
  MAINLINE_STRUCTURE_UNAVAILABLE,
  MAINLINE_WARNING_TITLE,
  MANIA_MIN_STREAK,
  YI_UNIT,
  YUAN_PER_YI,
  mainlineRowKey,
} from './constants';
import type { MainlineDeps, MainlineFilterOptions, MainlineVerdict } from './types';
import type { MainlinePhase } from './constants';
import type { MainlineRepo } from './storage';
import type { TableColumn } from '../../host/types/table.types';

/** 页头数据源提示（tone 决定提示条配色：primary = 需要用户注意的口径变化） */
interface SourceNotice {
  /** 提示条配色 */
  tone: 'primary' | 'flat';
  /** 提示正文 */
  text: string;
}

/**
 * 股票主线看板（插件 dsh-mainline 的页面）
 *
 * 界面按技能要求**分成两块**（不让用户盲信自动判定）：
 * ① 原始指标面板：成交占比分位 / 量能倍数（新旧口径）/ 价格分位 / 涨停结构 / 宽度 / 净流入；
 * ② 自动阶段标签 + 风险提示 + 已接入与未接入输入清单。
 *
 * 取数是**点击触发**的重接口（约 90 次板块请求 + 清单页 1 次 + 涨停池 1 次，
 * 并发 3 + 同上游 500ms 间隔），结果按**基准交易日**截面落插件表；
 * 再次进入页面直接读库重算标签，不联网。
 */
const props = defineProps<{
  /** 主线快照仓储（由插件注入，已建表并水合） */
  repo: MainlineRepo;
  /** 宿主能力（UI Kit / 格式化 / 网络 / 市场数据），由插件在 apply 里取好传入 */
  deps: MainlineDeps;
}>();

/** 宿主格式化服务（模板里写 `format.percent(...)` 比 `deps.format.percent(...)` 好读） */
const format = props.deps.format;

/** 是否正在扫描 */
const scanning = ref(false);
/** 扫描进度（null = 未进行中） */
const progress = ref<MainlineScanProgress | null>(null);
/** 取数告警文案（空串 = 无告警） */
const scanNotice = ref('');
/** 是否只看主线候选 */
const candidateOnly = ref(false);
/** 选中的阶段（多选；空数组 = 不按阶段筛选） */
const activePhases = ref<MainlinePhase[]>([]);
/** 当前展开的板块代码（受控展开行） */
const expandedKeys = ref<string[]>([]);

/** 全部板块判定结论（读快照重算，无网络请求） */
const verdicts = computed<MainlineVerdict[]>(() => {
  const snapshot = props.repo.snapshot();
  return judgeAll(snapshot.boards, snapshot.market);
});

/** 当前筛选条件（候选开关 + 选中阶段） */
const filterOptions = computed<MainlineFilterOptions>(() => ({
  candidateOnly: candidateOnly.value,
  phases: activePhases.value,
}));

/** 只应用「候选」这一个条件的结论（作为阶段计数的基数） */
const candidateFiltered = computed<MainlineVerdict[]>(() =>
  filterVerdicts(verdicts.value, { candidateOnly: candidateOnly.value, phases: [] }),
);

/**
 * 表格行（候选 + 阶段筛选后）
 *
 * 阶段计数以 `candidateFiltered` 为基数，所以**徽标上的数字就是点下去后的行数**，
 * 不会出现「显示 39 点进去只剩 12」这种对不上的情况。
 */
const rows = computed<MainlineVerdict[]>(() => filterVerdicts(verdicts.value, filterOptions.value));

/** 是否有任一筛选条件生效（决定是否露出「清除筛选」与行数提示） */
const filterActive = computed(() => isFilterActive(filterOptions.value));

/**
 * 切换某个阶段的筛选态（多选：再点一次取消该阶段）
 * @param phase 阶段取值
 */
const onTogglePhase = (phase: MainlinePhase): void => {
  activePhases.value = togglePhase(activePhases.value, phase);
};

/** 清除全部筛选（候选 + 阶段），与「再点一次取消」互为兜底 */
const onClearFilters = (): void => {
  candidateOnly.value = false;
  activePhases.value = [];
};

/** 扫描元信息 */
const meta = computed(() => props.repo.snapshot().meta);

/** 当前数据源（未扫描过默认同花顺；两个来源的序列分开存放，界面永远只看一套） */
const currentSource = computed(() => props.repo.snapshot().source);

/** 基准日覆盖率是否降级（没有任何交易日达到覆盖率门槛，已退回覆盖最全的一天） */
const degraded = computed(() => meta.value?.degraded === true);

/** 板块清单来源文案（清单页现取 / 本地缓存 / 内置兜底 / 东财） */
const refsSourceLabel = computed(() => {
  const info = meta.value;
  if (!info) return '';
  return MAINLINE_REFS_SOURCE_LABEL[info.refsSource ?? MAINLINE_REFS_SOURCE.LIVE];
});

/** 整表切换数据源的原因文案（空串 = 未切换） */
const fallbackReasonText = computed(() => {
  const key = meta.value?.fallbackReason;
  if (!key) return '';
  return key in MAINLINE_FALLBACK_REASON_LABEL
    ? MAINLINE_FALLBACK_REASON_LABEL[key as keyof typeof MAINLINE_FALLBACK_REASON_LABEL]
    : key;
});

/** 页头数据源提示（切换原因 / 口径差 / 清单降级），空数组 = 一切正常 */
const sourceNotices = computed<SourceNotice[]>(() => {
  const info = meta.value;
  if (!info) return [];
  const notices: SourceNotice[] = [];
  if (info.source === MAINLINE_SOURCE.EM) {
    // 整表降级：把「为什么切」「上游报了什么错」「口径差在哪」一次说清
    notices.push({
      tone: 'primary',
      text: MAINLINE_FALLBACK_NOTICE(fallbackReasonText.value, info.fallbackError ?? ''),
    });
    notices.push({ tone: 'primary', text: MAINLINE_EM_CALIBER_NOTICE });
    notices.push({ tone: 'flat', text: MAINLINE_EM_SLOW_NOTICE });
    const unmapped = info.emUnmapped ?? [];
    if (unmapped.length > 0) {
      notices.push({ tone: 'primary', text: MAINLINE_EM_UNMAPPED_TEXT(unmapped) });
    }
  } else if (info.listError) {
    // 清单页故障但日线仍走同花顺：口径没变，只是缺当日结构指标
    notices.push({
      tone: 'flat',
      text: MAINLINE_LIST_ONLY_NOTICE(info.listError, refsSourceLabel.value),
    });
  }
  return notices;
});

/**
 * 各阶段数量统计（看板顶部速览，同时充当阶段筛选开关）
 *
 * 计数基数 = 候选过滤后的结论（不含阶段筛选），这样徽标数字 = 点它之后的行数。
 */
const phaseSummary = computed(() => {
  const counts = countByPhase(candidateFiltered.value);
  return MAINLINE_PHASE_LIST.map((phase) => ({
    phase,
    label: MAINLINE_PHASE_LABEL[phase],
    badgeClass: MAINLINE_PHASE_BADGE_CLASS[phase],
    count: counts[phase],
  }));
});

/** 表格列配置 */
const columns: TableColumn<MainlineVerdict>[] = [
  { key: 'name', label: MAINLINE_COLUMN_LABEL.name },
  { key: 'phase', label: MAINLINE_COLUMN_LABEL.phase },
  { key: 'change', label: MAINLINE_COLUMN_LABEL.change, align: 'right', sortable: true, sortValue: (row) => row.metrics.latestChange },
  { key: 'change5', label: MAINLINE_COLUMN_LABEL.change5, align: 'right', sortable: true, sortValue: (row) => row.metrics.change5 },
  { key: 'share', label: MAINLINE_COLUMN_LABEL.share, align: 'right', sortable: true, sortValue: (row) => row.metrics.turnoverShare },
  { key: 'sharePercentile', label: MAINLINE_COLUMN_LABEL.sharePercentile, align: 'right', sortable: true, sortValue: (row) => row.metrics.sharePercentile },
  { key: 'amountRatio', label: MAINLINE_COLUMN_LABEL.amountRatio, align: 'right', sortable: true, sortValue: (row) => row.metrics.amountRatio },
  { key: 'pricePercentile', label: MAINLINE_COLUMN_LABEL.pricePercentile, align: 'right', sortable: true, sortValue: (row) => row.metrics.pricePercentile },
  { key: 'limitUp', label: MAINLINE_COLUMN_LABEL.limitUp, align: 'right', sortable: true, sortValue: (row) => row.metrics.limitUpCount },
  { key: 'breadth', label: MAINLINE_COLUMN_LABEL.breadth, align: 'right', sortable: true, sortValue: (row) => row.metrics.breadth },
  { key: 'netInflow', label: MAINLINE_COLUMN_LABEL.netInflow, align: 'right', sortable: true, sortValue: (row) => row.metrics.netInflow },
];

/**
 * 行 key（展开行与排序都用它；带数据源 —— 切换来源时不会复用同一行、把两套口径混着看）
 * @param row 判定结论
 * @returns 行 key
 */
const rowKey = (row: MainlineVerdict): string => mainlineRowKey(row.metrics.source, row.code);

/**
 * 该行是否为「兜底模式下东财无同义板块」（映射不上 → 空序列 → 历史样本为 0）
 * @param row 判定结论
 * @returns 是否
 */
const isEmUnmapped = (row: MainlineVerdict): boolean =>
  row.metrics.source === MAINLINE_SOURCE.EM && row.metrics.historyDays === 0;

/**
 * 数据滞后徽标文案
 *
 * 分三种情形：「滞后 N 日」/「无基准日行情」（有序列但基准日缺 bar）/
 * 空串（EM 无同义板块的行由自己的徽标表达，不重复）。
 * @param row 判定结论
 * @returns 徽标文案；不需要展示时为空串
 */
const staleBadge = (row: MainlineVerdict): string => {
  if (!row.metrics.stale || isEmUnmapped(row)) return '';
  return row.metrics.staleDays > 0
    ? MAINLINE_STALE_BADGE(row.metrics.staleDays)
    : MAINLINE_STALE_NO_BAR_BADGE;
};

/**
 * 涨跌幅文案样式（跟全站涨跌色一致）
 * @param value 涨跌幅（%）
 * @returns 文本色类名
 */
const changeClass = (value: number): string =>
  props.deps.format.trendClass(props.deps.format.trend(value));

/**
 * 金额文案样式（净流入等带方向的金额）
 * @param value 金额（元）
 * @returns 文本色类名
 */
const amountClass = (value: number | null): string =>
  value === null || value === 0
    ? 'text-text-secondary'
    : props.deps.format.trendClass(props.deps.format.trend(value));

/**
 * 格式化分位（分位不可得时给「无样本」而不是 0）
 * @param value 分位（0-100）
 * @returns 文案
 */
const formatPercentile = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) return MAINLINE_NO_SAMPLE_TEXT;
  return `${value.toFixed(1)}%`;
};

/**
 * 格式化百分比（占比 / 宽度 / 涨停占比）
 * @param value 百分比值
 * @returns 文案
 */
const formatPercentValue = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? MAINLINE_METRIC_PLACEHOLDER : `${value.toFixed(1)}%`;

/**
 * 格式化成交占比（%）
 * @param value 成交占比
 * @returns 文案
 */
const formatShare = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? MAINLINE_METRIC_PLACEHOLDER : `${value.toFixed(2)}%`;

/**
 * 格式化倍数
 * @param value 倍数
 * @returns 文案
 */
const formatRatio = (value: number | null): string =>
  value === null || !Number.isFinite(value)
    ? MAINLINE_METRIC_PLACEHOLDER
    : `${value.toFixed(2)}${MAINLINE_DETAIL_UNIT.times}`;

/**
 * 格式化成交额（元 → 亿元，保留一位）
 * @param value 成交额（元）
 * @returns 文案
 */
const formatYuanToYi = (value: number | null): string =>
  value === null || !Number.isFinite(value)
    ? MAINLINE_METRIC_PLACEHOLDER
    : `${(value / YUAN_PER_YI).toFixed(1)}${YI_UNIT}`;

/**
 * 格式化净流入（元 → 亿元，带正负号）
 * @param value 净流入（元）
 * @returns 文案
 */
const formatNetInflow = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) return MAINLINE_METRIC_PLACEHOLDER;
  const yi = value / YUAN_PER_YI;
  return `${yi > 0 ? '+' : ''}${yi.toFixed(1)}${YI_UNIT}`;
};

/**
 * 格式化涨停列（家数，连板高度到档时补注）
 * @param row 判定结论
 * @returns 文案
 */
const formatLimitUp = (row: MainlineVerdict): string => {
  const { limitUpCount, maxStreak } = row.metrics;
  if (limitUpCount === null) return MAINLINE_METRIC_PLACEHOLDER;
  if (maxStreak !== null && maxStreak >= MANIA_MIN_STREAK) {
    return `${limitUpCount}${MAINLINE_DETAIL_UNIT.houses}（${maxStreak}${MAINLINE_DETAIL_UNIT.boards}）`;
  }
  return `${limitUpCount}${MAINLINE_DETAIL_UNIT.houses}`;
};

/**
 * 格式化家数对（上涨 / 下跌）
 * @param rise 上涨家数
 * @param fall 下跌家数
 * @returns 文案
 */
const formatRiseFall = (rise: number | null, fall: number | null): string =>
  rise === null && fall === null ? MAINLINE_METRIC_PLACEHOLDER : `${rise ?? MAINLINE_METRIC_PLACEHOLDER} / ${fall ?? MAINLINE_METRIC_PLACEHOLDER}`;

/**
 * 扫描时间文案
 * @param value 毫秒时间戳
 * @returns 本地时间文案
 */
const formatScannedAt = (value: number): string => new Date(value).toLocaleString('zh-CN');

/**
 * 阶段徽标配色
 *
 * 之所以包一层而不在模板里直接索引常量：`app:ui.Table` 以 `<component :is>` 渲染后
 * 插槽入参没有类型，模板里 `RECORD[row.phase]` 会被推断成隐式 any 索引；
 * 收进带类型签名的函数后，类型检查照旧生效。
 * @param row 判定结论
 * @returns 徽标类名
 */
const phaseBadgeClass = (row: MainlineVerdict): string => MAINLINE_PHASE_BADGE_CLASS[row.phase];

/**
 * 数据源徽标配色
 * @param row 判定结论
 * @returns 徽标类名
 */
const sourceBadgeClass = (row: MainlineVerdict): string =>
  MAINLINE_SOURCE_BADGE_CLASS[row.metrics.source];

/**
 * 数据源文案
 * @param row 判定结论
 * @returns 数据源名
 */
const sourceLabel = (row: MainlineVerdict): string => MAINLINE_SOURCE_LABEL[row.metrics.source];

/**
 * 置信度文案
 * @param row 判定结论
 * @returns 置信度说明
 */
const confidenceLabel = (row: MainlineVerdict): string =>
  MAINLINE_CONFIDENCE_LABEL[row.confidence];

/**
 * 切换某行的展开态
 * @param row 判定结论
 */
const onToggleExpand = (row: MainlineVerdict): void => {
  const key = rowKey(row);
  expandedKeys.value = expandedKeys.value.includes(key)
    ? expandedKeys.value.filter((item) => item !== key)
    : [key];
};

/**
 * 触发一次主线扫描（点击触发，不轮询）
 */
const onScan = async (): Promise<void> => {
  if (scanning.value) return;
  scanning.value = true;
  scanNotice.value = '';
  progress.value = { done: 0, total: 0 };
  try {
    const snapshot = props.repo.snapshot();
    const result = await runMainlineScan(
      props.repo,
      snapshot,
      props.deps,
      (next) => {
        progress.value = next;
      },
    );
    const notices: string[] = [];
    if (result.failures.length > 0) {
      notices.push(`有 ${result.failures.length} 个板块取数失败（已保留本地旧数据）：${result.failures.join('、')}`);
    }
    if (result.structureFailed) {
      notices.push(
        `结构指标（涨停 / 宽度 / 净流入）本期未采集完整${
          result.unmappedIndustries.length > 0 ? `，未归属行业：${result.unmappedIndustries.join('、')}` : ''
        }`,
      );
    }
    scanNotice.value = notices.join('；');
  } catch (error) {
    scanNotice.value = `${MAINLINE_SCAN_FAILED}：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    scanning.value = false;
    progress.value = null;
  }
};
</script>

<template>
  <div class="space-y-4">
    <component :is="deps.ui.Card">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <h1 class="flex items-center gap-1.5 text-base font-semibold text-text">
            <component :is="deps.ui.Icon" :name="MAINLINE_MENU_ICON" :size="16" />
            {{ MAINLINE_PAGE_TITLE }}
          </h1>
          <p class="mt-1 text-xs leading-relaxed text-text-secondary">{{ MAINLINE_PAGE_SUBTITLE }}</p>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <span v-if="progress" class="text-xs tabular-nums text-text-tertiary">
            {{ MAINLINE_SCAN_RUNNING }} {{ progress.done }}/{{ progress.total }}
            {{ MAINLINE_SCAN_PROGRESS_SUFFIX }}
          </span>
          <component :is="deps.ui.Button" :disabled="scanning" @click="onScan">
            <component :is="deps.ui.Icon" name="flame" :size="14" />
            {{ MAINLINE_SCAN_BUTTON }}
          </component>
        </div>
      </div>

      <!-- 口径信息：基准交易日是全部指标的截面日，数据源与清单来源一并如实给出 -->
      <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-tertiary">
        <span class="inline-flex items-center gap-1">
          {{ MAINLINE_HEADER_LABEL.source }}：
          <span
            class="rounded px-1.5 py-0.5 text-[11px] font-medium"
            :class="MAINLINE_SOURCE_BADGE_CLASS[currentSource]"
          >
            {{ MAINLINE_SOURCE_LABEL[currentSource] }}
          </span>
        </span>
        <span v-if="meta">{{ MAINLINE_HEADER_LABEL.refsSource }}：{{ refsSourceLabel }}</span>
        <span>
          {{ MAINLINE_HEADER_LABEL.benchmark }}：{{ meta?.asOf || MAINLINE_METRIC_PLACEHOLDER }}
        </span>
        <span>
          {{ MAINLINE_HEADER_LABEL.coverage }}：{{
            meta ? MAINLINE_COVERAGE_TEXT(meta.coverage, meta.boardCount) : MAINLINE_METRIC_PLACEHOLDER
          }}
        </span>
        <span>{{ MAINLINE_HEADER_LABEL.boardCount }}：{{ meta?.boardCount ?? 0 }}</span>
        <span>
          {{ MAINLINE_HEADER_LABEL.marketAmount }}：{{ formatYuanToYi(meta?.marketAmount ?? null) }}
        </span>
        <span>
          {{ MAINLINE_HEADER_LABEL.limitUp }}：{{
            meta && meta.limitUpTotal !== null
              ? MAINLINE_LIMIT_UP_TEXT(meta.limitUpTotal, meta.limitUpUnmapped ?? 0)
              : MAINLINE_STRUCTURE_UNAVAILABLE
          }}
        </span>
        <span v-if="meta">{{ MAINLINE_HEADER_LABEL.scannedAt }}：{{ formatScannedAt(meta.scannedAt) }}</span>
      </div>

      <p
        v-if="meta && meta.excludedDate"
        class="mt-2 rounded-lg bg-flat-weak px-2 py-1.5 text-xs leading-relaxed text-text-secondary"
      >
        {{ MAINLINE_INTRADAY_NOTICE(meta.excludedDate, meta.asOf) }}
      </p>
      <p
        v-if="meta && degraded"
        class="mt-2 rounded-lg bg-primary-weak px-2 py-1.5 text-xs leading-relaxed text-primary"
      >
        {{ MAINLINE_DEGRADED_NOTICE(meta.asOf) }}
      </p>

      <!-- 数据源提示：切换原因 / 口径差 / 清单降级，一律显式说明，不静默换源 -->
      <p
        v-for="(notice, index) in sourceNotices"
        :key="`source-${index}`"
        class="mt-2 rounded-lg px-2 py-1.5 text-xs leading-relaxed"
        :class="notice.tone === 'primary' ? 'bg-primary-weak text-primary' : 'bg-flat-weak text-text-secondary'"
      >
        {{ notice.text }}
      </p>

      <p v-if="scanNotice" class="mt-2 rounded-lg bg-primary-weak px-2 py-1.5 text-xs text-primary">
        {{ scanNotice }}
      </p>

      <!-- 阶段徽标即筛选开关：数字是「点下去后的行数」，多选，再点一次取消 -->
      <div v-if="verdicts.length > 0" class="mt-3">
        <div class="flex flex-wrap items-center gap-1.5">
          <button
            v-for="item in phaseSummary"
            :key="item.phase"
            type="button"
            class="pressable rounded-md px-1.5 py-0.5 text-[11px] tabular-nums transition active:scale-95"
            :class="[
              item.badgeClass,
              activePhases.includes(item.phase)
                ? 'ring-1 ring-current font-medium'
                : filterActive
                  ? 'opacity-50'
                  : '',
            ]"
            :aria-pressed="activePhases.includes(item.phase)"
            :title="`${MAINLINE_PHASE_FILTER_HINT}：${item.label}`"
            @click="onTogglePhase(item.phase)"
          >
            {{ item.label }} {{ item.count }}
          </button>
          <button
            type="button"
            class="pressable ml-1 rounded-md px-1.5 py-0.5 text-[11px] active:scale-95"
            :class="candidateOnly ? 'bg-primary-weak text-primary' : 'bg-flat-weak text-text-secondary'"
            :aria-pressed="candidateOnly"
            @click="candidateOnly = !candidateOnly"
          >
            {{ MAINLINE_CANDIDATE_BADGE }}{{ candidateOnly ? '（已筛选）' : ` ${verdicts.filter((item) => item.candidate).length}` }}
          </button>
        </div>

        <div class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-text-tertiary">
          <span v-if="filterActive" class="tabular-nums">
            {{ MAINLINE_FILTER_SUMMARY(rows.length, verdicts.length) }}
          </span>
          <button
            v-if="filterActive"
            type="button"
            class="pressable rounded px-1 py-0.5 text-primary active:scale-95"
            @click="onClearFilters"
          >
            {{ MAINLINE_FILTER_CLEAR }}
          </button>
          <span v-else>{{ MAINLINE_PHASE_FILTER_HINT }}</span>
        </div>
      </div>
    </component>

    <component :is="deps.ui.Card" :title="MAINLINE_DETAIL_TITLE">
      <template #extra>
        <span class="text-xs text-text-tertiary">点行首箭头看原始指标与风险提示</span>
      </template>

      <!-- 空态分两种原因：还没扫描 / 筛没了（后者要给回退出口，别让用户以为数据丢了） -->
      <div v-if="rows.length === 0">
        <component
          :is="deps.ui.Empty"
          :text="verdicts.length === 0 ? MAINLINE_EMPTY_TEXT : MAINLINE_FILTER_EMPTY_TEXT"
        />
        <p v-if="verdicts.length > 0 && filterActive" class="pb-4 text-center">
          <button
            type="button"
            class="pressable rounded-md bg-primary-weak px-2 py-1 text-xs text-primary active:scale-95"
            @click="onClearFilters"
          >
            {{ MAINLINE_FILTER_CLEAR }}
          </button>
        </p>
      </div>

      <component
        :is="deps.ui.Table"
        v-else
        :columns="columns"
        :rows="rows"
        :row-key="rowKey"
        :row-clickable="true"
        :expandable="true"
        :expanded-keys="expandedKeys"
        min-width="1080px"
        @row-click="onToggleExpand"
        @toggle-expand="onToggleExpand"
      >
        <template #name="{ row }">
          <span class="flex items-center gap-1.5">
            <span class="text-text">{{ row.name }}</span>
            <span
              v-if="row.candidate"
              class="rounded bg-primary-weak px-1 py-0.5 text-[10px] text-primary"
            >
              {{ MAINLINE_CANDIDATE_BADGE }}
            </span>
            <span
              v-if="row.structureHot"
              class="rounded bg-primary-weak px-1 py-0.5 text-[10px] text-primary"
            >
              {{ MAINLINE_STRUCTURE_HOT_BADGE }}
            </span>
            <span
              v-if="isEmUnmapped(row)"
              class="rounded bg-primary-weak px-1 py-0.5 text-[10px] text-primary"
            >
              {{ MAINLINE_EM_UNMAPPED_BADGE }}
            </span>
            <span
              v-if="staleBadge(row)"
              class="rounded bg-flat-weak px-1 py-0.5 text-[10px] text-text-tertiary"
            >
              {{ staleBadge(row) }}
            </span>
          </span>
        </template>

        <template #phase="{ row }">
          <span
            class="rounded-md px-1.5 py-0.5 text-[11px] font-medium"
            :class="phaseBadgeClass(row)"
          >
            {{ row.phaseLabel }}
          </span>
        </template>

        <template #change="{ row }">
          <span :class="changeClass(row.metrics.latestChange)">
            {{ format.percent(row.metrics.latestChange) }}
          </span>
        </template>

        <template #change5="{ row }">
          <span :class="changeClass(row.metrics.change5)">
            {{ format.percent(row.metrics.change5) }}
          </span>
        </template>

        <template #share="{ row }">{{ formatShare(row.metrics.turnoverShare) }}</template>
        <template #sharePercentile="{ row }">
          {{ formatPercentile(row.metrics.sharePercentile) }}
        </template>
        <template #amountRatio="{ row }">{{ formatRatio(row.metrics.amountRatio) }}</template>
        <template #pricePercentile="{ row }">
          {{ formatPercentile(row.metrics.pricePercentile) }}
        </template>
        <template #limitUp="{ row }">{{ formatLimitUp(row) }}</template>
        <template #breadth="{ row }">{{ formatPercentValue(row.metrics.breadth) }}</template>
        <template #netInflow="{ row }">
          <span :class="amountClass(row.metrics.netInflow)">
            {{ formatNetInflow(row.metrics.netInflow) }}
          </span>
        </template>

        <template #expanded="{ row }">
          <div class="space-y-3">
            <p class="text-xs leading-relaxed text-text-secondary">{{ row.phaseDesc }}</p>

            <dl class="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-3 md:grid-cols-4">
              <div>
                <dt class="text-text-tertiary">{{ MAINLINE_DETAIL_LABEL.asOf }}</dt>
                <dd class="tabular-nums text-text">{{ row.metrics.asOf || '—' }}</dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ MAINLINE_DETAIL_LABEL.benchmark }}</dt>
                <dd class="tabular-nums text-text">
                  {{ row.metrics.benchmarkDate || '—' }}
                </dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ MAINLINE_DETAIL_LABEL.source }}</dt>
                <dd>
                  <span
                    class="rounded px-1 py-0.5 text-[10px]"
                    :class="sourceBadgeClass(row)"
                  >
                    {{ sourceLabel(row) }}
                  </span>
                </dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ MAINLINE_DETAIL_LABEL.historyDays }}</dt>
                <dd class="tabular-nums text-text">
                  {{ row.metrics.historyDays }}{{ MAINLINE_DETAIL_UNIT.days }}
                </dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ MAINLINE_DETAIL_LABEL.amount }}</dt>
                <dd class="tabular-nums text-text">{{ formatYuanToYi(row.metrics.amount) }}</dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ MAINLINE_DETAIL_LABEL.turnoverShare }}</dt>
                <dd class="tabular-nums text-text">{{ formatShare(row.metrics.turnoverShare) }}</dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ MAINLINE_DETAIL_LABEL.sharePercentile }}</dt>
                <dd class="tabular-nums text-text">
                  {{ formatPercentile(row.metrics.sharePercentile) }}
                </dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ MAINLINE_DETAIL_LABEL.amountRatio }}</dt>
                <dd class="tabular-nums text-text">{{ formatRatio(row.metrics.amountRatio) }}</dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ MAINLINE_DETAIL_LABEL.amountRatioOverlap }}</dt>
                <dd class="tabular-nums text-text-tertiary">
                  {{ formatRatio(row.metrics.amountRatioOverlap) }}
                </dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ MAINLINE_DETAIL_LABEL.pricePercentile }}</dt>
                <dd class="tabular-nums text-text">
                  {{ formatPercentile(row.metrics.pricePercentile) }}
                </dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ MAINLINE_DETAIL_LABEL.change20 }}</dt>
                <dd class="tabular-nums" :class="changeClass(row.metrics.change20)">
                  {{ format.percent(row.metrics.change20) }}
                </dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ MAINLINE_DETAIL_LABEL.limitUpCount }}</dt>
                <dd class="tabular-nums text-text">
                  {{ formatLimitUp(row) }}
                </dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ MAINLINE_DETAIL_LABEL.maxStreak }}</dt>
                <dd class="tabular-nums text-text">
                  {{
                    row.metrics.maxStreak === null
                      ? MAINLINE_METRIC_PLACEHOLDER
                      : `${row.metrics.maxStreak}${MAINLINE_DETAIL_UNIT.boards}`
                  }}
                </dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ MAINLINE_DETAIL_LABEL.sealFund }}</dt>
                <dd class="tabular-nums text-text">{{ formatYuanToYi(row.metrics.sealFund) }}</dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ MAINLINE_DETAIL_LABEL.limitUpRatio }}</dt>
                <dd class="tabular-nums text-text">
                  {{ formatPercentValue(row.metrics.limitUpRatio) }}
                </dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ MAINLINE_DETAIL_LABEL.riseFall }}</dt>
                <dd class="tabular-nums text-text">
                  {{ formatRiseFall(row.metrics.riseCount, row.metrics.fallCount) }}
                </dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ MAINLINE_DETAIL_LABEL.breadth }}</dt>
                <dd class="tabular-nums text-text">{{ formatPercentValue(row.metrics.breadth) }}</dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ MAINLINE_DETAIL_LABEL.netInflow }}</dt>
                <dd class="tabular-nums" :class="amountClass(row.metrics.netInflow)">
                  {{ formatNetInflow(row.metrics.netInflow) }}
                </dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ MAINLINE_DETAIL_LABEL.leader }}</dt>
                <dd class="truncate text-text">
                  {{ row.metrics.leaderName || MAINLINE_METRIC_PLACEHOLDER }}
                </dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ MAINLINE_DETAIL_LABEL.confidence }}</dt>
                <dd class="text-text">{{ confidenceLabel(row) }}</dd>
              </div>
            </dl>

            <div v-if="row.warnings.length > 0">
              <p class="mb-1 text-xs font-medium text-text-secondary">{{ MAINLINE_WARNING_TITLE }}</p>
              <ul class="space-y-1">
                <li
                  v-for="(warning, index) in row.warnings"
                  :key="index"
                  class="flex gap-1.5 text-xs leading-relaxed text-text-secondary"
                >
                  <span class="text-text-tertiary">•</span>
                  <span>{{ warning }}</span>
                </li>
              </ul>
            </div>
          </div>
        </template>
      </component>
    </component>

    <component :is="deps.ui.Card" :title="MAINLINE_CONNECTED_TITLE">
      <ul class="space-y-1">
        <li
          v-for="(item, index) in MAINLINE_CONNECTED_INPUTS"
          :key="index"
          class="flex gap-1.5 text-xs leading-relaxed text-text-secondary"
        >
          <span class="text-text-tertiary">•</span>
          <span>{{ item }}</span>
        </li>
      </ul>
    </component>

    <component :is="deps.ui.Card" :title="MAINLINE_MISSING_TITLE">
      <ul class="space-y-1">
        <li
          v-for="(item, index) in MAINLINE_MISSING_INPUTS"
          :key="index"
          class="flex gap-1.5 text-xs leading-relaxed text-text-secondary"
        >
          <span class="text-text-tertiary">•</span>
          <span>{{ item }}</span>
        </li>
      </ul>
      <p class="mt-2 text-xs leading-relaxed text-text-tertiary">{{ MAINLINE_DISCLAIMER }}</p>
    </component>
  </div>
</template>
