/**
 * 插件 dsh-quick-note · 速记
 *
 * 这个插件把插件体系里除「贡献点」之外的四件事一次性演示完整：
 * - **通用数据层**：`ctx.db` 在本插件独立表 `plugin_dsh_quick_note_notes` 里存速记
 *   （Tauri 端 SQLite / 浏览器端本地仿真），插件永不直接写 SQL；
 * - **服务贡献**：`ctx.provide('note:repo', …)`，其他插件可 `consume` 复用；
 * - **事件**：保存后广播 `note:saved`（插件之间不互相 import 也能协作）；
 * - **命令 + 宿主服务**：快捷键经 `panel:open` 服务唤醒自己的面板。
 */
import QuickNotePanel from './QuickNotePanel.vue';
import StockNotesSection from './StockNotesSection.vue';
import { createQuickNoteRepo } from './service';
import type { PluginDefinition } from '../../host/types/plugin.types';
import type { QuickNoteDeps } from './types';

/** 该插件注册的面板 id */
export const QUICK_NOTE_PANEL_ID = 'notes';

/** 面板全局键（`<pluginId>#<panelId>`，命令经 `panel:open` 唤醒它） */
export const QUICK_NOTE_PANEL_KEY = `dsh-quick-note#${QUICK_NOTE_PANEL_ID}`;

/**
 * 速记插件定义
 */
export const quickNotePlugin: PluginDefinition = {
  id: 'dsh-quick-note',
  name: '速记',
  version: '1.1.0',
  description:
    '左侧栏底部新增「速记」入口（抽屉形态）：随手记一条，随写随存，可关联一只股票（宿主选股弹窗），关联后的速记展示在该股的个股详情里；对外提供 note:repo 服务与 note:saved 事件供其他插件复用。',
  author: '内置',
  apply: async (ctx) => {
    // 宿主能力一次性取齐后沿调用链注入 —— 单文件产物形态下没有 import 可用，
    // 所有宿主依赖只能从 ctx 上来（`QuickNoteDeps` 就是这条依赖链的显式声明）
    const ui = ctx.consume('app:ui');
    const format = ctx.consume('app:format');
    const stockOpen = ctx.consume('app:stock-open');
    const stockPicker = ctx.consume('app:stock-picker');
    const watchlist = ctx.consume('app:watchlist');
    const quotes = ctx.consume('app:quotes');
    const closePanel = ctx.consume('panel:close');
    if (!ui || !format || !stockOpen || !stockPicker || !watchlist || !quotes || !closePanel) {
      throw new Error(
        '宿主未提供 app:ui / app:format / app:stock-open / app:stock-picker / app:watchlist / app:quotes / panel:close 服务',
      );
    }
    const deps: QuickNoteDeps = {
      ui,
      format,
      stockOpen,
      stockPicker,
      watchlist,
      quotes,
      closePanel,
    };

    // 建表 + 水合 + 旧数据迁移完成后才对外暴露服务（内核会等待异步 apply 完成）
    const repo = await createQuickNoteRepo(ctx.db, ctx.storage, (note) => {
      ctx.emit('note:saved', note);
    });

    // 能力对外公开：其他插件 consume('note:repo') 即可读写同一份速记
    ctx.provide('note:repo', repo);

    ctx.sidebar.add({
      id: QUICK_NOTE_PANEL_ID,
      title: '速记',
      icon: 'pencil',
      // 编辑类内容需要宽度：侧栏只放入口，内容在右侧抽屉展开
      mode: 'drawer',
      position: 'footer',
      order: 10,
      component: QuickNotePanel,
      props: { repo, deps, panelKey: QUICK_NOTE_PANEL_KEY },
    });

    // 个股详情扩展区：在该股的详情面板里展示 / 追加关联速记（宿主只传 symbol）
    ctx.stockDetail.add({
      id: 'stock-notes',
      title: '速记',
      component: StockNotesSection,
      props: { repo, deps },
    });

    ctx.command.add({
      id: 'open',
      title: '打开速记',
      keys: 'Ctrl+Alt+N',
      run: () => {
        ctx.consume('panel:open')?.(QUICK_NOTE_PANEL_KEY);
      },
    });

    ctx.logger.info('已注册抽屉面板、个股详情速记扩展区、note:repo 服务与 1 条命令');
  },
};

/**
 * 打包用的默认导出
 *
 * 内置挂载走上面的具名导出（`src/plugins/index.ts`），而**产物包**的安装链路读的是
 * 模块的默认导出（见 `user-plugin-loader.ts`：`mod.default ?? mod.plugin`）——
 * 这里补一个 default，同一个定义就能同时满足两条链路。
 */
export default quickNotePlugin;
