/**
 * 插件 dsh-sidebar-watch · 任务栏盯盘小组件（可选子系统的唯一编排者）
 *
 * 把顶栏「自选盯盘」的轮播内容常驻成 **Windows 任务栏上方的置顶迷你条**
 * （摸鱼场景：不开炒股软件也能一眼扫到自选盯盘标的）。
 *
 * **为什么不自己建引擎**：入参里的 `repo` / `monitor` 必须就是主体 `apply` 里那两个实例 ——
 * 第二份 monitor 会让上游行情请求翻倍、并把阈值的 `armed` 状态双写（见 monitor.ts 的说明）。
 * 这里不校验「是不是同一个」，因为由调用方直接把闭包里的实例传进来，天然就是同一个。
 * 同理，本文件里**不允许**出现 `createWatchMonitor` / `createWatchCandidateRepo` /
 * `consume('watch:…')`：同一个闭包里绕服务容器是自欺，还会给「将来有人补一份」留口子。
 *
 * **为什么不抛错**：本函数是合并后插件的一部分，`apply` 一旦抛出，内核会回滚本插件
 * 的全部贡献点（顶栏盯盘主体一并消失）。小组件只能缺席，不能同归于尽 ——
 * 所有分支都以 return 收尾，async 动作统一走 `safe()`，最后一丝意外交给调用方的 try/catch。
 */
import { computed, watch } from 'vue';
import { isTauri } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { cursorPosition } from '@tauri-apps/api/window';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { PhysicalPosition } from '@tauri-apps/api/dpi';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { NOTIFY_TONE } from '../../../host/constants/notify.constants';
import { filterCandidatesByWatchlist } from '../candidates';
import { WATCH_MARQUEE_TONE_BY_TREND } from '../constants';
import {
  WATCH_WIDGET_BAR_HEIGHT,
  WATCH_WIDGET_BAR_WIDTH,
  WATCH_WIDGET_CURSOR_POLL_MS,
  WATCH_WIDGET_EVENTS,
  WATCH_WIDGET_MODE,
  WATCH_WIDGET_MOVE_SETTLE_MS,
  WATCH_WIDGET_NOTIFY_SOURCE,
  WATCH_WIDGET_POPOVER_FOLLOW_INTERVAL_MS,
  WATCH_WIDGET_POPOVER_HEATMAP_TOP_N,
  WATCH_WIDGET_POPOVER_VIEW,
  WATCH_WIDGET_POPOVER_WIDTH,
  WATCH_WIDGET_POWER,
  WATCH_WIDGET_REVEAL_ZONE,
} from './constants';
import {
  LEGACY_WATCH_WIDGET_PLUGIN_ID,
  legacyWidgetInstalled,
  readWidgetConfig,
  rememberBarPosition,
} from './settings';
import { buildWatchContextList, buildWatchWidgetRows } from './presenter';
import {
  getWorkArea,
  getWindowRect,
  movePopoverToBar,
  openBarWindow,
  openPopoverWindow,
  positionPopover,
  rectContains,
  type PhysicalRect,
} from './windows';
import type {
  WatchWidgetHeatmapBoard,
  WatchWidgetIndexRow,
  WatchWidgetMountOptions,
  WatchWidgetPopoverView,
  WatchWidgetPopoverViewPayload,
} from './types';
import type { MarketIndexQuote } from '../../../host/types/plugin.types';

/** 气泡热力 / 大盘视图的轮询间隔（毫秒；与市场总览「市场宽度」轮询同频）。
 * 仅在「气泡展开 && 对应视图激活」期间运行，收起 / 切走即停 */
const VIEW_POLL_MS = 30_000;

/** 残留旧包时提示用户的浮窗文案（两处提示共用一份） */
const LEGACY_CONFLICT_TITLE = '任务栏小组件冲突';

/** 残留旧包时提示用户的浮窗正文 */
const LEGACY_CONFLICT_BODY =
  `检测到旧版独立插件 ${LEGACY_WATCH_WIDGET_PLUGIN_ID} 仍在运行，小组件已让位给它：`
  + '请到插件工坊卸载它，再重启应用即可用上合并进「自选盯盘」的这一版。';

