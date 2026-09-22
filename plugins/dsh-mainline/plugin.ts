/**
 * 插件 dsh-mainline（股票主线）
 *
 * 左侧导航新增「股票主线」页面：把「板块抱团主线」从主观感觉变成状态判定 ——
 * 一线四阶段（萌芽 / 确认 / 狂热 / 瓦解）+ 原始指标面板（成交占比分位、量能倍数、
 * 价格分位），口径参考本地技能 `a-share-huddle-mainline`，数据源换成本应用可直连的
 * 同花顺板块日 K + 腾讯沪深成交额。
 *
 * 硬约束（技能三条铁律，界面已落实）：
 * 1. 只输出阶段标签与风险提示，不出现任何买卖 / 仓位指令；
 * 2. 只有价格上涨、没有业绩验证不判「确认抱团」——「确认」仅代表量价与拥挤度特征，
 *    风险提示里明写「需连续两季业绩验证」；
 * 3. 原始指标面板与自动标签**同时展示**，并列出本期未接入的输入。
 *
 * 数据落地：`ctx.db` 两张插件表（`board_history` / `scan_meta`），
 * 扫描一次后重进页面只读库重算，不联网；重接口只在用户点击时触发。
 */
import MainlineBoardView from './MainlineBoardView.vue';
import {
  MAINLINE_MENU_ICON,
  MAINLINE_MENU_PATH,
  MAINLINE_MENU_TITLE,
  MAINLINE_PLUGIN_ID,
} from './constants';
import { createMainlineRepo } from './storage';
import type { MainlineDeps } from './types';
import type { PluginDefinition } from '../../host/types/plugin.types';

/**
 * 股票主线插件定义
 */
export const mainlinePlugin: PluginDefinition = {
  id: MAINLINE_PLUGIN_ID,
  name: '股票主线',
  version: '1.0.0',
  description:
    '左侧导航新增「股票主线」看板：同花顺行业板块成交占比分位 / 量能倍数 / 价格分位 → 抱团主线四阶段（萌芽·确认·狂热·瓦解）判定，只给阶段与风险提示，不含买卖指令。',
  author: '内置',
  apply: async (ctx) => {
    // 宿主能力一次性取齐后沿调用链注入 —— 单文件产物形态下没有 import 可用，
    // 所有宿主依赖只能从 ctx 上来（`MainlineDeps` 就是这条依赖链的显式声明）
    const http = ctx.consume('app:http');
    const format = ctx.consume('app:format');
    const market = ctx.consume('app:market');
    const ui = ctx.consume('app:ui');
    if (!http || !format || !market || !ui) {
      throw new Error('宿主未提供 app:http / app:format / app:market / app:ui 服务');
    }
    const deps: MainlineDeps = { http, format, market, ui };

    // 建表 + 水合快照完成后才注册页面（页面首屏即可直接读库渲染）
    const repo = await createMainlineRepo(ctx.db);

    // 能力对外公开：其他插件 consume('mainline:repo') 即可读同一份快照
    ctx.provide('mainline:repo', repo);

    ctx.menu.add({
      path: MAINLINE_MENU_PATH,
      title: MAINLINE_MENU_TITLE,
      icon: MAINLINE_MENU_ICON,
      component: MainlineBoardView,
      props: { repo, deps },
    });

    ctx.logger.info('已注册「股票主线」导航项与看板页面');
  },
};

/**
 * 打包用的默认导出
 *
 * 内置挂载走上面的具名导出（`src/plugins/index.ts`），而**产物包**的安装链路读的是
 * 模块的默认导出（见 `user-plugin-loader.ts`：`mod.default ?? mod.plugin`）——
 * 这里补一个 default，同一个定义就能同时满足两条链路。
 */
export default mainlinePlugin;
