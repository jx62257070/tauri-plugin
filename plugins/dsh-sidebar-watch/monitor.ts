/**
 * 插件 dsh-sidebar-watch · 盯盘引擎
 *
 * 为什么不是「面板自己轮询 + 顺手判阈值」：面板挂在顶栏下拉里，
 * 下拉一收起宿主就把内容组件整个卸载（`HeaderItemHost` 的 `v-if="open"`），
 * 而**盯盘的全部意义就是「你没在看的时候替你盯着」** —— 告警不能随下拉一起停摆。
 *
 * 因此本模块把「取报价 → 判阈值 → 弹提醒」整体提到插件层，用宿主的调度器轮询
 * （`app:polling`，无组件依赖；复用全站同一份交易窗口 / 退避 / 可见性策略）：
 * - 面板与顶栏轮播都只消费 `quotes` / `loading`，是纯展示（见 marquee.ts）；
 * - 收起下拉、切到别的页面，盯盘照常工作；
 * - 全插件只有这一处报价请求，不会因为「面板也在轮」而把上游请求翻倍。
 *
 * 监控范围 = **候选池 ∩ 当前自选股**（与面板渲染同一集合，见 `candidates.ts`）：
 * 看到的即盯着的。把票从自选股移除只让该行与它的告警一起停下，
 * 候选记录与阈值仍保留在库里 —— 重新加回自选股即自动续上。
 */
import { computed, effectScope, ref, shallowRef, watch } from 'vue';
import { buildAlertNotice, evaluateAlert, isAlertConfigured } from './alerts';
import { filterCandidatesByWatchlist } from './candidates';
import { WATCH_NOTIFY_SOURCE, WATCH_POLL_INTERVAL_MS, WATCH_QUOTE_CATCHUP_DEBOUNCE_MS } from './constants';
import type { WatchDeps } from './types';
import type { WatchCandidate, WatchCandidateRepo } from './service';
import type { ShallowRef, Ref } from 'vue';
import type { FullQuote } from '../../host/types/stock-quote.types';
import type { PluginLogger } from '../../host/types/plugin.types';

/** 盯盘引擎对外暴露的面（面板只读它，不自己取数） */
export interface WatchMonitor {
  /** 报价快照（key 为上游原始 `code`，查询走 `findQuoteBySymbol`） */
  readonly quotes: Readonly<ShallowRef<Record<string, FullQuote>>>;
  /** 是否首载中（仅第一次拉取为 true；后续刷新静默覆盖，避免整列表闪烁） */
  readonly loading: Readonly<Ref<boolean>>;
  /** 停止轮询并释放全部监听（插件卸载时调用） */
  stop: () => void;
}

/** 盯盘引擎依赖 */
interface WatchMonitorDeps {
  /** 候选仓储（读候选 + 回写阈值触发状态） */
  repo: WatchCandidateRepo;
  /** 插件日志器 */
  logger: PluginLogger;
  /** 宿主能力容器（报价 / 轮询 / 自选股 / 格式化 / 打开个股 / 浮窗） */
  deps: WatchDeps;
}

/**
 * 创建盯盘引擎
 *
 * 调度器与它的监听全部跑在独立 `effectScope` 里：插件卸载时一次 `stop()` 收干净，
 * 不依赖任何组件生命周期。
 * @param options 依赖（仓储 / 日志器 / 宿主能力容器）
 * @returns 盯盘引擎
 */
