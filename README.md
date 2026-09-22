# whf-stock-board-plugin

[WHF 股票看板](https://github.com/) 的**官方插件仓库**：四个官方插件的源码、清单与分发产物都在这里，
宿主应用（`whf-stock-board`）只保留插件内核与开放能力，不再持有插件源码。

```
whf-stock-board-plugin/
├─ plugins/<插件 id>/     源码（.ts / .vue）+ manifest.json + README.md
├─ host/                  宿主契约快照（自动生成，勿手改）
├─ scripts/
│  ├─ build-plugins.mjs        打包流水线：源码 → 单文件 ESM → zip 产物包
│  ├─ sync-host-contract.mjs   从主 app 同步宿主契约快照
│  └─ lib/plugin-classes.mjs   产物用到的 Tailwind 类 → 宿主样式白名单
└─ plugins-dist/          产物 zip（入库，拿给用户安装的就是它）
```

## 插件清单

| 插件 id | 名称 | 版本 | 说明 |
| --- | --- | --- | --- |
| `dsh-mainline` | 股票主线 | 1.0.0 | 板块主线判定与阶段跟踪（基准交易日截面口径） |
| `dsh-dividend-screen` | 股息筛选 | 1.0.0 | 按股息率 / 分红连续性筛样本，表格列可配置 |
| `dsh-quick-note` | 速记 | 1.1.0 | 侧栏抽屉随手记，可关联个股（`Ctrl+Alt+N`） |
| `dsh-sidebar-watch` | 自选盯盘 | 1.3.0 | 顶栏轮播 + 到价 / 涨跌幅提醒（`Ctrl+Alt+W`） |

四个插件都**不在宿主源码里**：用户在应用的「插件工坊」里安装 `plugins-dist/*.zip`，也能一键卸载。

## 快速开始

```bash
pnpm install

# 出全部包；--host 指向主 app 仓库（用于回写宿主的样式白名单）
node scripts/build-plugins.mjs --host ../whf-stock-board

# 只出一个
node scripts/build-plugins.mjs dsh-quick-note --host ../whf-stock-board

# 类型检查（会连 host/ 的契约快照一起查）
pnpm typecheck
```

`--host` 可以省略（默认就是 `../whf-stock-board`）；省掉时打包照常，只是不回写样式白名单。

## 宿主契约快照 `host/`

插件源码要引用宿主的类型与常量（`PluginDefinition` / `FormatService` / `PLUGIN_LOG_PREFIX` …），
但本仓库是独立仓库，不能 import 主 app 的 `src/`。所以把它们**按原目录结构**拷一份到 `host/`：

```ts
import type { PluginDefinition } from '../../host/types/plugin.types';
import { PLUGIN_LOG_PREFIX } from '../../host/constants/plugin.constants';
```

- 由 `node scripts/sync-host-contract.mjs` 生成（从 `src/types` 与 `src/constants` 出发做引用闭包，
  被引用到的文件按其相对 `src/` 的路径落位，所以快照内部的相对 import 与宿主完全等价）；
- **宿主改了插件用到的类型或常量 → 跑一次同步 → 本仓库类型层立刻报错**，不会等到运行时才发现；
- 插件给宿主契约做扩展（`declare module`）时指向快照：
  `declare module '../../host/types/plugin.types' { interface AppServiceMap { 'note:repo': QuickNoteRepo } }`。

## 打包做了什么

产物是**单文件 ESM**，三条硬约束（来自宿主的加载机制）：

1. **零 `import`** —— 插件在宿主里是运行时 Blob 动态 import 的，没有模块解析能力；
2. **`vue` 必须外部化** —— 打进产物就是第二份 Vue 实例，与宿主组件树互不相认；
   产出的 `import { … } from 'vue'` 会被改写成从宿主运行时桥 `__WHF_PLUGIN_RUNTIME__.vue` 取值；
3. **不能用 `template:` 字符串** —— 生产构建不含运行时模板编译器，`.vue` 由 vite 编译成 render 函数。

出包时还会「真机跑一遍产物」（注入运行时桥 `import()` 一次），校验 id / name / version 与清单一致，
并把产物用到的 Tailwind 类回写进宿主的 `src/assets/styles/plugin-classes.txt`
（宿主 Tailwind 扫不到插件源码，靠这份白名单经 `@source` 进产物 CSS）。

## 改一个插件的标准流程

1. 在 `plugins/<id>/` 下改源码；
2. 需要升版本就改 `manifest.json` 的 `version`（产物文件名与包内清单都跟着它）；
3. `node scripts/build-plugins.mjs <id> --host ../whf-stock-board`；
4. 在宿主仓库跑一次样式审计冒烟（产物对着宿主产物 CSS 必须零缺样式）；
5. 提交 `plugins/<id>/` 与新产物 zip。

宿主侧要改的是**能力**（贡献点、`ctx.*`、十六个宿主服务），不是插件内容 ——
插件能做的事变多了，才轮到插件仓库跟进。