/**
 * 挂载任务栏盯盘小组件（可选子系统）
 *
 * 能力探测 → 建响应式 computed → 窗口生灭 → 事件收发 → 卸载清理，全部在这里编排。
 * 任何一步不成就**整体缺席**（小组件只有「完整挂载」与「完全缺席」两种状态，
 * 半残的浮窗比没有更难排查），且绝不影响顶栏盯盘主体。
 * @param options 挂载入参（含主体同一份 repo / monitor 实例）
 */
export const mountWatchWidget = async (options: WatchWidgetMountOptions): Promise<void> => {
  const { repo, monitor, logger, settings, runtime, caps, effect, onDispose } = options;

  // 浏览器端无窗口概念，整个小组件静默跳过
  if (!isTauri()) {
    logger.info('非 Tauri 环境，任务栏小组件不挂载');
    return;
  }

  // 必需能力一次性取齐后逐个判空
  // （解构成 const 再判空：只有 const 才能让 TS 在后续整段代码里持续收窄到非 undefined）
  const { format, watchlist, stockOpen, marketStatus, theme, market, notify } = caps;
  const capEntries: ReadonlyArray<readonly [string, unknown]> = [
    ['app:watchlist', watchlist],
    ['app:stock-open', stockOpen],
    ['app:market-status', marketStatus],
    ['app:theme', theme],
    ['app:format', format],
  ];
  // 缺席而不是半残：缺任一必需能力时整个小组件不挂载，顶栏盯盘主体照常工作
  if (!format || !watchlist || !stockOpen || !marketStatus || !theme) {
    const missing = capEntries.filter(([, value]) => value === undefined).map(([name]) => name);
    logger.warn(`宿主未提供 ${missing.join(' / ')} 服务，任务栏小组件跳过挂载（盯盘主体不受影响）`);
    return;
  }

  // 旧独立包残留且已挂载：它会抢同一个窗口 label（两份推送 + 两个光标轮询互相打架），
  // 这里主动让位，并把「去卸载」这件事送到用户眼前
  if (legacyWidgetInstalled(runtime)) {
    logger.warn(
      `检测到残留的旧独立包 ${LEGACY_WATCH_WIDGET_PLUGIN_ID}，任务栏小组件跳过挂载：`
      + '请在插件工坊卸载它',
    );
    notify?.notify({
      title: LEGACY_CONFLICT_TITLE,
      body: LEGACY_CONFLICT_BODY,
      tone: NOTIFY_TONE.DOWN,
      source: WATCH_WIDGET_NOTIFY_SOURCE,
      dedupeKey: WATCH_WIDGET_NOTIFY_SOURCE,
    });
    return;
  }

  /**
   * 兜住所有 async 动作：小组件的内部失败只允许出现在日志里，
   * 不允许变成 unhandled rejection 惊动宿主
   * @param task 待执行的异步动作
   */
  const safe = (task: Promise<void>): void => {
    void task.catch((error: unknown) => {
      logger.warn(`任务栏小组件内部动作失败（已忽略）：${String(error)}`);
    });
  };

  /** 当前生效的小组件配置（reactive：用户在设置弹窗里一改，下面立刻重算） */
  const config = computed(() => readWidgetConfig(settings));

  /** 监控中的候选（候选池 ∩ 自选股，与顶栏轮播同一口径） */
  const candidates = computed(() =>
    filterCandidatesByWatchlist(repo.list(), watchlist.symbols()),
  );

  /** 推送给小组件窗口的展示行（引擎报价一变即重算） */
  const rows = computed(() =>
    buildWatchWidgetRows(candidates.value, monitor.quotes.value, format),
  );

  // ---------- 窗口句柄与显隐状态（仅主窗口侧持有） ----------
  let barWindow: WebviewWindow | null = null;
  let popoverWindow: WebviewWindow | null = null;
  let barVisible = false;
  let popoverVisible = false;
  /**
   * 光标是否在「本次显示之后」到访过条 / 气泡
   *
   * hover 模式的隐藏以它为前提：条刚出现（或刚被角落热区唤回）时用户还没看过它，
   * 立刻隐藏等于「永远看不到」—— 必须先 hover 到访一次、再离开，超时才隐藏。
   */
  let cursorArmed = false;
  /** 条 / 气泡的物理矩形（鼠标靠近判定用；窗口显隐、拖动后刷新） */
  let barRect: PhysicalRect | null = null;
  let popoverRect: PhysicalRect | null = null;
  /** hover 模式的唤回热区（工作区右下角；停靠定位后计算一次） */
  let revealZone: PhysicalRect | null = null;
  /** 气泡当前内容视图（渲染端切换 / 挂载时经 popover-view 事件上报） */
  let popoverView: WatchWidgetPopoverView = WATCH_WIDGET_POPOVER_VIEW.LIST;
  /** 最近一次成功拉取的热力板块快照（失败时保留旧值，气泡不闪空） */
  let heatBoards: WatchWidgetHeatmapBoard[] = [];
  /** 最近一次成功拉取的大盘指数快照（失败时保留旧值，气泡不闪空） */
  let indexRows: WatchWidgetIndexRow[] = [];
  /** 视图数据轮询定时器（undefined = 未在轮询） */
  let viewPollTimer: number | undefined;
  /** 光标轮询定时器 */
  let cursorTimer: number | undefined;
  /** 拖动落点记忆的防抖句柄 */
  let settleTimer: number | undefined;
  /** 当前轮询会话已拉取的视图（同一会话内切视图要立即换数据源，不等下一个 tick） */
  let fetchedView: WatchWidgetPopoverView | null = null;
  /** 最近一次光标在条 / 气泡内的时刻（hover 隐藏的计时基准） */
  let lastInsideAt = Date.now();
  /** 气泡跟随条拖动的节流时间戳（条拖动期间 onMoved 高频到达，只按间隔摆位） */
  let lastFollowAt = 0;
  /** 跨窗口事件订阅句柄 */
  const unlistens: UnlistenFn[] = [];

  // ---------- 快照推送 ----------

  /** 把当前快照推给条 / 气泡（两个窗口都不存在时跳过） */
  const pushLines = (): void => {
    if (!barWindow && !popoverWindow) return;
    void emit(WATCH_WIDGET_EVENTS.LINES, { rows: rows.value });
  };

  /** 把热力快照推给气泡窗口 */
  const pushHeatmap = (): void => {
    if (!popoverWindow) return;
    void emit(WATCH_WIDGET_EVENTS.HEATMAP, { boards: heatBoards });
  };

  /** 把大盘指数快照推给气泡窗口 */
  const pushIndexes = (): void => {
    if (!popoverWindow) return;
    void emit(WATCH_WIDGET_EVENTS.INDEXES, { indexes: indexRows });
  };

  // ---------- 气泡热力 / 大盘视图（数据走 app:market 可选消费） ----------

  /**
   * 造大盘指数行：点位 / 涨跌幅文案与涨跌语气全部走宿主 `app:format`
   * （口径只有宿主一份，与候选列表行同构；上游缺失条目按空态留给渲染端兜底）
   * @param quotes 宿主 `app:market.fetchIndexQuotes()` 返回的原始指数快照，
   *   数组顺序即气泡里的展示顺序（本函数不重排、不过滤，上游给几条就渲染几条）
   * @returns 与 `quotes` 一一对应的指数行：点位 / 涨跌幅已是宿主口径的成品文案
   *   （上游没给报价时落 `--`），`tone` 只表涨跌语气 —— 载荷不带色值，
   *   换主题时气泡不必重新拉数，跟着宿主主题走即可
   */
  const buildIndexRows = (quotes: readonly MarketIndexQuote[]): WatchWidgetIndexRow[] =>
    quotes.map((quote) => {
      const changePercent = quote.changePercent;
      return {
        code: quote.code,
        name: quote.name,
        price: format.price(quote.price),
        percent: format.percent(changePercent),
        tone: WATCH_MARQUEE_TONE_BY_TREND[format.trend(changePercent ?? 0)],
      };
    });

  /** 拉一次大盘指数快照（东财 ulist 单次请求）→ 归一为载荷并推送 */
  const fetchIndexes = async (): Promise<void> => {
    if (!market) return;
    try {
      const quotes = await market.fetchIndexQuotes();
      indexRows = buildIndexRows(quotes);
      pushIndexes();
    } catch (error) {
      logger.warn(`大盘指数拉取失败（气泡保留旧数据）：${String(error)}`);
    }
  };

  /** 拉一次行业板块 → 按总市值取 Top N → 归一为热力载荷并推送 */
  const fetchHeatmap = async (): Promise<void> => {
    if (!market) return;
    try {
      const boards = await market.fetchIndustryBoards();
      heatBoards = boards
        .filter((board) => board.changePercent !== null && board.totalMarketCap !== null)
        .sort((a, b) => (b.totalMarketCap ?? 0) - (a.totalMarketCap ?? 0))
        .slice(0, WATCH_WIDGET_POPOVER_HEATMAP_TOP_N)
        .map((board) => ({
          name: board.name,
          changePercent: board.changePercent ?? 0,
          totalMarketCap: board.totalMarketCap ?? 0,
        }));
      pushHeatmap();
    } catch (error) {
      logger.warn(`板块热力拉取失败（气泡保留旧数据）：${String(error)}`);
    }
  };

  /**
   * 按当前气泡视图拉取对应数据（轮询定时器回调 / 展开即拉共用）
   * @param view 要拉数据的视图：只有热力（`HEATMAP`）与大盘（`MARKET`）有外部数据源，
   *   列表视图（`LIST`）用的是引擎已推过的候选行，传进来等于空转 —— 上层 `syncViewPolling`
   *   的门控已经把它挡在轮询之外
   */
  const fetchForView = (view: WatchWidgetPopoverView): void => {
    if (view === WATCH_WIDGET_POPOVER_VIEW.HEATMAP) safe(fetchHeatmap());
    else if (view === WATCH_WIDGET_POPOVER_VIEW.MARKET) safe(fetchIndexes());
  };

  /**
   * 轮询门控：仅「气泡展开 && 热力 / 大盘视图激活 && 宿主有 app:market」时运行。
   * 气泡收起、切回列表、插件销毁都会停表，不给上游留常驻请求。
   * 同一会话内热力 ⇄ 大盘互切：定时器不重建，但立即拉一次新视图的数据
   * （否则要等下一个 30s tick 才有数据，切换瞬间气泡还挂着上一个视图的旧内容）。
   */
  const syncViewPolling = (): void => {
    const shouldPoll =
      popoverVisible &&
      popoverWindow !== null &&
      market !== undefined &&
      (popoverView === WATCH_WIDGET_POPOVER_VIEW.HEATMAP ||
        popoverView === WATCH_WIDGET_POPOVER_VIEW.MARKET);
    if (shouldPoll && viewPollTimer === undefined) {
      fetchedView = popoverView;
      fetchForView(popoverView);
      viewPollTimer = window.setInterval(() => fetchForView(popoverView), VIEW_POLL_MS);
    } else if (shouldPoll && popoverView !== fetchedView) {
      fetchedView = popoverView;
      fetchForView(popoverView);
    } else if (!shouldPoll && viewPollTimer !== undefined) {
      window.clearInterval(viewPollTimer);
      viewPollTimer = undefined;
      fetchedView = null;
    }
  };

  // ---------- 气泡（单例窗口，隐藏复用） ----------
  const showPopover = async (): Promise<void> => {
    if (!barWindow) return;
    if (!popoverWindow) popoverWindow = await openPopoverWindow();
    if (!popoverWindow) return;
    await positionPopover(popoverWindow, barWindow, rows.value.length, popoverView);
    popoverRect = await getWindowRect(popoverWindow);
    await popoverWindow.show().catch(() => undefined);
    popoverVisible = true;
    syncViewPolling();
  };

  const hidePopover = async (): Promise<void> => {
    if (!popoverWindow || !popoverVisible) return;
    await popoverWindow.hide().catch(() => undefined);
    popoverVisible = false;
    syncViewPolling();
  };

  const togglePopover = async (): Promise<void> => {
    if (popoverVisible) await hidePopover();
    else await showPopover();
  };

  // ---------- 盯盘条（设置开关驱动生灭） ----------
  const destroyWindows = async (): Promise<void> => {
    await hidePopover();
    if (popoverWindow) {
      void popoverWindow.close().catch(() => undefined);
      popoverWindow = null;
      popoverVisible = false;
      popoverRect = null;
    }
    if (barWindow) {
      void barWindow.close().catch(() => undefined);
      barWindow = null;
      barVisible = false;
      barRect = null;
      revealZone = null;
    }
    syncViewPolling();
  };

  const ensureBar = async (): Promise<void> => {
    // 旧包可能比我们晚挂载：建窗前再查一次，命中就让位（两次判定覆盖两种时序）
    if (legacyWidgetInstalled(runtime)) {
      logger.warn(
        `检测到残留的旧独立包 ${LEGACY_WATCH_WIDGET_PLUGIN_ID}（挂载晚于本插件），`
        + '任务栏小组件停止建窗：请在插件工坊卸载它',
      );
      notify?.notify({
        title: LEGACY_CONFLICT_TITLE,
        body: LEGACY_CONFLICT_BODY,
        tone: NOTIFY_TONE.DOWN,
        source: WATCH_WIDGET_NOTIFY_SOURCE,
        dedupeKey: WATCH_WIDGET_NOTIFY_SOURCE,
      });
      return;
    }
    if (barWindow) {
      await barWindow.show().catch(() => undefined);
      barVisible = true;
      return;
    }
    barWindow = await openBarWindow(config.value.position);
    if (!barWindow) {
      // 创建失败必须让用户看见（多为主窗口 capabilities 未重编译：重启应用即好）
      logger.warn('盯盘条创建失败（多为 capabilities 未重编译），请重启应用重试');
      notify?.notify({
        title: '任务栏小组件创建失败',
        body: '多为窗口权限未随构建生效：重启应用后重新开启即可',
        tone: NOTIFY_TONE.DOWN,
        source: WATCH_WIDGET_NOTIFY_SOURCE,
        dedupeKey: WATCH_WIDGET_NOTIFY_SOURCE,
      });
      return;
    }
    barVisible = true;
    cursorArmed = false;
    barRect = await getWindowRect(barWindow);
    // 唤回热区 = 工作区右下角（拖动过条也按此角落唤回，规则可预期）
    try {
      const area = await getWorkArea();
      revealZone = {
        x: area.right - WATCH_WIDGET_REVEAL_ZONE,
        y: area.bottom - WATCH_WIDGET_REVEAL_ZONE,
        width: WATCH_WIDGET_REVEAL_ZONE,
        height: WATCH_WIDGET_REVEAL_ZONE,
      };
    } catch {
      revealZone = null;
    }
    pushLines();
  };

  /** 三态电源 → 条是否应显示（智能态叠加盘中判定；tick 每分钟重算，跨界自动隐现） */
  const shouldShowBar = computed(() => {
    const { power } = config.value;
    if (power === WATCH_WIDGET_POWER.OFF) return false;
    if (power === WATCH_WIDGET_POWER.ALWAYS) return true;
    // 智能开启：仅交易日盘中显示（盘前 / 盘后 / 非交易日自动隐藏）
    return marketStatus.isIntraday.value;
  });

  // ---------- 打开股票：唤起主窗口 + 经 app:stock-open 跳详情整页 ----------
  const openStockInMain = (symbol: string): void => {
    if (!symbol) return;
    safe(hidePopover());
    // 主窗口可能正最小化 / 隐藏在托盘：显示 → 还原 → 聚焦，一步都不能省
    const main = getCurrentWebviewWindow();
    void main
      .show()
      .then(() => main.unminimize())
      .then(() => main.setFocus())
      .catch(() => undefined);
    // 与顶栏盯盘下拉「跳详情页」同一套交互：左列 = 盯盘候选，宿主归一化符号并路由
    stockOpen.openPage(
      symbol,
      buildWatchContextList(candidates.value, monitor.quotes.value, format),
    );
  };

  // ---------- 卸载清理（先登记，再建任何外部资源：中途失败也不会漏清理） ----------
  onDispose(() => {
    if (cursorTimer !== undefined) window.clearInterval(cursorTimer);
    if (settleTimer) window.clearTimeout(settleTimer);
    if (viewPollTimer !== undefined) window.clearInterval(viewPollTimer);
    for (const unlisten of unlistens) unlisten();
    void destroyWindows().catch(() => undefined);
  });

  try {
    // 引擎轮询驱动推送（约数秒一次，量级极小，无需防抖）
    effect(() => watch(rows, pushLines, { immediate: true }));

    // ---------- 主题实时同步（明暗 / 主题色 / 涨跌配色） ----------
    /**
     * 主窗口主题三要素变化即广播给条 / 气泡。
     * 不依赖 storage 事件：WebView2 跨窗口 storage 事件实测不可达，
     * 主题跟随与行情数据共用同一条已验证的事件通道。
     */
    effect(() =>
      watch(
        [theme.isDark, theme.themeColor, theme.trendTheme],
        ([dark, color, trend]) => {
          if (!barWindow && !popoverWindow) return;
          void emit(WATCH_WIDGET_EVENTS.THEME, { dark, theme: color, trend });
        },
        { immediate: true },
      ),
    );

    effect(() =>
      watch(
        shouldShowBar,
        (show) => {
          if (show) safe(ensureBar());
          else safe(destroyWindows());
        },
        { immediate: true },
      ),
    );

    // hover 模式被隐藏后，用户把模式切回「一直显示」要立刻露出来 ——
    // 否则 shouldShowBar 没变化，条会一直藏到下一次重启
    effect(() =>
      watch(
        () => config.value.mode,
        (mode) => {
          if (mode === WATCH_WIDGET_MODE.ALWAYS && shouldShowBar.value) safe(ensureBar());
        },
      ),
    );

    // ---------- 跨窗口事件（小组件窗口只有事件通道，没有别的宿主上下文） ----------
    unlistens.push(
      await listen(WATCH_WIDGET_EVENTS.REQUEST, () => {
        pushLines();
        pushHeatmap();
        pushIndexes();
      }),
    );
    unlistens.push(
      await listen<WatchWidgetPopoverViewPayload>(WATCH_WIDGET_EVENTS.POPOVER_VIEW, (event) => {
        const view = event.payload?.view;
        const isValid =
          view === WATCH_WIDGET_POPOVER_VIEW.LIST ||
          view === WATCH_WIDGET_POPOVER_VIEW.HEATMAP ||
          view === WATCH_WIDGET_POPOVER_VIEW.MARKET;
        if (!isValid) return;
        popoverView = view;
        syncViewPolling();
        // 展开中按新视图重算尺寸（三视图互切会改变窗口高度与落点）
        const popover = popoverWindow;
        const bar = barWindow;
        if (popoverVisible && popover && bar) {
          safe(
            positionPopover(popover, bar, rows.value.length, view).then(() =>
              getWindowRect(popover).then((rect) => {
                popoverRect = rect;
              }),
            ),
          );
        }
      }),
    );
    unlistens.push(
      await listen(WATCH_WIDGET_EVENTS.POPOVER_TOGGLE, () => {
        safe(togglePopover());
      }),
    );
    unlistens.push(
      await listen<{ x: number; y: number }>(WATCH_WIDGET_EVENTS.BAR_MOVED, (event) => {
        // 条矩形同步刷新供鼠标判定（查询异步，不阻塞跟随）
        if (barWindow) {
          void getWindowRect(barWindow).then((rect) => {
            barRect = rect;
          });
        }
        // 气泡跟随：展开态下按节流间隔平移贴回条正上方（只平移不改尺寸，避免闪烁）
        const now = Date.now();
        const popoverLive = popoverWindow;
        const barLive = barWindow;
        if (
          popoverVisible &&
          popoverLive &&
          barLive &&
          now - lastFollowAt >= WATCH_WIDGET_POPOVER_FOLLOW_INTERVAL_MS
        ) {
          lastFollowAt = now;
          safe(
            movePopoverToBar(popoverLive, barLive, rows.value.length, popoverView).then(() =>
              getWindowRect(popoverLive).then((rect) => {
                popoverRect = rect;
              }),
            ),
          );
        }
        // 拖动落点：超过 SETTLE 窗口无新位置视为拖完，记忆位置 + 精确校正一次
        // （节流可能让最后一次跟随错过落点；positionPopover 含尺寸兜底）
        if (settleTimer) window.clearTimeout(settleTimer);
        settleTimer = window.setTimeout(() => {
          settleTimer = undefined;
          rememberBarPosition(settings, { x: event.payload.x, y: event.payload.y });
          const popover = popoverWindow;
          const bar = barWindow;
          if (popoverVisible && popover && bar) {
            safe(
              positionPopover(popover, bar, rows.value.length, popoverView).then(() =>
                getWindowRect(popover).then((rect) => {
                  popoverRect = rect;
                }),
              ),
            );
          }
        }, WATCH_WIDGET_MOVE_SETTLE_MS);
      }),
    );
    unlistens.push(
      await listen<{ symbol: string }>(WATCH_WIDGET_EVENTS.OPEN_STOCK, (event) => {
        openStockInMain(event.payload.symbol);
      }),
    );

    // ---------- 摸鱼显隐（hover 模式：离开超时隐藏，角落热区唤回） ----------
    cursorTimer = window.setInterval(() => {
      if (!barWindow) return;
      void (async () => {
        let cursor: PhysicalPosition;
        try {
          cursor = await cursorPosition();
        } catch {
          return; // 光标查询失败（会话切换等）静默跳过本轮
        }
        const inside =
          rectContains(barRect, cursor.x, cursor.y, 4)
          || rectContains(popoverRect, cursor.x, cursor.y, 4);
        if (inside) {
          lastInsideAt = Date.now();
          cursorArmed = true;
          return;
        }
        // 条已隐藏：鼠标进入右下角热区 → 唤回（任何模式一致，规则可预期）
        if (!barVisible && revealZone && rectContains(revealZone, cursor.x, cursor.y)) {
          await barWindow.show().catch(() => undefined);
          barVisible = true;
          cursorArmed = false; // 唤回后同样等用户真正到访过才允许再隐藏
          lastInsideAt = Date.now();
          return;
        }
        // hover 模式：到访过、又离开超过延迟秒数 → 条与气泡一起隐藏（always 模式条常驻）。
        // 气泡自身**不单独自动收起**：展开后只有「收起」按钮或再次单击条（toggle）
        // 才会隐藏 —— hover 模式下条整体隐藏时才连带气泡一起走。
        const { mode, hideDelaySec } = config.value;
        if (
          barVisible &&
          cursorArmed &&
          mode === WATCH_WIDGET_MODE.HOVER &&
          Date.now() - lastInsideAt >= hideDelaySec * 1000
        ) {
          await barWindow.hide().catch(() => undefined);
          barVisible = false;
          cursorArmed = false;
          await hidePopover();
        }
      })();
    }, WATCH_WIDGET_CURSOR_POLL_MS);

    logger.info(
      `任务栏小组件就绪（条 ${WATCH_WIDGET_BAR_WIDTH}×${WATCH_WIDGET_BAR_HEIGHT}、`
      + `气泡宽 ${WATCH_WIDGET_POPOVER_WIDTH}，电源 ${config.value.power}、显示模式 ${config.value.mode}）`,
    );
  } catch (error) {
    // 最后 1% 的意外也吞在这里：小组件是可选子系统，失败只允许出现在日志里
    logger.warn(`任务栏小组件挂载中断（已忽略，盯盘主体不受影响）：${String(error)}`);
  }
};