export const createWatchMonitor = (options: WatchMonitorDeps): WatchMonitor => {
  const { repo, logger, deps } = options;
  const notify = deps.notify;

  /** 报价快照（每次整份替换，行 key 不变 → 表格 DOM 原地复用） */
  const quotes = shallowRef<Record<string, FullQuote>>({});

  /** 首载标记：只在第一次拉取前置 true（与自选股页刷新不闪是同一处理） */
  const loading = ref(true);

  /**
   * 当前监控的候选（候选池 ∩ 自选股）
   * @returns 仍在自选股里的候选（保持候选池顺序）
   */
  const monitoredCandidates = (): readonly WatchCandidate[] =>
    filterCandidatesByWatchlist(repo.list(), deps.watchlist.symbols());

  /**
   * 阈值判定 + 提醒
   *
   * 顺序上**先落库、后弹窗**：反过来的话，若在弹窗与落库之间进程被杀，
   * 重启后会拿着旧的 armed 状态再弹一次（用户看到重复提醒）。
   * @param quotesMap 本轮报价快照
   */
  const evaluateAlerts = (quotesMap: Record<string, FullQuote>): void => {
    for (const candidate of monitoredCandidates()) {
      const rule = candidate.alert;
      if (!isAlertConfigured(rule)) continue;

      const quote = deps.format.findQuote(quotesMap, candidate.symbol);
      const snapshot = {
        price: quote?.price ?? null,
        changePercent: quote?.changePercent ?? null,
      };
      const { fire, rearm } = evaluateAlert(rule, snapshot);

      if (fire) {
        repo.markAlertFired(candidate.symbol);
        const notice = buildAlertNotice(
          rule,
          quote?.name || candidate.name,
          snapshot,
          deps.format,
        );
        notify?.notify({
          title: notice.title,
          body: notice.body,
          tone: notice.tone,
          source: WATCH_NOTIFY_SOURCE,
          // 同一只票只占一格：反复触发时替换旧提醒而不是刷屏
          dedupeKey: `${WATCH_NOTIFY_SOURCE}:${candidate.symbol}`,
          // 点提醒直接看这只票（全站打开个股详情的唯一入口）
          onClick: (): void => deps.stockOpen.openSidebar(candidate.symbol),
        });
        logger.info(`阈值提醒：${notice.title}`);
      } else if (rearm) {
        // 价格回到阈值内侧（越过回差）→ 重新武装，下次到达时再提醒
        repo.rearmAlert(candidate.symbol);
      }
    }
  };

  /**
   * 一轮取数：拉当前监控集合的报价，覆盖快照并判阈值
   */
  const fetchQuotes = async (): Promise<void> => {
    const symbols = monitoredCandidates().map((candidate) => candidate.symbol);
    if (symbols.length === 0) {
      quotes.value = {};
      loading.value = false;
      return;
    }
    try {
      const list = await deps.quotes.fetchFullQuotes(symbols);
      const quotesMap = Object.fromEntries(list.map((quote) => [quote.code, quote]));
      quotes.value = quotesMap;
      evaluateAlerts(quotesMap);
    } finally {
      loading.value = false;
    }
  };

  // 独立作用域：调度器的窗口 / 可见性监听随它一起回收
  const scope = effectScope();

  /** 取消待执行的补拉（scope.run 里赋值；插件卸载时随 scope 一起收尾） */
  let stopCatchUp: (() => void) | undefined;

  scope.run(() => {
    const scheduler = deps.polling.create({
      task: fetchQuotes,
      intervalMs: WATCH_POLL_INTERVAL_MS,
      tradingAware: true,
    });

    /**
     * 新候选补拉报价
     *
     * 调度器是交易窗口感知的：窗口外启动时只取一次，之后不再轮询 ——
     * 那之后新加的候选永远拿不到报价，只能一直挂着 `--` 占位。
     * 这里监听监控集合，出现快照里还没有的 symbol 就**防抖补一轮**
     * （连续增删多只合并成一次；仍是单次批量请求，不碰频率红线）。
     */
    const monitoredSymbols = computed(() =>
      monitoredCandidates().map((candidate) => candidate.symbol),
    );
    let catchUpTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleCatchUp = (): void => {
      if (catchUpTimer) clearTimeout(catchUpTimer);
      catchUpTimer = setTimeout(() => {
        catchUpTimer = undefined;
        void scheduler.runNow();
      }, WATCH_QUOTE_CATCHUP_DEBOUNCE_MS);
    };
    watch(monitoredSymbols, (symbols) => {
      if (symbols.some((symbol) => !deps.format.findQuote(quotes.value, symbol))) {
        scheduleCatchUp();
      }
    });

    stopCatchUp = (): void => {
      if (catchUpTimer) clearTimeout(catchUpTimer);
      catchUpTimer = undefined;
    };
  });

  return {
    quotes,
    loading,
    stop: (): void => {
      stopCatchUp?.();
      scope.stop();
      // 插件卸载时清掉自己弹过的提醒，不在界面上留下无主浮窗
      notify?.dismissBySource(WATCH_NOTIFY_SOURCE);
    },
  };
};

// 把引擎服务登记进全局服务契约表（与 service.ts 的 watch:repo 同模式）。
// dsh-watch-widget 等消费方 inject 这两个名字即可复用同一份候选池与引擎，
// 不会出现「面板一份轮询、小组件又一份」的重复请求。
declare module '../../host/types/plugin.types' {
  interface AppServiceMap {
    /** 盯盘引擎只读句柄（由 dsh-sidebar-watch 提供；报价快照经同一份轮询维护） */
    'watch:monitor': WatchMonitor;
  }
}
