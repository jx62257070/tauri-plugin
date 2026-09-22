/**
 * 插件 dsh-dividend-screen（股息筛选）
 *
 * 左侧导航新增「股息筛选」页面：市面股息排行的 TTM 口径只反映「过去派了多少」，
 * 本插件在同一张表上叠加**今年推算**——以今年中报 ÷ 去年中报的净利比作全年增长系数、
 * 保留去年分红率，推算「维持分红习惯下的今年股息率」。
 *
 * 数据落地：`ctx.db` 两张插件表（`screen_rows` / `scan_meta`），
 * 扫描一次后重进页面只读库渲染、零联网（避免重复查询触发上游限速）；
 * 重接口只在用户点击「扫描排行」时触发。
 */
import DividendColumnSettings from './DividendColumnSettings.vue';
import DividendScreenView from './DividendScreenView.vue';
import {
  DIVIDEND_MENU_ICON,
  DIVIDEND_MENU_PATH,
  DIVIDEND_MENU_TITLE,
  DIVIDEND_PLUGIN_ID,
} from './constants';
import { createDividendRepo } from './storage';
import type { PluginDefinition } from '../../host/types/plugin.types';
import type { DividendDeps } from './types';

/**
 * 股息筛选插件定义
 */
export const dividendScreenPlugin: PluginDefinition = {
  id: DIVIDEND_PLUGIN_ID,
  name: '股息筛选',
  version: '1.0.0',
  description:
    '左侧导航新增「股息筛选」看板：TTM 股息率排行（东财口径）+ 保留去年分红率、按中报净利增速推算今年股息率；结果落本地插件库，重进页面不联网。',
  author: '内置',
  settings: {
    title: '表格列配置',
    description: '控制结果表格显示哪些列、按什么顺序显示；改动对两个 tab 即时生效。',
    component: DividendColumnSettings,
  },
  apply: async (ctx) => {
    // 宿主能力一次性取齐后沿调用链注入 —— 单文件产物形态下没有 import 可用，
    // 所有宿主依赖只能从 ctx 上来（`DividendDeps` 就是这条依赖链的显式声明）
    const http = ctx.consume('app:http');
    const format = ctx.consume('app:format');
    const ui = ctx.consume('app:ui');
    const stockOpen = ctx.consume('app:stock-open');
    if (!http || !format || !ui || !stockOpen) {
      throw new Error('宿主未提供 app:http / app:format / app:ui / app:stock-open 服务');
    }
    const deps: DividendDeps = { http, format, ui, stockOpen };

    // 建表 + 水合快照完成后才注册页面（页面首屏即可直接读库渲染）
    const repo = await createDividendRepo(ctx.db);

    // 能力对外公开：其他插件 consume('dividend:repo') 即可读同一份快照
    ctx.provide('dividend:repo', repo);

    // 宿主通用搜索服务（自选 tab 搜个股加自选用）；服务缺席时页面自动隐藏搜索入口
    const stockSearch = ctx.consume('app:stock-search');

    ctx.menu.add({
      path: DIVIDEND_MENU_PATH,
      title: DIVIDEND_MENU_TITLE,
      icon: DIVIDEND_MENU_ICON,
      component: DividendScreenView,
      props: { repo, stockSearch, settings: ctx.settings, deps },
    });

    ctx.logger.info('已注册「股息筛选」导航项与看板页面');
  },
};

/**
 * 打包用的默认导出
 *
 * 内置挂载走上面的具名导出（`src/plugins/index.ts`），而**产物包**的安装链路读的是
 * 模块的默认导出（见 `user-plugin-loader.ts`：`mod.default ?? mod.plugin`）——
 * 这里补一个 default，同一个定义就能同时满足两条链路。
 */
export default dividendScreenPlugin;
