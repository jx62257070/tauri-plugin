/**
 * 同步宿主契约快照：`host/` ← 主 app（默认 `../whf-stock-board`）的 `src/`
 *
 * 用法：
 * ```bash
 * node scripts/sync-host-contract.mjs                    # 用默认宿主路径
 * node scripts/sync-host-contract.mjs --host D:\project\whf-stock-board
 * ```
 *
 * **为什么需要它**：插件源码要写 `PluginDefinition` / `FormatService` / `PLUGIN_LOG_PREFIX`
 * 这些宿主类型与常量，而本仓库是独立仓库 —— 不能 `import` 主 app 的 `src/`（那就不是独立仓库了）。
 * 于是把宿主源码里「被插件用到的那一小撮」**按原目录结构**拷到 `host/`：
 * 相对路径一层不变（只把 `../../` 换成 `../../host/`），闭包内的互相 import 也照样解析。
 *
 * 从 `src/types` 与 `src/constants` 出发做**闭包**：被它们相对引用到的文件（如 `src/utils/format-price`）
 * 也一并拷进来，落位仍按它相对 `src/` 的路径 —— 因此 `host/` 里的 import 与宿主完全一致，
 * 不存在「拷过来就断了」的情况。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST_DIR = path.join(ROOT, 'host');

/**
 * 解析 `--host <路径>`；没给就用默认的上级同名仓库
 * @returns 宿主仓库根目录
 */
const resolveHostRoot = () => {
  const args = process.argv.slice(2);
  const flag = args.indexOf('--host');
  const fromFlag = flag >= 0 ? args[flag + 1] : undefined;
  const candidate = fromFlag ?? process.env.WHF_HOST_APP ?? path.resolve(ROOT, '..', 'whf-stock-board');
  const hostRoot = path.resolve(candidate);
  if (!fs.existsSync(path.join(hostRoot, 'src'))) {
    throw new Error(`宿主目录里没有 src/：${hostRoot}（用 --host <路径> 指定主 app 仓库根）`);
  }
  return hostRoot;
};

/** 相对 import / export 的来源（只关心项目内相对路径，裸包名不处理） */
const RELATIVE_SPECIFIER = /from\s+['"](\.[^'"]*)['"]/g;
/** `export … from '…'` 与 `import type … from '…'` 同理 */
const RELATIVE_EXPORT = /export\s+(?:\*|type)?\s*\{[^}]*\}\s*from\s+['"](\.[^'"]*)['"]/g;

/**
 * 解析一条相对 import 指向的真实文件（按宿主 src 下的相对路径）
 *
 * 注意 `.types` / `.constants` 这类「点号不是扩展名」的文件名 —— `path.extname('types/notify.types')`
 * 会返回 `.types`，所以不能靠扩展名判断，得**逐个候选试存在性**。
 * @param hostSrc 宿主 src 目录
 * @param fromDir 引用方所在目录（相对 src）
 * @param spec import 里写的相对路径
 * @returns 解析到的文件（相对 src）；都找不到时返回 null
 */
const resolveSpecifier = (hostSrc, fromDir, spec) => {
  // 全程用 posix 分隔符表示「相对 src 的路径」：`constants/plugin.constants.ts` 与
  // `constants\plugin.constants.ts` 是同一个文件，混用会在闭包里变成两条。
  const base = path.posix.normalize(path.posix.join(fromDir, spec));
  const candidates = [base, `${base}.ts`, `${base}.vue`, `${base}/index.ts`];
  for (const candidate of candidates) {
    if (fs.existsSync(toAbsolute(hostSrc, candidate))) return candidate;
  }
  return null;
};

/**
 * 「相对 src 的 posix 路径」→ 磁盘绝对路径
 * @param root 根目录（宿主 src 或快照 host/）
 * @param rel 相对路径（posix）
 * @returns 绝对路径
 */
const toAbsolute = (root, rel) => path.join(root, ...rel.split('/'));

/**
 * 从一个种子文件出发，收集闭包内的所有文件（按宿主 src 下的相对路径）
 * @param hostSrc 宿主 src 目录
 * @param seeds 种子（相对 src 的路径，如 `types/plugin.types.ts`）
 * @returns 闭包文件清单（相对 src 的路径）
 */
