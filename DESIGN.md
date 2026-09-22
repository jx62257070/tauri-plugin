---
version: alpha
name: whf-stock-board-plugin-design
description: >
  插件侧设计规范：插件 UI 运行在 WHF 股票看板内，必须沿用宿主的设计语言（清爽、克制、数据密度优先）。
  token 单源在宿主的 src/assets/styles/theme.css，插件**不持有样式文件**，只能用宿主已存在的 Tailwind 类名。
  主色湖青 #0e9488 与涨跌语义色隔离；涨跌默认红涨绿跌，四档色阶供文本消费。
  插件产物用到的类名必须进入宿主的样式类白名单，否则宿主 Tailwind 扫不到插件源码，类名会没有样式。
source: 同步自主 app DESIGN.md（https://github.com/WHF293/whf-stock-board），并做插件侧适配
colors:
  primary: "#0e9488"
  on-primary: "#ffffff"
  primary-weak: "#e6f5f3"
  ink: "#1f2733"
  ink-muted: "#5c6b80"
  ink-subtle: "#98a2b3"
  canvas: "#f7f9fa"
  surface-1: "#ffffff"
  semantic-up: "#e02020"
  semantic-up-strong: "#c51616"
  semantic-up-light: "#f2a6a6"
  semantic-up-pale: "#f8d7d7"
  semantic-up-weak: "#fdecec"
  semantic-down: "#00b578"
  semantic-down-strong: "#00925f"
  semantic-down-light: "#8fd9bd"
  semantic-down-pale: "#ccefe0"
  semantic-down-weak: "#e6f7f1"
  semantic-flat: "#8a94a6"
  semantic-flat-weak: "#eef1f5"
typography:
  page-title: "16px / 600"
  card-title: "14px / 600"
  body: "14px / 400"
  body-sm: "12px / 400"
  caption: "12px / 500"
  button: "14px / 500"
rounded:
  card: 12px
  control: 8px
  tag: 9999px
spacing:
  card-padding: 16px
  control-y: 6px
  control-x: 12px
  element-gap: "4px / 8px 基准"
---

# 插件设计规范

## Overview

