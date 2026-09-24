/**
 * 插件 dsh-sidebar-watch · 小组件窗口管理
 *
 * 两个无边框置顶窗口（盯盘条 / 气泡）的创建、停靠定位与尺寸计算。
 * 这些函数只在**主窗口侧**调用：窗口操控类权限挂在主窗口的 capability 上，
 * 小组件窗口自身只保留「事件收发 + 条窗口拖拽」的最小权限。
 *
 * 坐标系约定：Tauri 的窗口构造 x / y、outerPosition / outerSize、cursorPosition
 * 与 Rust 侧 SPI_GETWORKAREA 全部是**物理像素**；窗口 width / height 与 setSize
 * 是**逻辑像素** —— 换算只发生在「逻辑尺寸 × 缩放比」这一处。
 *
 * 契约化说明：窗口常量（label / 尺寸 / URL）与渲染端（宿主 `src/widget/`）共享
 * 同一份事实源（本目录 `constants.ts`）—— 事件名与 label 写岔任何一边，
 * 窗口就静默失联。
 */
import { invoke } from '@tauri-apps/api/core';
import { currentMonitor, primaryMonitor } from '@tauri-apps/api/window';
import type { Monitor } from '@tauri-apps/api/window';
import { LogicalSize, PhysicalPosition } from '@tauri-apps/api/dpi';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import {
  WATCH_WIDGET_BAR_HEIGHT,
  WATCH_WIDGET_BAR_WIDTH,
  WATCH_WIDGET_DOCK_MARGIN,
  WATCH_WIDGET_POPOVER_FOOTER_PADDING,
  WATCH_WIDGET_POPOVER_GAP,
  WATCH_WIDGET_POPOVER_HEADER_HEIGHT,
  WATCH_WIDGET_POPOVER_HEATMAP_ROWS,
  WATCH_WIDGET_POPOVER_LABEL,
  WATCH_WIDGET_POPOVER_MARKET_ROWS,
  WATCH_WIDGET_POPOVER_MAX_ROWS,
  WATCH_WIDGET_POPOVER_ROW_HEIGHT,
  WATCH_WIDGET_POPOVER_VIEW,
  WATCH_WIDGET_POPOVER_WIDTH,
  WATCH_WIDGET_POPOVER_WINDOW_URL,
  WATCH_WIDGET_TASKBAR_FALLBACK,
  WATCH_WIDGET_WINDOW_LABEL,
  WATCH_WIDGET_WINDOW_URL,
} from './constants';
import type { WatchWidgetPopoverView } from './types';

/** 物理像素矩形（窗口位置 / 尺寸 / 鼠标热区统一用这个形态） */
export interface PhysicalRect {
  /** 物理像素 x */
  x: number;
  /** 物理像素 y */
  y: number;
  /** 物理像素宽 */
  width: number;
  /** 物理像素高 */
  height: number;
}

