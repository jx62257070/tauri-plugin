<script setup lang="ts">
import { computed, ref } from 'vue';
import AlertEditor from './AlertEditor.vue';
import { describeAlertRule, isAlertConfigured, createEmptyAlertRule } from './alerts';
import { filterCandidatesByWatchlist } from './candidates';
import {
  WATCH_ALERT_BUTTON_ACTIVE_TITLE,
  WATCH_ALERT_BUTTON_TITLE,
  WATCH_ALERT_EDITOR_TITLE,
  WATCH_ALERT_TONE,
  WATCH_ALERT_TONE_LABEL_CLASS,
  WATCH_EMPTY_HINT,
  WATCH_SKELETON_ROWS,
  WATCHLIST_ROUTE_PATH,
} from './constants';
import type { WatchMonitor } from './monitor';
import type { WatchDeps } from './types';
import type { WatchAlertPatch, WatchCandidateRepo } from './service';
import type { WatchAlertRule } from './alerts';
import type { FullQuote } from '../../host/types/stock-quote.types';
import type { StockContextItem } from '../../host/types/plugin.types';

/**
 * 自选盯盘下拉面板（插件 dsh-sidebar-watch 的顶栏条目内容）
 *
 * 盯的是**候选池**：候选由用户在自选股表格「操作」列逐只点「盯盘」加入，
 * 落库在本插件自己的表里（`ctx.db`，见 service.ts），与自选股是「子集」关系 ——
 * 面板渲染的是「候选池 ∩ 当前自选股」（见 candidates.ts），
 * 因此删自选股只会让对应行消失，不会报错、也不会留下幽灵行。
 *
 * **本组件不取数**：报价与阈值判定都在插件的盯盘引擎里（见 monitor.ts），
 * 面板只读引擎的快照。引擎不依赖本组件是否挂载，所以下拉收起后阈值提醒照常触发；
 * 顶栏收起态的「单条轮播」读的也是同一份快照（见 plugin.ts 的 marquee）。
 *
 * 点击一行会**跳股票详情整页**（左侧来源列表 = 全部盯盘候选，可在列表内一键切换
 * 同批股票），并顺手把自己收起 —— 下拉浮在内容之上，不收起会挡住详情页。
 *
 * 宿主依赖全部来自 `deps`（见 `types.ts` 的 `WatchDeps`）：本插件以单文件产物分发，
 * 运行时没有 import 可用 —— UI 组件、格式化、跳转、关面板一律走注入。
 */
const props = defineProps<{
  /** 盯盘候选仓储（插件在 apply 里经 props 注入自己的实现） */
  repo: WatchCandidateRepo;
  /** 盯盘引擎（报价快照 + 阈值判定，与面板挂载状态无关） */
  monitor: WatchMonitor;
  /** 宿主能力容器（插件在 apply 里从 ctx 取齐后注入） */
  deps: WatchDeps;
  /** 本顶栏条目的全局键（点完收起下拉时用，不依赖宿主内部 inject 上下文） */
  panelKey: string;
}>();

/** 正在编辑阈值的候选符号（null = 弹窗关闭；同时只编辑一个） */
const editingSymbol = ref<string | null>(null);

/** 阈值弹窗开关（挂在 editingSymbol 上：有目标即开，置空即关） */
const editorOpen = computed({
  get: () => editingSymbol.value !== null,
  set: (open: boolean) => {
    if (!open) editingSymbol.value = null;
  },
});

/** 面板内渲染的一行盯盘数据 */
interface WatchRow {
  /** 完整符号（sh600519） */
  symbol: string;
  /** 展示名（行情未返回时回退候选记录里的名称） */
  name: string;
  /** 现价文案 */
  price: string;
  /** 涨跌幅文案 */
  change: string;
  /** 涨跌幅文字色类名（红涨绿跌跟随全站涨跌主题） */
  trendClass: string;
  /** 阈值简述（未设时为空串） */
  alertText: string;
  /** 阈值文字 / 铃铛配色类名 */
  alertClass: string;
  /** 是否已设阈值 */
  hasAlert: boolean;
  /** 阈值是否已触发（已提醒过，等价格回到内侧才重新武装） */
  fired: boolean;
}

/** 仍在自选股里的候选（删掉的票不渲染，记录保留在库里） */
const candidates = computed(() =>
  filterCandidatesByWatchlist(props.repo.list(), props.deps.watchlist.symbols()),
);

/** 是否首载中（引擎只在第一次拉取时为 true，后续刷新不闪） */
const loading = computed(() => props.monitor.loading.value);

/** 已设阈值的候选数量（顶部摘要） */
const alertCount = computed(
  () => candidates.value.filter((candidate) => isAlertConfigured(candidate.alert)).length,
);

