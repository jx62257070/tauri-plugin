/**
 * 官方插件打包流水线：源码 → 单文件 ESM 产物 → zip 产物包
 *
 * 用法：
 * ```bash
 * node scripts/build-plugins.mjs                          # 打全部
 * node scripts/build-plugins.mjs dsh-mainline             # 只打一个
 * node scripts/build-plugins.mjs --host ../whf-stock-board # 顺带回写宿主的样式白名单
 * ```
 *
 * 三条硬约束（来自宿主安装链路，见宿主 `src/plugin/user-plugin-lint.ts`）：
 * 1. 产物里**不能有任何 import** —— 插件是运行时 Blob 动态 import 的，
 *    没有模块解析能力，写 import 必然装不上；
 * 2. 不能有 `template:` 模板字符串 —— 生产构建不含运行时模板编译器；
 * 3. `vue` 必须外部化 —— 打进来就是第二份 Vue 实例，与宿主的组件树互不相认。
 *
 * 于是 `.vue` 由 vite 官方插件**编译成 render 函数**（约束 2 天然满足），
 * 而它产出的 `import { … } from 'vue'` 由本脚本改写成「从宿主运行时桥取值」（约束 1、3），
 * 桥由宿主在 `installPlugins` 里挂到 `globalThis.__WHF_PLUGIN_RUNTIME__` ——
 * 插件产物与宿主因此共用**同一个 Vue 实例**。
 */
import * as vueRuntime from 'vue';
import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import { strToU8, zipSync } from 'fflate';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CLASS_ALLOWLIST_RELATIVE,
  collectArtifactClasses,
  readExistingAllowlist,
  readHostCssClassProbe,
  writeClassAllowlist,
} from './lib/plugin-classes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGINS = path.join(ROOT, 'plugins');
const DIST = path.join(ROOT, 'plugins-dist');
const TMP = path.join(DIST, '.tmp');

/**
 * 构建目标表（插件目录名 = 插件 id，入口固定 `plugin.ts`）
 *
 * 与宿主仓库里那份「临时 TARGETS」不同：这里的源码**一直在库里**，所以这张表是常态。
 * 插件源码放 `plugins/<id>/`，清单 `manifest.json` 与说明 `README.md` 与源码同目录。
 */
const TARGETS = [
  { id: 'dsh-mainline', entry: 'plugin.ts' },
  { id: 'dsh-dividend-screen', entry: 'plugin.ts' },
  { id: 'dsh-quick-note', entry: 'plugin.ts' },
  { id: 'dsh-sidebar-watch', entry: 'plugin.ts' },
];

/** 运行时桥的全局键（与宿主 `src/constants/plugin.constants.ts` 保持一致） */
const RUNTIME_BRIDGE_KEY = '__WHF_PLUGIN_RUNTIME__';

