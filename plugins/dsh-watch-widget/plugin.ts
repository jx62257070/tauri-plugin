/**
 * 插件 dsh-watch-widget · 任务栏盯盘小组件
 *
 * 把顶栏「自选盯盘」的轮播内容常驻成 **Windows 任务栏上方的置顶迷你条**
 * （摸鱼场景：上班时不开炒股软件也能一眼扫到自选盯盘标的）。架构上三件事：
 *
 * - **数据零冗余**：本插件不发任何上游请求。声明 `inject: ['watch:repo', 'watch:monitor']`
 *   等盯盘插件就绪后消费**同一份引擎实例**的报价快照（第二份引擎会导致上游请求
 *   翻倍 + 阈值 armed 状态双写，见 dsh-sidebar-watch/monitor.ts）；
 *   快照经 Tauri 事件 `watch-widget://lines` 推给小组件窗口，窗口是纯渲染端
 *   （渲染端是宿主 `src/widget/` 独立轻量入口，不属于本插件产物）。
 * - **宿主能力全走服务**：配置（`app:watch-widget-settings`，UI 与持久化归宿主
 *   设置页）、盘中判定（`app:market-status`）、主题（`app:theme`）、自选股
 *   （`app:watchlist`）、打开个股（`app:stock-open`）、格式化（`app:format`）、
 *   浮窗（`app:notify`，可降级）。窗口 API 经 @tauri-apps/api 打进本产物。
 * - **摸鱼交互**：条与气泡都 `focusable: false`（点击不抢工作窗口焦点）；
 *   hover 模式下鼠标离开自动隐藏、移到屏幕右下角热区唤回；
 *   单击条展开气泡看全部候选，点气泡标的 / 双击条上标的 → 唤起主窗口并跳
 *   股票详情整页（左侧列表 = 盯盘候选，经 app:stock-open 携带上下文）。
 */
import { computed, watch } from 'vue';
import { isTauri } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { cursorPosition } from '@tauri-apps/api/window';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { PhysicalPosition } from '@tauri-apps/api/dpi';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { WATCH_WIDGET_MODE, WATCH_WIDGET_POWER } from '../../host/constants/watch-widget.constants';
import { NOTIFY_TONE } from '../../host/constants/notify.constants';
import { filterCandidatesByWatchlist } from '../dsh-sidebar-watch/candidates';
import { WATCH_MARQUEE_TONE_BY_TREND } from '../dsh-sidebar-watch/constants';
import {
  WATCH_WIDGET_BAR_HEIGHT,
  WATCH_WIDGET_BAR_WIDTH,
  WATCH_WIDGET_CURSOR_POLL_MS,
  WATCH_WIDGET_EVENTS,
  WATCH_WIDGET_MOVE_SETTLE_MS,
  WATCH_WIDGET_NOTIFY_SOURCE,
  WATCH_WIDGET_POPOVER_FOLLOW_INTERVAL_MS,
  WATCH_WIDGET_POPOVER_HEATMAP_TOP_N,
  WATCH_WIDGET_POPOVER_VIEW,
  WATCH_WIDGET_POPOVER_WIDTH,
  WATCH_WIDGET_REVEAL_ZONE,
} from '../../host/plugins/watch-widget/constants';
import type {
  WatchWidgetHeatmapBoard,
  WatchWidgetIndexRow,
  WatchWidgetPopoverView,
  WatchWidgetPopoverViewPayload,
} from '../../host/types/watch-widget.types';
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
  PluginDefinition,
  MarketIndexQuote,
} from '../../host/types/plugin.types';

/** 必需宿主服务缺失时的统一报错文案 */
const MISSING_SERVICES_HINT =
  '宿主未提供 app:watchlist / app:stock-open / app:market-status / '
  + 'app:watch-widget-settings / app:theme / app:format 服务';

/** 气泡热力 / 大盘视图的轮询间隔（毫秒；与市场总览「市场宽度」轮询同频）。
 * 仅在「气泡展开 && 对应视图激活」期间运行，收起 / 切走即停 */
const VIEW_POLL_MS = 30_000;

/**
 * 任务栏盯盘小组件插件定义
 */
