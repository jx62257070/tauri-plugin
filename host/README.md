# host —— 宿主契约快照（自动生成，勿手改）

由 `node scripts/sync-host-contract.mjs` 从主 app（`../whf-stock-board`）的 `src/` 拷贝而来，
目录结构与宿主一致，因此快照内部的相对 import 与宿主完全等价。

插件源码只引用这里的东西：`../../host/types/plugin.types`、`../../host/constants/plugin.constants` …
宿主改了契约 → 跑一次 `pnpm sync:host` → 类型层立刻暴露不兼容点。

当前快照文件数：14