/** 面板内展示的行 */
const rows = computed<WatchRow[]>(() =>
  candidates.value.map((candidate) => {
    // 上游返回的报价 code 是裸代码（300339），本地符号是完整形态（sz300339），
    // 必须走兼容查找，否则永远取不到报价、整列停在占位符
    const quote: FullQuote | undefined = props.deps.format.findQuote(
      props.monitor.quotes.value,
      candidate.symbol,
    );
    const changePercent = quote?.changePercent ?? null;
    const hasAlert = isAlertConfigured(candidate.alert);
    // 提醒语气跟随「触发方向」：设了跌到某价，这条标记本身就应该是跌色
    const alertClass = hasAlert
      ? WATCH_ALERT_TONE_LABEL_CLASS[
        candidate.alert.above ? WATCH_ALERT_TONE.UP : WATCH_ALERT_TONE.DOWN
      ]
      : '';
    return {
      symbol: candidate.symbol,
      name: quote?.name || candidate.name || candidate.symbol,
      price: props.deps.format.price(quote?.price ?? null),
      change: props.deps.format.percent(changePercent),
      trendClass: props.deps.format.trendClass(props.deps.format.trend(changePercent ?? 0)),
      alertText: describeAlertRule(candidate.alert, props.deps.format),
      alertClass,
      hasAlert,
      fired: hasAlert && !candidate.alert.armed,
    };
  }),
);

/** 正在编辑的行（弹窗标题要用股票名；理论上恒存在，兜底 null） */
const editingRow = computed(
  () => rows.value.find((row) => row.symbol === editingSymbol.value) ?? null,
);

/**
 * 取某候选的阈值规则（记录已不在池里时回落到空规则）
 * @param symbol 完整符号
 * @returns 阈值规则
 */
const alertRuleOf = (symbol: string): WatchAlertRule =>
  props.repo.get(symbol)?.alert ?? createEmptyAlertRule();

/**
 * 盯盘候选 → 详情页左侧来源列表
 *
 * 价格 / 涨跌幅取引擎的报价快照（行情未返回时为 null，详情页列表会显示占位符）；
 * symbol 归一化为完整符号，保证与详情页路由符号同形态、当前股高亮可匹配
 * @returns 上下文股票列表
 */
const buildContextList = (): StockContextItem[] =>
  candidates.value.map((candidate) => {
    const quote: FullQuote | undefined = props.deps.format.findQuote(
      props.monitor.quotes.value,
      candidate.symbol,
    );
    return {
      symbol: props.deps.format.normalizeCode(candidate.symbol),
      name: quote?.name || candidate.name || candidate.symbol,
      price: quote?.price ?? null,
      changePercent: quote?.changePercent ?? null,
    };
  });

/**
 * 单击一行：跳股票详情整页（左侧来源列表 = 全部盯盘候选），并收起下拉
 * @param symbol 完整符号
 */
const onOpenStock = (symbol: string): void => {
  props.deps.stockOpen.openPage(symbol, buildContextList());
  props.deps.closePanel(props.panelKey);
};

/**
 * 把一只票移出盯盘候选（自选股本身不动，阈值设置一并丢弃）
 * @param symbol 完整符号
 */
const onRemoveCandidate = (symbol: string): void => {
  if (editingSymbol.value === symbol) editingSymbol.value = null;
  props.repo.remove(symbol);
};

/**
 * 打开 / 关闭某行的阈值弹窗
 * @param symbol 完整符号
 */
const onToggleEditor = (symbol: string): void => {
  editingSymbol.value = editingSymbol.value === symbol ? null : symbol;
};

/**
 * 保存阈值（弹窗随之关闭）
 * @param patch 阈值内容
 */
const onSaveAlert = (patch: WatchAlertPatch): void => {
  const symbol = editingSymbol.value;
  if (!symbol) return;
  props.repo.setAlert(symbol, patch);
  editingSymbol.value = null;
};

/**
 * 清除阈值（弹窗随之关闭）
 */
const onClearAlert = (): void => {
  const symbol = editingSymbol.value;
  if (!symbol) return;
  props.repo.clearAlert(symbol);
  editingSymbol.value = null;
};

/** 去自选股页挑票（下拉随之收起，避免浮在自选表上） */
const onOpenWatchlist = (): void => {
  props.deps.navigate(WATCHLIST_ROUTE_PATH);
  props.deps.closePanel(props.panelKey);
};
</script>