export const watchWidgetPlugin: PluginDefinition = {
  id: 'dsh-watch-widget',
  name: '任务栏盯盘小组件',
  version: '1.2.0',
  description:
    '在 Windows 任务栏上方常驻一个置顶盯盘迷你条（设置里三态选择，默认关：关闭 / 常驻 / 智能开启，智能开启仅交易日盘中显示）：轮播自选盯盘标的的名称 / 现价 / 涨跌幅，阈值触发带提示点；单击迷你条展开气泡看全部候选，头部图标在「自选盯盘 → 板块热力 → 大盘走势（上证 / 深证 / 创业板指 / 恒生）」间循环切换，均仅展示无交互；点气泡里的标的（或双击迷你条当前标的）自动唤起主窗口并打开该股详情页（左侧列表即盯盘候选）。支持常驻显示 / 鼠标离开自动隐藏两种模式；仅桌面端，热力与指数数据由宿主 app:market 服务在对应视图激活期间低频拉取，迷你条自身不产生任何行情请求。',
  author: '内置',
  inject: ['watch:repo', 'watch:monitor'],
  apply: async (ctx) => {
    // 浏览器端无窗口概念，整个插件静默跳过（设置卡片会提示仅桌面端可用）
    if (!isTauri()) {
      ctx.logger.info('非 Tauri 环境，任务栏小组件不挂载');
      return;
    }

    // inject 已保证 repo / monitor 就绪，仍兜底判空
    const repo = ctx.consume('watch:repo');
    const monitor = ctx.consume('watch:monitor');
    if (!repo || !monitor) {
      ctx.logger.warn('盯盘服务未就绪，任务栏小组件跳过');
      return;
    }

    // 宿主能力一次性取齐：缺必需服务直接失败（内核回滚并记录，插件工坊可见）
    const watchlist = ctx.consume('app:watchlist');
    const stockOpen = ctx.consume('app:stock-open');
    const marketStatus = ctx.consume('app:market-status');
    const widgetSettings = ctx.consume('app:watch-widget-settings');
    const theme = ctx.consume('app:theme');
    const format = ctx.consume('app:format');
    if (
      !watchlist || !stockOpen || !marketStatus || !widgetSettings || !theme || !format
    ) {
      throw new Error(MISSING_SERVICES_HINT);
    }
    // 浮窗服务由宿主提供；缺失时降级为只记日志（与盯盘引擎同一处理）
    const notify = ctx.consume('app:notify');
    // 市场剖面服务**可选消费**（旧宿主无 app:market 时热力 / 大盘视图降级空态，不影响盯盘条）
    const market = ctx.consume('app:market');

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

    /** 把当前快照推给条 / 气泡（两个窗口都不存在时跳过） */
    const pushLines = (): void => {
      if (!barWindow && !popoverWindow) return;
      void emit(WATCH_WIDGET_EVENTS.LINES, { rows: rows.value });
    };

    // 引擎轮询驱动推送（约数秒一次，量级极小，无需防抖）
    ctx.effect(() => watch(rows, pushLines, { immediate: true }));

    // ---------- 主题实时同步（明暗 / 主题色 / 涨跌配色） ----------
    /**
     * 主窗口主题三要素变化即广播给条 / 气泡。
     * 不依赖 storage 事件：WebView2 跨窗口 storage 事件实测不可达，
     * 主题跟随与行情数据共用同一条已验证的事件通道。
     */
    ctx.effect(() =>
      watch(
        [theme.isDark, theme.themeColor, theme.trendTheme],
        ([dark, color, trend]) => {
          if (!barWindow && !popoverWindow) return;
          void emit(WATCH_WIDGET_EVENTS.THEME, { dark, theme: color, trend });
        },
        { immediate: true },
      ),
    );

    // ---------- 气泡热力 / 大盘视图（市场剖面迷你版，数据走 app:market 可选消费） ----------
    /** 气泡当前内容视图（渲染端切换 / 挂载时经 popover-view 事件上报） */
    let popoverView: WatchWidgetPopoverView = WATCH_WIDGET_POPOVER_VIEW.LIST;
    /** 最近一次成功拉取的热力板块快照（失败时保留旧值，气泡不闪空） */
    let heatBoards: WatchWidgetHeatmapBoard[] = [];
    /** 最近一次成功拉取的大盘指数快照（失败时保留旧值，气泡不闪空） */
    let indexRows: WatchWidgetIndexRow[] = [];
    /** 视图数据轮询定时器（undefined = 未在轮询） */
    let viewPollTimer: number | undefined;
    /** 当前轮询会话已拉取的视图（同一会话内切视图要立即换数据源，不等下一个 tick） */
    let fetchedView: WatchWidgetPopoverView | null = null;

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

    /**
     * 造大盘指数行：点位 / 涨跌幅文案与涨跌语气全部走宿主 `app:format`
     * （口径只有宿主一份，与候选列表行同构；上游缺失条目按空态留给渲染端兜底）
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
        ctx.logger.warn(`大盘指数拉取失败（气泡保留旧数据）：${String(error)}`);
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
        ctx.logger.warn(`板块热力拉取失败（气泡保留旧数据）：${String(error)}`);
      }
    };

    /** 按当前气泡视图拉取对应数据（轮询定时器回调 / 展开即拉共用） */
    const fetchForView = (view: WatchWidgetPopoverView): void => {
      if (view === WATCH_WIDGET_POPOVER_VIEW.HEATMAP) void fetchHeatmap();
      else if (view === WATCH_WIDGET_POPOVER_VIEW.MARKET) void fetchIndexes();
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
      if (popoverVisible) {
        await hidePopover();
      } else {
        await showPopover();
      }
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
      if (barWindow) {
        await barWindow.show().catch(() => undefined);
        barVisible = true;
        return;
      }
      barWindow = await openBarWindow(widgetSettings.settings.value.position);
      if (!barWindow) {
        // 创建失败必须让用户看见（多为主窗口 capabilities 未重编译：重启应用即好）
        ctx.logger.warn('盯盘条创建失败（多为 capabilities 未重编译），请重启应用重试');
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
      const power = widgetSettings.settings.value.power;
      if (power === WATCH_WIDGET_POWER.OFF) return false;
      if (power === WATCH_WIDGET_POWER.ALWAYS) return true;
      // 智能开启：仅交易日盘中显示（盘前 / 盘后 / 非交易日自动隐藏）
      return marketStatus.isIntraday.value;
    });

    ctx.effect(() =>
      watch(
        shouldShowBar,
        (show) => {
          if (show) void ensureBar();
          else void destroyWindows();
        },
        { immediate: true },
      ),
    );

    // ---------- 打开股票：唤起主窗口 + 经 app:stock-open 跳详情整页 ----------
    const openStockInMain = (symbol: string): void => {
      if (!symbol) return;
      void hidePopover();
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

    // ---------- 跨窗口事件（小组件窗口只有事件通道，没有别的宿主上下文） ----------
    const unlistens: UnlistenFn[] = [];
    /** 气泡跟随条拖动的节流时间戳（条拖动期间 onMoved 高频到达，只按间隔摆位） */
    let lastFollowAt = 0;
    /** 拖动落点记忆的防抖句柄（超过 SETTLE 窗口无新位置才落库 + 精确校正一次） */
    let settleTimer: number | undefined;
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
          void positionPopover(popover, bar, rows.value.length, view).then(() =>
            getWindowRect(popover).then((rect) => {
              popoverRect = rect;
            }),
          );
        }
      }),
    );
    unlistens.push(
      await listen(WATCH_WIDGET_EVENTS.POPOVER_TOGGLE, () => {
        void togglePopover();
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
          void movePopoverToBar(popoverLive, barLive, rows.value.length, popoverView).then(() =>
            getWindowRect(popoverLive).then((rect) => {
              popoverRect = rect;
            }),
          );
        }
        // 拖动落点：超过 SETTLE 窗口无新位置视为拖完，记忆位置 + 精确校正一次
        // （节流可能让最后一次跟随错过落点；positionPopover 含尺寸兜底）
        if (settleTimer) window.clearTimeout(settleTimer);
        settleTimer = window.setTimeout(() => {
          settleTimer = undefined;
          widgetSettings.set({ position: { x: event.payload.x, y: event.payload.y } });
          const popover = popoverWindow;
          const bar = barWindow;
          if (popoverVisible && popover && bar) {
            void positionPopover(popover, bar, rows.value.length, popoverView).then(() =>
              getWindowRect(popover).then((rect) => {
                popoverRect = rect;
              }),
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
    let lastInsideAt = Date.now();
    const cursorTimer = window.setInterval(() => {
      if (!barWindow) return;
      void (async () => {
        let cursor: PhysicalPosition;
        try {
          cursor = await cursorPosition();
        } catch {
          return; // 光标查询失败（会话切换等）静默跳过本轮
        }
        const inside =
          rectContains(barRect, cursor.x, cursor.y, 4) || rectContains(popoverRect, cursor.x, cursor.y, 4);
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
        const config = widgetSettings.settings.value;
        if (
          barVisible &&
          cursorArmed &&
          config.mode === WATCH_WIDGET_MODE.HOVER &&
          Date.now() - lastInsideAt >= config.hideDelaySec * 1000
        ) {
          await barWindow.hide().catch(() => undefined);
          barVisible = false;
          cursorArmed = false;
          await hidePopover();
        }
      })();
    }, WATCH_WIDGET_CURSOR_POLL_MS);

    ctx.onDispose(() => {
      window.clearInterval(cursorTimer);
      if (settleTimer) window.clearTimeout(settleTimer);
      if (viewPollTimer !== undefined) window.clearInterval(viewPollTimer);
      for (const unlisten of unlistens) unlisten();
      void destroyWindows();
    });

    ctx.logger.info(
      `任务栏小组件就绪（条 ${WATCH_WIDGET_BAR_WIDTH}×${WATCH_WIDGET_BAR_HEIGHT}、气泡宽 ${WATCH_WIDGET_POPOVER_WIDTH}，显示模式 ${widgetSettings.settings.value.mode}）`,
    );
  },
};

export default watchWidgetPlugin;