本仓库的插件运行在 [WHF 股票看板](https://github.com/WHF293/whf-stock-board) 内，UI 上**不自带设计体系**——完整沿用宿主的设计语言：数据密度优先、装饰克制。

本文档同步自主 app 的 `DESIGN.md`，并改写为**插件侧口径**：主 app 那份里"改色值只动 `theme.css`"这类指引，在插件仓库无法执行（文件不在本仓库），对应的插件侧约束见下面「Plugin Constraints」一章。

**Key Characteristics（沿用宿主）：**

- 浅灰青画布 + 白色卡片面，柔和双层阴影，12px 卡片圆角
- 湖青主色刻意中性偏冷，与涨跌语义色完全隔离
- A 股习惯「红涨绿跌」为默认语义，四档色阶（strong / 标准 / light / pale + weak 底色）
- 主题色、涨跌配色、明暗模式由宿主的 `<html>` 属性级联控制，**插件自动跟随，无需自己适配**
- 无 1px 边框线，分隔靠弱色底与留白

## Colors

### Brand & Accent

- 主色 `#0e9488`：按钮、激活态、进度条、focus ring
- 主色弱底 `#e6f5f3`：激活态背景
- 宿主的 `data-theme` 可切换 blue / pink / purple，插件无需感知

### Surface & Text

- 画布 `#f7f9fa`、表面 `#ffffff`、分隔（ghost 按钮底 / 输入框底 / 行 hover 底）`#eef1f5`
- 文本三级：`#1f2733` 主 / `#5c6b80` 次级 / `#98a2b3` 弱化与 placeholder

### Semantic（涨跌语义，插件核心）

四档色阶按 |涨跌幅| 分档：≥5% 用 strong，≥2% 用标准色，其余用 light；pale 供分布桶色；weak 供胶囊底与闪烁动画。

| 档位 | 涨（默认红） | 跌（默认绿） |
| --- | --- | --- |
| strong | `#c51616` | `#00925f` |
| 标准 | `#e02020` | `#00b578` |
| light | `#f2a6a6` | `#8fd9bd` |
| pale | `#f8d7d7` | `#ccefe0` |
| weak 底 | `#fdecec` | `#e6f7f1` |

平盘 `#8a94a6`。

**插件不自己判断涨跌色方向**：方向随宿主的 `data-trend`（`red_up` / `green_up` / `blue_down`）变化，一律用 `text-up` / `text-down` / `text-flat` 类名，或经宿主 `app:format` 服务取色，绝不写死红绿 hex。

## Typography & Layout

| 层级 | 字号 / 字重 | 用途 |
| --- | --- | --- |
| page-title | 16px / 600 | 面板 / 视图标题 |
| card-title | 14px / 600 | 卡片标题 |
| body | 14px / 400 | 正文、表格内容 |
| button / nav-active | 14px / 500 | 按钮、激活项 |
| body-sm / caption | 12px | 次级信息、标签 |

- 卡片内边距 16px，卡片头与内容间距 12px；控件 padding 6px × 12px；元素间距以 4px / 8px 为基准
- 卡片 12px 圆角，控件 8px，标签 / 胶囊 9999px
- 表格：滚动容器 + 表头吸顶 + 首列吸左（复用宿主 `app:ui` 提供的表格能力，不自己实现）
- 面板类插件（drawer / 顶栏下拉）宽度由宿主控制，插件内容按窄容器排版

## Plugin Constraints（插件侧特有，主 app 那份没有）

这几条是插件与宿主组件的根本差异决定的，**违反会直接表现为线上样式丢失或主题不跟随**：

1. **只能用宿主已有的 Tailwind 类名**。插件不引入 CSS 文件、不写 `<style>` 之外的主题变量；宿主的 Tailwind 扫不到本仓库源码，产物里用到的类名靠**样式类白名单**进入产物 CSS。
2. **新增类名必须重跑打包并回写白名单**。构建时 `node scripts/build-plugins.mjs --host ../whf-stock-board` 会把产物用到的类写进宿主的 `src/assets/styles/plugin-classes.txt`；只改源码不重跑，新类名在宿主里就是裸类、没有样式。
3. **不写死色值**。需要语义色时用 `text-up` / `bg-up-weak` 这类 token 类名，或经 `app:format` 的涨跌色方法取；写死 hex 会导致切换涨跌主题时不跟随。
4. **明暗模式不自己适配**。宿主用 class 策略（`<html class="dark">`）级联覆盖，插件沿用 token 类名即自动跟随；不要写 `.dark:` 之外的硬编码深色值。
5. **UI 组件优先用宿主注入的能力**（`app:ui` 的按钮 / 空态 / 弹窗 / 图标等）。插件产物零 `import`，不能引用宿主的 Vue 组件，重复实现一套既不一致又白费。
6. **不在插件里定义 token**。需要新色值 / 新圆角时，先去主 app 的 `theme.css` 加 token 并同步本文档 frontmatter，再在插件里使用。

## Do's and Don'ts

**Do：**

- 一切色值从宿主 token 走：Tailwind 类如 `text-up`、`bg-surface`、`text-ink-muted` 直接消费
- 涨跌语义用 `text-up` / `text-down` / `text-flat` 或 `app:format`，方向交给宿主的 `data-trend`
- 新组件优先复用宿主 `app:ui` 的能力；按压反馈用 `pressable` + `active:scale-95`
- 改完 UI 源码后重跑打包，让样式类白名单同步更新

**Don't：**

- 不引入 token 之外的颜色、字号、圆角值
- 不写死「红 = 涨」
- 不用 1px 边框线做卡片 / 分隔（用弱色底与留白）
- 不引入 webfont、不改系统字体栈
- 不在插件里新建样式文件（产物是单文件 ESM，样式只能走宿主白名单）

## Iteration Guide

- 插件侧改色 / 改排版：改 `plugins/<id>/` 下的 .vue 类名 → 重跑打包回写白名单 → 在宿主里目视验证
- 需要新 token：去主 app 的 `theme.css` 的 `@theme` 块加，并同步本文档 frontmatter 与主 app 的 `DESIGN.md`
- 设计规范本身以主 app 的 `DESIGN.md` 为准；本文档是它的插件侧投影，两者冲突时以主 app 为准

## Known Gaps

- 未定义 display 级大标题与等宽字体 token（行情数字未用 mono 字体）
- 插件无法自定义断点，沿用 Tailwind 默认断点
- 产物用到的类名依赖白名单机制，本地改样式但未连宿主仓库打包时，样式变更不会生效