/** vite/rollup 产出的 vue 具名导入（`import { a, b as c } from 'vue';`） */
const VUE_IMPORT = /^import\s*\{([^}]*)\}\s*from\s*["']vue["'];?[ \t]*$/gm;

/** 任何残留 import（产物的红线：一个都不能有） */
const ANY_IMPORT = /^\s*import\s+(?:[^'"\n]*?\bfrom\s+)?['"]([^'"]+)['"]/gm;

/**
 * 解析宿主仓库根目录（可缺省）
 *
 * 找到了就把「产物用到的 Tailwind 类」回写进宿主的样式白名单
 * （`src/assets/styles/plugin-classes.txt`，经 theme.css 的 `@source` 进产物 CSS）；
 * 找不到只是跳过这一步 —— 打包本身不依赖宿主。
 * @returns 宿主根目录；不可用时为 null
 */
const resolveHostRoot = () => {
  const args = process.argv.slice(2);
  const flag = args.indexOf('--host');
  const fromFlag = flag >= 0 ? args[flag + 1] : undefined;
  const candidate = path.resolve(fromFlag ?? process.env.WHF_HOST_APP ?? path.resolve(ROOT, '..', 'whf-stock-board'));
  if (!fs.existsSync(path.join(candidate, CLASS_ALLOWLIST_RELATIVE))) {
    process.stdout.write(
      `  ！ 宿主不可达（${candidate} 下没有 ${CLASS_ALLOWLIST_RELATIVE}）：跳过样式白名单回写。\n`
      + '     用 --host <主 app 仓库根> 指定，或先跑一次 pnpm sync:host。\n',
    );
    return null;
  }
  return candidate;
};

/**
 * 具名导入列表转成解构列表（`ref, computed as c` → `ref, computed: c`）
 * @param names import 花括号内的原文
 * @returns 解构模式文本
 */
const toDestructuring = (names) =>
  names
    .split(',')
    .map((raw) => raw.trim())
    .filter((raw) => raw.length > 0)
    .map((raw) => {
      const matched = /^(\S+)\s+as\s+(\S+)$/.exec(raw);
      return matched ? `${matched[1]}: ${matched[2]}` : raw;
    })
    .join(', ');

/**
 * 把产物里的 vue import 换成「运行时桥取值」，并加上缺失桥时的明确报错
 * @param code 原始产物
 * @returns 改写后的产物
 */
const bridgeVueImports = (code) => {
  let bridged = 0;
  const out = code.replace(VUE_IMPORT, (_full, names) => {
    bridged += 1;
    return `const { ${toDestructuring(names)} } = ${RUNTIME_BRIDGE_KEY}.vue;`;
  });
  if (bridged === 0) {
    throw new Error('产物里没有 vue 导入：入口是否真的用到了 Vue？（SFC 编译后必然有一条）');
  }
  const guard = [
    `const ${RUNTIME_BRIDGE_KEY} = globalThis.${RUNTIME_BRIDGE_KEY};`,
    `if (!${RUNTIME_BRIDGE_KEY}?.vue) {`,
    `  throw new Error('宿主运行时桥不可用：${RUNTIME_BRIDGE_KEY}（插件必须在该版本宿主里安装）');`,
    `}`,
    '',
  ].join('\n');
  return `${guard}${out}`;
};

/**
 * 断言产物干净（没有任何残留 import）
 * @param code 产物源码
 * @param id 插件 id（报错用）
 */
const assertNoImports = (code, id) => {
  ANY_IMPORT.lastIndex = 0;
  const leftovers = [...code.matchAll(ANY_IMPORT)].map((match) => match[1]);
  if (leftovers.length > 0) {
    throw new Error(
      `插件 ${id} 的产物里仍有 ${leftovers.length} 条 import（${leftovers.join(', ')}）：`
      + '宿主加载器无法解析任何裸模块，请把依赖打进产物或改从 ctx 上取',
    );
  }
};

/**
 * 把一个插件源码目录打成单文件产物
 * @param target 构建目标
 * @returns 产物文件内容
 */
const buildArtifact = async (target) => {
  const srcDir = path.join(PLUGINS, target.id);
  const outDir = path.join(TMP, target.id);
  await build({
    root: srcDir,
    configFile: false,
    logLevel: 'warn',
    plugins: [vue()],
    build: {
      outDir,
      emptyOutDir: true,
      minify: false,
      target: 'es2020',
      cssCodeSplit: false,
      lib: {
        entry: path.join(srcDir, target.entry),
        formats: ['es'],
        fileName: () => 'main.js',
      },
      rollupOptions: {
        // vue **必须外部化**：一旦被打进产物就是「第二份 Vue 实例」，
        // 插件里的 ref 与宿主的组件树互不相认（响应式与渲染全崩）。
        // 这里保留 `import … from 'vue'`，随后由 bridgeVueImports 改写成
        // 从宿主运行时桥取值 —— 二者共用同一实例。
        external: ['vue'],
      },
    },
  });
  return fs.readFileSync(path.join(outDir, 'main.js'), 'utf8');
};

/**
 * 「跑一遍产物」做发布前校验：真实 import 它（注入运行时桥），比对清单与导出定义
 * @param id 插件 id
 * @param code 产物源码
 * @param manifest 清单内容
 * @returns 产物导出的插件定义（已校验 id / name / version 与清单一致）
 */
const validateArtifact = async (id, code, manifest) => {
  const file = path.join(TMP, id, 'bridged.mjs');
  fs.writeFileSync(file, code, 'utf8');
  (globalThis)[RUNTIME_BRIDGE_KEY] = { vue: vueRuntime };

  const mod = await import(pathToFileURL(file).href);
  const definition = mod.default ?? mod.plugin;
  if (!definition || typeof definition !== 'object') {
    throw new Error(`插件 ${id} 的产物没有导出插件定义（需要 export default { … }）`);
  }
  if (typeof definition.apply !== 'function') {
    throw new Error(`插件 ${id} 的导出缺少 apply 函数`);
  }
  for (const field of ['id', 'name', 'version']) {
    if (definition[field] !== manifest[field]) {
      throw new Error(
        `插件 ${id} 的 ${field} 不一致：清单写着「${manifest[field]}」，产物导出「${definition[field]}」`,
      );
    }
  }
  return definition;
};

/**
 * 取插件源码目录里「最新的输入文件 mtime」，作为整个 zip 的统一时间戳
 *
 * zip 条目默认记「打包那一刻」（DOS 时间戳），于是内容一字不改也会因时间戳不同
 * 而产出不同字节 —— 入库产物永远 dirty，`git status` 每次都是红的。
 * 改成跟住源码：内容不变 → mtime 不变 → zip 逐字节可复现。
 * @param srcDir 插件源码目录
 * @returns 统一时间戳（源码里最新那个文件的 mtime；目录为空时用固定日期兜底）
 */
const resolveSourceMtime = (srcDir) => {
  const newestIn = (dir) => {
    let newest = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        newest = Math.max(newest, newestIn(full));
      } else if (entry.isFile()) {
        newest = Math.max(newest, fs.statSync(full).mtimeMs);
      }
    }
    return newest;
  };
  const newest = newestIn(srcDir);
  return new Date(newest > 0 ? newest : Date.UTC(2000, 0, 1));
};

