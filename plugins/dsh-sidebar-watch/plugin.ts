/**
 * 插件 dsh-sidebar-watch · 自选盯盘
 *
 * 入口在**应用顶栏右侧工具条**（`ctx.header`）：收起态是「铃铛图标 + 一条轮播」
 * （候选逐条轮播名称 / 现价 / 涨跌幅），点开才是完整清单 —— 盯盘要的是「一眼扫到」，
 * 不需要长期占着侧栏版面。
 *
 * 一个插件同时演示五件事：
 * - **通用数据层**：盯盘候选（含阈值规则）落在本插件独立表
 *   `plugin_dsh_sidebar_watch_watch_candidates`（`ctx.db`，Tauri 端 SQLite / 浏览器端本地仿真），
 *   插件永不直接写 SQL；
 * - **顶栏贡献**：`ctx.header` 把入口挂到顶栏，并贡献收起态的轮播数据源；
 * - **行操作贡献**：`ctx.stockRow` 往自选股表格「操作」列注入「盯盘」开关按钮，
 *   宿主不硬编码本插件（只按注册表渲染图标 / 文案 / 激活态）；
 * - **服务贡献**：`ctx.provide('watch:repo', …)`，其他插件可复用同一份候选池；
 * - **宿主服务消费**：`ctx.consume('app:notify')` 弹右侧浮窗，做阈值到价提醒。
 *
 * 盯盘引擎（取报价 + 判阈值 + 弹提醒）跑在插件层而不是面板组件里，
 * 所以下拉收起、切页面都不影响提醒（见 monitor.ts 的说明）。
 * 卸载插件时，顶栏条目 / 行操作按钮 / 命令 / 服务 / 引擎一起消失，宿主代码零改动。
 *
 * 关于插件 id：入口从侧栏搬到顶栏后 id 仍是 `dsh-sidebar-watch`（名字里的 sidebar 已过时）——
 * **故意不改**：插件 id 是数据表名与存储命名空间的一部分，改 id 等于让用户
 * 已积累的盯盘候选与阈值一夜清空。改名的收益只是字面好看，代价是丢数据，不值得。
 */
import WatchHeaderPanel from './WatchHeaderPanel.vue';
import { createWatchCandidateRepo } from './service';
import { createWatchMonitor } from './monitor';
import { buildMarqueeLines } from './marquee';
import { filterCandidatesByWatchlist } from './candidates';
import {
  STOCK_ROW_ACTION_ACTIVE_TITLE,
  STOCK_ROW_ACTION_ICON,
  STOCK_ROW_ACTION_ID,
  STOCK_ROW_ACTION_TITLE,
  WATCH_HEADER_ITEM_ICON,
  WATCH_HEADER_ITEM_ID,
  WATCH_HEADER_ITEM_TITLE,
  WATCHLIST_ROUTE_PATH,
} from './constants';
import type { PluginDefinition } from '../../host/types/plugin.types';
import type { WatchDeps } from './types';

/** 顶栏条目全局键（`<pluginId>#<itemId>`，点完收起下拉时经 `panel:close` 用） */
const WATCH_HEADER_PANEL_KEY = `dsh-sidebar-watch#${WATCH_HEADER_ITEM_ID}`;

/**
 * 自选盯盘插件定义
 */
