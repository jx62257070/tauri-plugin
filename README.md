# WHF 股票看板 · 官方插件仓库

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-package%20manager-orange)](https://pnpm.io/)

**WHF 股票看板**官方插件的源码与安装包仓库 —— 面向使用 [WHF 股票看板](https://github.com/WHF293/whf-stock-board) 的用户，以及想改插件、提插件的贡献者。

<!-- screenshot: repo-overview -->
> 📷 *截图：仓库总览 —— 应用内已安装的官方插件一览*

## 这是什么

这是 **[WHF 股票看板](https://github.com/WHF293/whf-stock-board)**（一款桌面股票看板应用）的官方插件仓库，收录 4 个官方插件的完整源码、清单（`manifest.json`）与可安装的安装包（`.zip`）。

WHF 股票看板本身只保留插件内核与开放能力（贡献点、`ctx.*` 服务，以及应用提供给插件的宿主服务），**插件源码与安装包都收在这个仓库里**。也就是说，插件不是塞进应用源码里的，而是像浏览器扩展一样独立分发：应用内「插件工坊」（应用内的插件管理入口）导入一个 zip，插件就用起来了，也能一键卸载。

## 插件清单

| 插件 id | 名称 | 版本 | 说明 | 直达 |
| --- | --- | --- | --- | --- |
| `dsh-mainline` | 股票主线 | 1.0.0 | 板块抱团主线四阶段（萌芽 / 确认 / 狂热 / 瓦解）判定，只给阶段与风险提示 | [说明](./plugins/dsh-mainline/README.md) |
| `dsh-dividend-screen` | 股息筛选 | 1.0.0 | 按股息率 / 分红连续性筛样本，叠加今年推算股息率，表格列可配置 | [说明](./plugins/dsh-dividend-screen/README.md) |
| `dsh-quick-note` | 速记 | 1.1.0 | 侧栏抽屉随手记，可关联个股；对外提供 `note:repo` 服务 | [说明](./plugins/dsh-quick-note/README.md) |
| `dsh-sidebar-watch` | 自选盯盘 | 1.3.0 | 顶栏轮播 + 到价 / 涨跌幅提醒，候选池可被其他插件复用 | [说明](./plugins/dsh-sidebar-watch/README.md) |

## 安装方式

前置：已安装 **WHF 股票看板**。

**从 Release 下载（正式渠道）：**

1. 打开 [Release 页面](https://github.com/jx62257070/tauri-plugin/releases)，挑你要的插件；
2. **每个插件一个 zip**，按需下载即可，不必全下（文件名形如 `dsh-quick-note-1.1.0.zip`）；
3. 打开应用，进入「插件工坊」（应用内的插件管理入口），选择「导入插件」，选中刚下载的 zip；
4. 导入后启用，插件入口立即出现在应用里（菜单 / 顶栏 / 侧栏 / 个股详情等，各插件位置见其说明）。

Release 说明里列着每个插件的版本、一句话说明、安装包文件名与体积，照着挑就行。

**用本地构建产物：** 也可以导入 `plugins-dist/` 下对应插件的 zip（例如 `plugins-dist/dsh-quick-note-1.1.0.zip`）—— 那是 `pnpm build` 出来的**本地构建产物**，正式分发走上面的 Release 资产。

卸载：在「插件工坊」里对该插件点卸载。卸载时应用会询问是否一并删除该插件的本地数据表，选「保留」则下次重新安装仍能看到历史数据。

## 目录结构

```text
tauri-plugin/
├─ plugins/<插件 id>/     插件源码（.ts / .vue）+ manifest.json + README.md
├─ host/                  类型快照目录：从 WHF 股票看板同步的类型与常量（自动生成，勿手改）
├─ scripts/
│  ├─ build-plugins.mjs        打包流水线：源码 → 单文件 ESM → zip 安装包
│  ├─ release-notes.mjs        生成 Release 说明正文（版本 / 体积 / 文件名都从清单与产物读出）
│  ├─ sync-host-contract.mjs   从 WHF 股票看板同步类型快照
│  └─ lib/plugin-classes.mjs   安装包用到的 Tailwind 类 → 样式类白名单
└─ plugins-dist/          安装包 zip（已入库，插件工坊里导入的就是它）
```

## 构建与开发

前置要求：**Node.js ≥ 22**、pnpm。

```bash
pnpm install

# 出全部插件包；--host 指向 WHF 股票看板仓库（用于回写样式类白名单）
node scripts/build-plugins.mjs --host ../whf-stock-board

# 只打一个插件
node scripts/build-plugins.mjs dsh-quick-note --host ../whf-stock-board

# 从 WHF 股票看板同步类型快照
pnpm sync:host
```

| 命令 | 作用 |
| --- | --- |
| `pnpm build` | 打包全部插件 |
| `pnpm build:mainline` / `build:dividend` / `build:note` / `build:watch` | 只打对应插件 |
| `pnpm sync:host` | 从 WHF 股票看板同步类型快照到 `host/` |
| `pnpm typecheck` | 类型检查（连 `host/` 的类型快照一起查） |
| `pnpm lint --max-warnings=0` | 代码规范检查（`plugins/` 与 `scripts/`） |
| `pnpm lint:fix` | 同上，并自动修复可修项 |

`--host` 可以省略（默认就是 `../whf-stock-board`，也可用环境变量 `WHF_HOST_APP` 指定）；省略时打包照常，只是不回写样式类白名单。

### 发版本（Release）

Release 由 GitHub Actions（`.github/workflows/release.yml`）自动发，**不用人手在网页上拖 zip**：

| 触发方式 | 怎么用 | 标签从哪来 |
| --- | --- | --- |
| 推送 `v*` 标签 | `git tag v1.0.0 && git push origin v1.0.0` | 就是推上去的那个 tag |
| 手动触发 | 仓库 → Actions →「Release 插件安装包」→ Run workflow | 填了 tag 就用填的；留空则用 `package.json` 的 version 拼出 `v<version>` |

流水线先跑 `pnpm lint --max-warnings=0` 与 `pnpm typecheck`（过不了就不发版），再打 4 个包，最后把 `plugins-dist/*.zip` 作为 Release 资产上传 —— **一个插件一个 zip，不做合集包**。

版本策略是**仓库整体版本**：tag 对齐 `package.json` 的 version；各插件自己的版本（以及体积、安装包文件名）由 `scripts/release-notes.mjs` 从清单与产物读出来，写进 Release 说明的表格里。手动触发时若该 tag 的 Release 已存在，则覆盖同名资产（`gh release upload --clobber`），不升版本也能重出包。

## 设计说明

<details>
<summary>类型快照、单文件 ESM 三条硬约束、样式类白名单</summary>

### 类型快照目录 `host/`

插件源码要引用 WHF 股票看板的类型与常量（`PluginDefinition` / `FormatService` / `PLUGIN_LOG_PREFIX` 等），但这是一个独立仓库，不能 import 应用的 `src/`。做法是把被引用到的那一小撮文件**按原目录结构**拷一份到 `host/`，插件源码里的引用前缀统一为 `../../host/`：

```ts
import type { PluginDefinition } from '../../host/types/plugin.types';
import { PLUGIN_LOG_PREFIX } from '../../host/constants/plugin.constants';
```

同步由 `pnpm sync:host` 完成：从 `src/types` 与 `src/constants` 出发做引用闭包，被引用到的文件按相对 `src/` 的路径落位。WHF 股票看板改了插件用到的类型或常量，跑一次同步即可，类型层立刻报错，不会等到运行时才发现。

插件给宿主契约做扩展（`declare module`）时也指向快照：

```ts
declare module '../../host/types/plugin.types' {
  interface AppServiceMap {
    'note:repo': QuickNoteRepo;
  }
}
```

### 单文件 ESM 的三条硬约束

安装包是**单文件 ESM**，来自 WHF 股票看板的加载机制：

1. **零 `import`** —— 插件在应用里是运行时 Blob 动态 import 的，没有模块解析能力；
2. **`vue` 必须外部化** —— 打进安装包就是第二份 Vue 实例，与应用的组件树互不相认。产出的 `import { … } from 'vue'` 会被改写成从应用运行时桥（插件运行时桥 `__WHF_PLUGIN_RUNTIME__`，供插件与应用共用同一 Vue 实例）取值；
3. **不能用 `template:` 字符串** —— 生产构建不含运行时模板编译器，`.vue` 由 vite 编译成 render 函数。

出包时会「真机跑一遍安装包」（注入运行时桥 `import()` 一次），校验 id / name / version 与清单一致。

### 样式类白名单

应用用 Tailwind，但扫不到这里的插件源码。出包时会把安装包用到的 Tailwind 类汇聚成「样式类白名单」，回写进 WHF 股票看板的 `src/assets/styles/plugin-classes.txt`，由 `@source` 指令引入应用产物 CSS。少了这一步，插件里独有的类名就没有样式。

</details>

## 贡献指南

欢迎反馈与提交 PR。

**改一个插件的标准流程：**

1. 在 `plugins/<id>/` 下改源码；
2. 需要升版本就改 `manifest.json` 的 `version`（安装包文件名与包内清单都跟着它）；
3. `node scripts/build-plugins.mjs <id> --host ../whf-stock-board`；
4. 在 WHF 股票看板仓库跑一次样式审计冒烟（安装包对着应用产物 CSS 必须零缺样式）；
5. 提交 `plugins/<id>/` 与新安装包 zip。

**提一个新插件：** 在 `plugins/<id>/` 下放好 `plugin.ts`（入口）、`manifest.json` 与 `README.md`，并把它登记进 `scripts/build-plugins.mjs` 的构建目标表。

### 三套规范（口径与主 app 一致）

| 规范 | 落地位置 | 说明 |
| --- | --- | --- |
| 代码规范 | `eslint.config.mjs` | 与主 app 同一套卡口：禁 enum、类型导入必须 `import type`、导出声明必须带 JSDoc、禁未使用变量。提交时自动跑 `pnpm lint --max-warnings=0`，告警非零即拦下 |
| 设计规范 | [DESIGN.md](./DESIGN.md) | 主 app `DESIGN.md` 的插件侧适配版：沿用宿主设计语言，并额外约束「只能用宿主已有的 Tailwind 类名」等插件特有规则 |
| 提交规范 | `commitlint.config.mjs` + [husky](./.husky/) | Conventional Commits，提交信息形如 `feat(dsh-quick-note): 速记支持关联股票`，scope 用插件 id |

husky 钩子在 `pnpm install` 时自动装好（`prepare` 脚本）。若需临时跳过校验，用 `git commit --no-verify`——但别养成习惯。

约定：保持插件 id 稳定（id 是数据表名与存储命名空间的一部分）；一个 PR 只做一件事；源码通过 `pnpm typecheck` 与 `pnpm lint --max-warnings=0`。

## 许可

本项目采用 **MIT 许可**，全文见 [LICENSE](./LICENSE)。

## 相关链接

- [WHF 股票看板](https://github.com/WHF293/whf-stock-board) —— 应用本体，包含插件内核与开放能力
- 本仓库：<https://github.com/jx62257070/tauri-plugin>
- 插件 id、版本、入口与说明以各插件的 `manifest.json` 为准

构建命令里的 `--host ../whf-stock-board` 指向应用仓库的**本地克隆目录**，需与主 app 仓库并列放置（或用环境变量 `WHF_HOST_APP` 指定任意路径）。