const collectClosure = (hostSrc, seeds) => {
  const seen = new Set();
  const queue = [...seeds];
  while (queue.length > 0) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    const absolute = toAbsolute(hostSrc, rel);
    if (!fs.existsSync(absolute)) {
      process.stdout.write(`  ！ 跳过不存在的引用：${rel}\n`);
      continue;
    }
    seen.add(rel);
    const code = fs.readFileSync(absolute, 'utf8');
    const specs = [
      ...[...code.matchAll(RELATIVE_SPECIFIER)].map((m) => m[1]),
      ...[...code.matchAll(RELATIVE_EXPORT)].map((m) => m[1]),
    ];
    for (const spec of specs) {
      const resolved = resolveSpecifier(hostSrc, path.posix.dirname(rel), spec);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return [...seen].sort();
};

/**
 * 同步一份宿主契约快照
 */
const main = () => {
  const hostRoot = resolveHostRoot();
  const hostSrc = path.join(hostRoot, 'src');
  process.stdout.write(`宿主：${hostRoot}\n`);

  // 种子 = 插件会直接引用的宿主类型 / 常量入口（不必列全，闭包会自动带出依赖）
  const seeds = [
    'types/plugin.types.ts',
    'types/notify.types.ts',
    'types/stock-quote.types.ts',
    'types/table.types.ts',
    'types/watch-widget.types.ts',
    'constants/plugin.constants.ts',
    'constants/trend.constants.ts',
    'constants/watch-widget.constants.ts',
    // 小组件窗口两端共享的「事件协议」常量：渲染端在宿主 src/plugins/watch-widget/，
    // 插件产物经本快照引用同一份事实源，label / 事件名写岔一边窗口就静默失联
    'plugins/watch-widget/constants.ts',
  ];
  const files = collectClosure(hostSrc, seeds);

  // 先清掉旧快照里不再属于闭包的文件，避免留下幽灵引用
  const previous = [];
  if (fs.existsSync(HOST_DIR)) {
    const walk = (dir, prefix) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
        else if (rel !== 'README.md') previous.push(rel);
      }
    };
    walk(HOST_DIR, '');
  }
  const next = new Set(files);
  const stale = [];
  for (const rel of previous) {
    if (next.has(rel)) continue;
    try {
      fs.rmSync(toAbsolute(HOST_DIR, rel), { force: true });
    } catch {
      // 安全层可能把删除劫持成回收站删除并抛错：留到下面的提示里让人手工清
    }
    if (fs.existsSync(toAbsolute(HOST_DIR, rel))) stale.push(rel);
    else process.stdout.write(`  − 移除 ${rel}\n`);
  }

  let copied = 0;
  for (const rel of files) {
    const from = toAbsolute(hostSrc, rel);
    const to = toAbsolute(HOST_DIR, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    const content = fs.readFileSync(from, 'utf8');
    if (fs.existsSync(to) && fs.readFileSync(to, 'utf8') === content) continue;
    fs.writeFileSync(to, content, 'utf8');
    copied += 1;
  }
  if (stale.length > 0) {
    process.stdout.write(
      `  ！ 以下 ${stale.length} 个旧快照文件删不掉（安全层拦截），请手工删除：${stale.join(', ')}\n`,
    );
  }

  fs.writeFileSync(
    path.join(HOST_DIR, 'README.md'),
    [
      '# host —— 宿主契约快照（自动生成，勿手改）',
      '',
      '由 `node scripts/sync-host-contract.mjs` 从主 app（`../whf-stock-board`）的 `src/` 拷贝而来，',
      '目录结构与宿主一致，因此快照内部的相对 import 与宿主完全等价。',
      '',
      '插件源码只引用这里的东西：`../../host/types/plugin.types`、`../../host/constants/plugin.constants` …',
      '宿主改了契约 → 跑一次 `pnpm sync:host` → 类型层立刻暴露不兼容点。',
      '',
      `当前快照文件数：${files.length}`,
      '',
    ].join('\n'),
    'utf8',
  );

  process.stdout.write(
    files.map((file) => `  · ${file.split(path.sep).join('/')}`).join('\n') + '\n',
  );
  process.stdout.write(
    `✓ 宿主契约快照：${files.length} 个文件（本次写入 ${copied} 个）→ host/\n`
    + '插件源码里的引用前缀是 `../../host/`（相对 `plugins/<id>/`）。\n',
  );
};

main();