/**
 * 打包一个插件
 * @param target 构建目标
 * @param hostRoot 宿主仓库根目录（可为 null）
 * @returns 打包结果（产物路径与体积）
 */
const packTarget = async (target, hostRoot) => {
  const { id } = target;
  const pluginDir = path.join(PLUGINS, id);
  const manifestFile = path.join(pluginDir, 'manifest.json');
  if (!fs.existsSync(manifestFile)) {
    throw new Error(`缺少清单文件：${path.relative(ROOT, manifestFile)}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (manifest.id !== id) throw new Error(`清单 id（${manifest.id}）与目录名（${id}）不一致`);

  process.stdout.write(`▸ ${id}：正在编译 …\n`);
  const raw = await buildArtifact(target);
  const bridged = bridgeVueImports(raw);
  assertNoImports(bridged, id);

  const definition = await validateArtifact(id, bridged, manifest);

  const files = { 'manifest.json': strToU8(JSON.stringify(manifest, null, 2)) };
  files[manifest.entry ?? 'main.js'] = strToU8(bridged);
  const readmeFile = path.join(pluginDir, manifest.readme ?? 'README.md');
  if (fs.existsSync(readmeFile)) {
    files[manifest.readme ?? 'README.md'] = strToU8(fs.readFileSync(readmeFile, 'utf8'));
  }

  // 统一时间戳挂在 zip 选项上（fflate 会把它并进每个条目）：内容不变 → 字节不变
  const zipped = zipSync(files, { level: 9, mtime: resolveSourceMtime(pluginDir) });
  const outFile = path.join(DIST, `${id}-${manifest.version}.zip`);
  fs.mkdirSync(DIST, { recursive: true });
  fs.writeFileSync(outFile, zipped);

  const kb = (zipped.byteLength / 1024).toFixed(1);
  process.stdout.write(
    `✓ ${id} v${manifest.version}：${Object.keys(files).join(' + ')} → `
    + `${path.relative(ROOT, outFile)}（${kb} KB，未压缩 ${(bridged.length / 1024).toFixed(1)} KB）\n`
    + `  导出校验：id=${definition.id} name=${definition.name} apply=${typeof definition.apply}\n`,
  );

  // 把产物用到的 Tailwind 类写进宿主的样式白名单 —— 插件源码不在宿主的 src/ 下，
  // Tailwind 扫不到它们，少了这一步就只能祈祷宿主别处也碰巧用了同一个类
  // （见 scripts/lib/plugin-classes.mjs）。
  if (!hostRoot) {
    process.stdout.write('  样式白名单：宿主未指定，跳过\n');
    return { id, outFile, bytes: zipped.byteLength, rawBytes: bridged.length };
  }
  const isKnownClass = readHostCssClassProbe(hostRoot);
  const allowlist = new Set([...readExistingAllowlist(hostRoot), ...collectArtifactClasses(bridged, isKnownClass)]);
  writeClassAllowlist(hostRoot, allowlist);
  process.stdout.write(`  样式白名单：${allowlist.size} 个类 → 宿主 ${CLASS_ALLOWLIST_RELATIVE}\n`);

  return { id, outFile, bytes: zipped.byteLength, rawBytes: bridged.length };
};

/**
 * 主流程
 */
const main = async () => {
  // 位置参数 = 除掉 `--host <路径>` 这对之外的所有入参
  const argv = process.argv.slice(2);
  const hostFlag = argv.indexOf('--host');
  const args = hostFlag >= 0 ? [...argv.slice(0, hostFlag), ...argv.slice(hostFlag + 2)] : argv;
  const hostRoot = resolveHostRoot();
  if (hostRoot) process.stdout.write(`宿主：${hostRoot}\n`);
  const targets = args.length > 0
    ? TARGETS.filter((target) => args.includes(target.id))
    : TARGETS;
  if (targets.length === 0) {
    throw new Error(`没有匹配的构建目标：${args.join(', ')}（可选：${TARGETS.map((t) => t.id).join(', ')}）`);
  }

  try {
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.mkdirSync(TMP, { recursive: true });
  } catch {
    // 临时目录清理失败无害：产物按固定清单覆盖写
  }

  const results = [];
  for (const target of targets) {
    results.push(await packTarget(target, hostRoot));
  }
  process.stdout.write(`\n共 ${results.length} 个插件包已就绪，输出目录：${path.relative(ROOT, DIST)}\n`);
};

await main();