export const sidebarWatchPlugin: PluginDefinition = {
  id: 'dsh-sidebar-watch',
  name: '自选盯盘',
  version: '1.4.0',
  description:
    '顶栏常驻盯盘入口：收起态单条轮播候选的名称 / 现价 / 涨跌幅，点开是完整清单。在自选股「操作」列点「盯盘」逐只加入候选（候选与阈值存在插件自己的数据表里），可给每只票设价格 / 涨跌幅阈值，到价在右下角弹提醒；另附「打开自选股页」全局快捷键。',
  author: '内置',
  apply: async (ctx) => {
    // 宿主能力一次性取齐后沿调用链注入 —— 单文件产物形态下没有 import 可用，
    // 所有宿主依赖只能从 ctx 上来（`WatchDeps` 就是这条依赖链的显式声明）
    const ui = ctx.consume('app:ui');
    const format = ctx.consume('app:format');
    const quotes = ctx.consume('app:quotes');
    const polling = ctx.consume('app:polling');
    const stockOpen = ctx.consume('app:stock-open');
    const watchlist = ctx.consume('app:watchlist');
    const navigate = ctx.consume('app:navigate');
    const closePanel = ctx.consume('panel:close');
    if (!ui || !format || !quotes || !polling || !stockOpen || !watchlist || !navigate || !closePanel) {
      throw new Error(
        '宿主未提供 app:ui / app:format / app:quotes / app:polling / app:stock-open / app:watchlist / app:navigate / panel:close 服务',
      );
    }
    // 浮窗服务由宿主提供；缺失时不阻断插件（引擎会降级为只记日志）
    const notify = ctx.consume('app:notify');
    if (!notify) {
      ctx.logger.warn('宿主未提供 app:notify 服务，阈值提醒只在日志里体现');
    }
    const deps: WatchDeps = {
      ui,
      format,
      quotes,
      polling,
      stockOpen,
      watchlist,
      notify,
      navigate,
      closePanel,
    };

    // 建表 + 水合完成后才注册贡献点：顶栏轮播与行操作按钮都依赖仓储已就绪
    const repo = await createWatchCandidateRepo(ctx.db);

    // 能力对外公开：其他插件 consume('watch:repo') 即可读写同一份候选池
    ctx.provide('watch:repo', repo);

    const monitor = createWatchMonitor({ repo, logger: ctx.logger, deps });
    // 引擎不在组件里，生命周期挂在插件上：卸载即停轮询、并清掉自己弹过的浮窗
    ctx.onDispose(() => monitor.stop());
    // 引擎同样对外公开（1.4.0 起）：dsh-watch-widget 等消费方读同一份报价快照，
    // 小组件不会自建第二份轮询
    ctx.provide('watch:monitor', monitor);

    ctx.header.add({
      id: WATCH_HEADER_ITEM_ID,
      title: WATCH_HEADER_ITEM_TITLE,
      icon: WATCH_HEADER_ITEM_ICON,
      component: WatchHeaderPanel,
      props: { repo, monitor, deps, panelKey: WATCH_HEADER_PANEL_KEY },
      // 轮播数据源：读的与面板同一份快照，因此下拉收起时轮播照常刷新。
      // 在宿主 computed 内求值 —— repo.list() / monitor.quotes 都是响应式的，报价一到就重算
      marquee: () =>
        buildMarqueeLines(
          filterCandidatesByWatchlist(repo.list(), deps.watchlist.symbols()),
          monitor.quotes.value,
          deps.format,
        ),
    });

    // 自选股表格「操作」列的「盯盘」开关（开关型动作：未加入 = 加入，已加入 = 移出）
    ctx.stockRow.add({
      id: STOCK_ROW_ACTION_ID,
      title: STOCK_ROW_ACTION_TITLE,
      activeTitle: STOCK_ROW_ACTION_ACTIVE_TITLE,
      icon: STOCK_ROW_ACTION_ICON,
      isActive: (row) => repo.has(row.symbol),
      run: (row) => {
        repo.toggle(row.symbol, row.name);
      },
    });

    ctx.command.add({
      id: 'open-watchlist',
      title: '打开自选股页',
      keys: 'Ctrl+Alt+W',
      run: () => {
        // 命令不在组件上下文里，拿不到 router，故走宿主提供的导航服务
        deps.navigate(WATCHLIST_ROUTE_PATH);
      },
    });

    ctx.logger.info('已注册顶栏条目（含轮播）、行操作、watch:repo 服务、盯盘引擎与 1 条命令');
  },
};

/**
 * 打包用的默认导出
 *
 * 内置挂载走上面的具名导出（`src/plugins/index.ts`），而**产物包**的安装链路读的是
 * 模块的默认导出（见 `user-plugin-loader.ts`：`mod.default ?? mod.plugin`）——
 * 这里补一个 default，同一个定义就能同时满足两条链路。
 */
export default sidebarWatchPlugin;