/** 主屏工作区（物理像素；已剔除任务栏） */
export interface WorkArea {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * 读取主屏工作区（物理像素）
 *
 * 优先走 Rust `get_work_area`（SPI_GETWORKAREA，精确剔除任务栏）；
 * 命令不可用（旧后端 / 非 Windows）时回退「主屏尺寸 - 48px 任务栏」启发式。
 * @returns 工作区矩形
 */
export const getWorkArea = async (): Promise<WorkArea> => {
  try {
    const area = await invoke<[number, number, number, number]>('get_work_area');
    if (area && area.every((value) => Number.isFinite(value))) {
      return { left: area[0], top: area[1], right: area[2], bottom: area[3] };
    }
  } catch {
    // 回退启发式
  }
  const monitor = (await currentMonitor()) ?? (await primaryMonitor());
  if (!monitor) throw new Error('watch-widget: 无可用显示器');
  return {
    left: monitor.position.x,
    top: monitor.position.y,
    right: monitor.position.x + monitor.size.width,
    bottom: monitor.position.y + monitor.size.height - WATCH_WIDGET_TASKBAR_FALLBACK,
  };
};

/**
 * 计算盯盘条默认停靠位（工作区右下角，物理像素）
 * @param scaleFactor 显示缩放比（逻辑尺寸 → 物理尺寸的换算系数）
 * @returns 物理坐标
 */
export const computeDockedBarPosition = async (scaleFactor: number): Promise<{ x: number; y: number }> => {
  const area = await getWorkArea();
  const width = Math.round(WATCH_WIDGET_BAR_WIDTH * scaleFactor);
  const height = Math.round(WATCH_WIDGET_BAR_HEIGHT * scaleFactor);
  const margin = Math.round(WATCH_WIDGET_DOCK_MARGIN * scaleFactor);
  return { x: area.right - width - margin, y: area.bottom - height - margin };
};

/**
 * 读取窗口的物理矩形（位置 + 尺寸；鼠标靠近判定用）
 * @param win 目标窗口
 * @returns 物理矩形
 */
export const getWindowRect = async (win: WebviewWindow): Promise<PhysicalRect> => {
  const [position, size] = await Promise.all([win.outerPosition(), win.outerSize()]);
  return { x: position.x, y: position.y, width: size.width, height: size.height };
};

/**
 * 判断物理坐标是否落在矩形内（允许外扩 padding，给鼠标判定留容差）
 * @param rect 矩形（null 视为不在任何矩形内）
 * @param x 物理像素 x
 * @param y 物理像素 y
 * @param padding 外扩像素
 * @returns 是否在矩形内
 */
export const rectContains = (rect: PhysicalRect | null, x: number, y: number, padding = 0): boolean =>
  rect !== null &&
  x >= rect.x - padding &&
  x <= rect.x + rect.width + padding &&
  y >= rect.y - padding &&
  y <= rect.y + rect.height + padding;

/**
 * 解析盯盘条初始位置：优先用户记忆位置，但落点必须仍在工作区内
 * （换显示器 / 改分辨率 / 缩放比变化后，记忆位置可能在屏幕外 —— 此时回退停靠位）
 * @param savedPosition 用户拖动后记忆的位置（物理像素；null = 停靠右下角）
 * @param monitor 目标显示器（取缩放比）
 * @returns 物理坐标
 */
const resolveBarPosition = async (
  savedPosition: { x: number; y: number } | null,
  monitor: Monitor,
): Promise<{ x: number; y: number }> => {
  const docked = await computeDockedBarPosition(monitor.scaleFactor);
  if (!savedPosition) return docked;
  const area = await getWorkArea();
  const width = Math.round(WATCH_WIDGET_BAR_WIDTH * monitor.scaleFactor);
  const height = Math.round(WATCH_WIDGET_BAR_HEIGHT * monitor.scaleFactor);
  const inside =
    savedPosition.x >= area.left - width &&
    savedPosition.x <= area.right &&
    savedPosition.y >= area.top - height &&
    savedPosition.y <= area.bottom;
  return inside ? savedPosition : docked;
};

/**
 * 创建盯盘条窗口（隐藏创建 → 定位 → 显示；已存在则直接显示）
 *
 * `focusable: false` 是摸鱼刚需：点击条 / 气泡都不会把焦点从工作窗口抢走。
 * @param savedPosition 用户拖动后记忆的位置（物理像素；null = 停靠右下角）
 * @returns 窗口句柄；创建失败返回 null（调用方降级为不启用）
 */
export const openBarWindow = async (
  savedPosition: { x: number; y: number } | null,
): Promise<WebviewWindow | null> => {
  const existing = await WebviewWindow.getByLabel(WATCH_WIDGET_WINDOW_LABEL);
  if (existing) {
    await existing.show().catch(() => undefined);
    return existing;
  }
  const monitor = (await currentMonitor()) ?? (await primaryMonitor());
  if (!monitor) return null;
  const position = await resolveBarPosition(savedPosition, monitor);
  return await new Promise((resolve) => {
    const win = new WebviewWindow(WATCH_WIDGET_WINDOW_LABEL, {
      url: WATCH_WIDGET_WINDOW_URL,
      title: '盯盘小组件',
      // ⚠️ 不传构造器 x/y：Tauri 的 position(x, y) 是**逻辑像素**，而停靠计算在物理像素
      // 体系里（SPI 工作区 / 光标 / outerPosition 全是物理），混用会把窗口飞出屏幕。
      // 统一在 created 后用 setPosition(PhysicalPosition) 显式物理落位（见下）。
      width: WATCH_WIDGET_BAR_WIDTH,
      height: WATCH_WIDGET_BAR_HEIGHT,
      decorations: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      focusable: false,
      shadow: false,
      visible: false,
    });
    // 创建成败经事件异步到达（capabilities 未重编译时 IPC 会被拒），必须等事件下结论
    win.once('tauri://created', () => {
      void (async () => {
        await win.setPosition(new PhysicalPosition(position.x, position.y)).catch(() => undefined);
        await win.show().catch(() => undefined);
        resolve(win);
      })();
    });
    win.once('tauri://error', (event) => {
      console.error('[watch-widget] 盯盘条创建失败', event);
      resolve(null);
    });
  });
};

/**
 * 创建气泡窗口（隐藏态创建一次复用；尺寸与位置在每次展开前按行数设定）
 * @returns 窗口句柄；创建失败返回 null
 */
export const openPopoverWindow = async (): Promise<WebviewWindow | null> => {
  const existing = await WebviewWindow.getByLabel(WATCH_WIDGET_POPOVER_LABEL);
  if (existing) return existing;
  return await new Promise((resolve) => {
    const win = new WebviewWindow(WATCH_WIDGET_POPOVER_LABEL, {
      url: WATCH_WIDGET_POPOVER_WINDOW_URL,
      title: '盯盘候选',
      x: 0,
      y: 0,
      width: WATCH_WIDGET_POPOVER_WIDTH,
      height: WATCH_WIDGET_POPOVER_HEADER_HEIGHT + WATCH_WIDGET_POPOVER_ROW_HEIGHT,
      decorations: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      focusable: false,
      shadow: false,
      visible: false,
    });
    win.once('tauri://created', () => resolve(win));
    win.once('tauri://error', (event) => {
      console.error('[watch-widget] 气泡创建失败', event);
      resolve(null);
    });
  });
};

/** 气泡停靠布局（位置为物理像素；高度为逻辑像素，供 setSize 用） */
export interface PopoverLayout {
  /** 物理像素 x（右对齐盯盘条） */
  x: number;
  /** 物理像素 y（盯盘条正上方，留 GAP 间距） */
  y: number;
  /** 逻辑像素高度（按行数计算，封顶 MAX_ROWS） */
  logicalHeight: number;
}

/**
 * 计算气泡相对盯盘条的停靠布局（右对齐、条正上方）
 *
 * 拆成独立纯查询函数：`positionPopover`（展开时，含尺寸）与
 * `movePopoverToBar`（拖动跟随，只平移不改尺寸）共用同一份几何口径，
 * 保证两条路径算出的落点一致。
 * 高度按内容视图区分：列表视图按行数（封顶 MAX_ROWS），热力 / 大盘视图为固定
 * 等效行数（`WATCH_WIDGET_POPOVER_HEATMAP_ROWS` / `WATCH_WIDGET_POPOVER_MARKET_ROWS`，
 * 与候选行数解耦）。
 * @param bar 盯盘条窗口（定位基准）
 * @param rowCount 当前行数（列表视图决定气泡高度，封顶 MAX_ROWS；热力 / 大盘视图忽略）
 * @param view 气泡内容视图（缺省列表，老调用兼容）
 * @returns 气泡布局
 */
export const computePopoverLayout = async (
  bar: WebviewWindow,
  rowCount: number,
  view: WatchWidgetPopoverView = WATCH_WIDGET_POPOVER_VIEW.LIST,
): Promise<PopoverLayout> => {
  const [barPosition, barSize, scaleFactor] = await Promise.all([
    bar.outerPosition(),
    bar.outerSize(),
    bar.scaleFactor(),
  ]);
  const rows =
    view === WATCH_WIDGET_POPOVER_VIEW.HEATMAP
      ? WATCH_WIDGET_POPOVER_HEATMAP_ROWS
      : view === WATCH_WIDGET_POPOVER_VIEW.MARKET
        ? WATCH_WIDGET_POPOVER_MARKET_ROWS
        : Math.min(Math.max(rowCount, 1), WATCH_WIDGET_POPOVER_MAX_ROWS);
  const logicalHeight =
    WATCH_WIDGET_POPOVER_HEADER_HEIGHT +
    rows * WATCH_WIDGET_POPOVER_ROW_HEIGHT +
    WATCH_WIDGET_POPOVER_FOOTER_PADDING;
  const height = Math.round(logicalHeight * scaleFactor);
  const width = Math.round(WATCH_WIDGET_POPOVER_WIDTH * scaleFactor);
  const x = barPosition.x + barSize.width - width;
  const y = barPosition.y - height - Math.round(WATCH_WIDGET_POPOVER_GAP * scaleFactor);
  return { x, y, logicalHeight };
};

/**
 * 把气泡定位到盯盘条正上方（右对齐），并按视图 / 行数设定尺寸（展开时用）
 * @param popover 气泡窗口
 * @param bar 盯盘条窗口（定位基准）
 * @param rowCount 当前行数（列表视图决定气泡高度；热力视图忽略）
 * @param view 气泡内容视图（缺省列表，老调用兼容）
 */
export const positionPopover = async (
  popover: WebviewWindow,
  bar: WebviewWindow,
  rowCount: number,
  view: WatchWidgetPopoverView = WATCH_WIDGET_POPOVER_VIEW.LIST,
): Promise<void> => {
  const layout = await computePopoverLayout(bar, rowCount, view);
  await popover.setSize(new LogicalSize(WATCH_WIDGET_POPOVER_WIDTH, layout.logicalHeight));
  await popover.setPosition(new PhysicalPosition(layout.x, layout.y));
};

/**
 * 拖动跟随：把气泡平移到盯盘条正上方（不改尺寸；条拖动期间高频调用）
 * @param popover 气泡窗口
 * @param bar 盯盘条窗口（定位基准）
 * @param rowCount 当前行数（跟随期间行数不变，仅用于几何口径一致；热力视图忽略）
 * @param view 气泡内容视图（仅影响几何口径一致性，跟随只平移）
 */
export const movePopoverToBar = async (
  popover: WebviewWindow,
  bar: WebviewWindow,
  rowCount: number,
  view: WatchWidgetPopoverView = WATCH_WIDGET_POPOVER_VIEW.LIST,
): Promise<void> => {
  const layout = await computePopoverLayout(bar, rowCount, view);
  await popover.setPosition(new PhysicalPosition(layout.x, layout.y));
};