<template>
  <div>
    <!-- 顶部摘要：候选数 + 已设阈值数（下拉里空间够，不必再靠 hover 表达） -->
    <div
      v-if="rows.length > 0"
      class="mb-2 flex items-center justify-between gap-2 text-xs text-text-tertiary"
    >
      <span>{{ rows.length }} 只在盯</span>
      <span v-if="alertCount > 0">{{ alertCount }} 只设了阈值</span>
    </div>

    <component :is="deps.ui.Skeleton" v-if="loading && rows.length > 0">
      <div
        v-for="index in WATCH_SKELETON_ROWS"
        :key="index"
        class="h-7 rounded bg-flat-weak"
      />
    </component>

    <!-- 空态：说清候选从哪来（面板本身没坏，只是还没挑票） -->
    <p v-else-if="rows.length === 0" class="py-1 text-xs leading-relaxed text-text-tertiary">
      {{ WATCH_EMPTY_HINT }}
    </p>

    <ul v-else class="max-h-[52vh] space-y-0.5 overflow-y-auto">
      <li v-for="row in rows" :key="row.symbol" class="rounded-md">
        <div class="group flex items-center gap-0.5 rounded-md hover:bg-flat-weak">
          <button
            type="button"
            class="pressable flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-left active:scale-[0.98]"
            :title="`${row.name} ${row.price} ${row.change}`"
            @click="onOpenStock(row.symbol)"
          >
            <span class="min-w-0 flex-1 truncate text-xs text-text">{{ row.name }}</span>
            <span class="shrink-0 text-xs tabular-nums text-text-secondary">{{ row.price }}</span>
            <span class="w-[52px] shrink-0 text-right text-xs tabular-nums" :class="row.trendClass">
              {{ row.change }}
            </span>
          </button>

          <!-- 阈值提醒：已设阈值时铃铛按触发方向上色，一眼能看出这只票在等什么；
               已触发过一次的加一个小点，表示要等价格回到内侧才重新生效 -->
          <button
            type="button"
            class="pressable relative shrink-0 rounded p-0.5 transition-opacity hover:bg-flat-weak active:scale-90"
            :class="[
              row.hasAlert
                ? row.alertClass
                : 'text-text-tertiary opacity-0 hover:text-text group-hover:opacity-100',
              editingSymbol === row.symbol ? 'bg-primary-weak text-primary opacity-100' : '',
            ]"
            :aria-label="`${row.hasAlert ? WATCH_ALERT_BUTTON_ACTIVE_TITLE : WATCH_ALERT_BUTTON_TITLE} ${row.name}`"
            :title="row.hasAlert ? `阈值：${row.alertText}${row.fired ? '（已触发，待重新生效）' : ''}` : WATCH_ALERT_BUTTON_TITLE"
            @click.stop="onToggleEditor(row.symbol)"
          >
            <component :is="deps.ui.Icon" name="bell" :size="12" />
            <span v-if="row.fired" class="absolute right-0 top-0 h-1 w-1 rounded-full bg-current" />
          </button>

          <button
            type="button"
            class="pressable shrink-0 rounded p-0.5 text-text-tertiary opacity-0 transition-opacity hover:bg-flat-weak hover:text-text group-hover:opacity-100 active:scale-90"
            :aria-label="`移出盯盘 ${row.name}`"
            :title="`移出盯盘 ${row.name}`"
            @click.stop="onRemoveCandidate(row.symbol)"
          >
            <component :is="deps.ui.Icon" name="close" :size="12" />
          </button>
        </div>

        <!-- 已设阈值：常显不藏 hover，否则等于没设 -->
        <p v-if="row.alertText" class="px-2 pb-0.5 text-[10px]" :class="row.alertClass">
          {{ row.alertText }}
        </p>
      </li>
    </ul>

    <!-- 底部入口：候选从自选股的「盯盘」按钮来，给一条直达路径 -->
    <div class="mt-2 border-t border-flat-weak pt-2">
      <button
        type="button"
        class="pressable flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs text-text-secondary hover:bg-flat-weak hover:text-text active:scale-[0.98]"
        @click="onOpenWatchlist"
      >
        <component :is="deps.ui.Icon" name="star" :size="12" />
        打开自选股页挑票
      </button>
    </div>

    <!-- 阈值弹窗：下拉 320px 塞不下编辑器，点铃铛统一改为居中弹窗 -->
    <component
      :is="deps.ui.Modal"
      v-model:open="editorOpen"
      :title="
        editingRow ? `${WATCH_ALERT_EDITOR_TITLE} · ${editingRow.name}` : WATCH_ALERT_EDITOR_TITLE
      "
      max-width-class="max-w-sm"
    >
      <AlertEditor
        v-if="editingSymbol"
        :rule="alertRuleOf(editingSymbol)"
        :deps="deps"
        @save="onSaveAlert"
        @clear="onClearAlert"
      />
    </component>
  </div>
</template>
