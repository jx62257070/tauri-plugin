/**
 * Release 说明正文生成器：插件清单 + 打包产物 → Markdown
 *
 * 用法：
 * ```bash
 * node scripts/build-plugins.mjs   # 先出包（本脚本读的就是它的产物）
 * node scripts/release-notes.mjs   # 再生成 plugins-dist/release-notes.md
 * ```
 *
 * 正文里的版本、名称、安装包文件名、体积**全部从 manifest.json 与 zip 产物读出**，
 * 不硬编码 —— 插件升版本后不用改这里，重跑一次即可。
 *
 * 产出文件由 CI 用 `gh release create --notes-file` 消费（见 .github/workflows/release.yml）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库根目录（本脚本在 scripts/ 下） */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 插件源码目录 */
const PLUGINS = path.join(ROOT, 'plugins');

/** 打包产物目录（与 scripts/build-plugins.mjs 的 DIST 一致） */
const DIST = path.join(ROOT, 'plugins-dist');

/** 说明正文输出文件（CI 用 --notes-file 消费） */
const NOTES_FILE = path.join(DIST, 'release-notes.md');

/** 宿主应用仓库地址（说明里引导用户先装应用） */
const HOST_REPO_URL = 'https://github.com/WHF293/whf-stock-board';

/** 表格里的插件顺序（与 README「插件清单」一致；未登记的按 id 排在最后） */
const DISPLAY_ORDER = ['dsh-mainline', 'dsh-dividend-screen', 'dsh-quick-note', 'dsh-sidebar-watch'];

/** 「一句话说明」的最大字符数（含末尾省略号） */
const SUMMARY_MAX = 48;

/**
 * 列出插件 id
 *
 * 直接扫 `plugins/` 下的目录，避免与 `scripts/build-plugins.mjs` 的构建目标表
 * 各写一份（新增插件只要落了目录就会进 Release 说明）。
 * @returns 按展示顺序排好的插件 id 数组
 */
const listPluginIds = () => {
  const rank = new Map(DISPLAY_ORDER.map((id, index) => [id, index]));
  return fs
    .readdirSync(PLUGINS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => {
      const rankLeft = rank.get(left) ?? Number.MAX_SAFE_INTEGER;
      const rankRight = rank.get(right) ?? Number.MAX_SAFE_INTEGER;
      return rankLeft === rankRight ? left.localeCompare(right) : rankLeft - rankRight;
    });
};

/**
 * 读一个插件的清单
 * @param id 插件 id（= 插件目录名）
 * @returns 清单对象
 */
const readManifest = (id) => {
  const manifestFile = path.join(PLUGINS, id, 'manifest.json');
  if (!fs.existsSync(manifestFile)) {
    throw new Error(`缺少清单文件：${path.relative(ROOT, manifestFile)}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (manifest.id !== id) {
    throw new Error(`清单 id（${manifest.id}）与目录名（${id}）不一致`);
  }
  return manifest;
};

/**
 * 把清单里的长说明压成「一句话」
 *
 * 两步：先去掉「左侧导航新增「X」看板：」这类位置前缀（只在它足够短时去，
 * 避免把正文里的冒号误当分隔符），再截到第一个句读。
 * @param description 清单里的原始说明
 * @param max 最大字符数（含省略号）
 * @returns 一句话说明
 */
const summarize = (description, max = SUMMARY_MAX) => {
  const flat = description.replace(/\s+/g, ' ').trim();
  const colon = flat.indexOf('：');
  const body = colon > 0 && colon <= 24 ? flat.slice(colon + 1).trim() : flat;
  const sentence = /^[^。；;！!？?]*/.exec(body)?.[0].trim() ?? body;
  const text = sentence.length > 0 ? sentence : body;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/**
 * 转义表格单元格：竖线与换行会破坏 Markdown 表格
 * @param text 原始文本
 * @returns 可安全放进表格单元格的文本
 */
const escapeCell = (text) => text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/**
 * 字节数转成 KB 文本
 * @param bytes 字节数
 * @returns 形如 `46.4 KB` 的文本
 */
const formatKb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

/**
 * 汇总每一行：清单字段 + 产物文件名与体积
 * @returns 表格行数据数组
 */
const collectRows = () => {
  const rows = [];
  for (const id of listPluginIds()) {
    const manifest = readManifest(id);
    const zipName = `${id}-${manifest.version}.zip`;
    const zipFile = path.join(DIST, zipName);
    if (!fs.existsSync(zipFile)) {
      throw new Error(
        `找不到安装包 ${zipName}：请先跑 node scripts/build-plugins.mjs`
        + `（Release 说明必须与资产一一对应，缺包不放行）`,
      );
    }
    rows.push({
      id,
      name: manifest.name ?? id,
      version: manifest.version,
      summary: summarize(manifest.description ?? ''),
      zipName,
      size: formatKb(fs.statSync(zipFile).size),
    });
  }
  if (rows.length === 0) {
    throw new Error(`plugins/ 下没有任何插件：${path.relative(ROOT, PLUGINS)}`);
  }
  return rows;
};

/**
 * 渲染 Release 说明正文（Markdown）
 * @param rows 表格行数据
 * @returns Markdown 文本
 */
const renderNotes = (rows) => [
  `本 Release 包含 ${rows.length} 个官方插件安装包，需配合 [WHF 股票看板](${HOST_REPO_URL}) 使用：`
  + '**每个插件一个 zip，按需下载即可**。',
  '',
  '| 插件 id | 名称 | 版本 | 说明 | 安装包 | 体积 |',
  '| --- | --- | --- | --- | --- | --- |',
  ...rows.map((row) => [
    `\`${escapeCell(row.id)}\``,
    escapeCell(row.name),
    escapeCell(row.version),
    escapeCell(row.summary),
    `\`${escapeCell(row.zipName)}\``,
    row.size,
  ].join(' | ')).map((line) => `| ${line} |`),
  '',
  '## 怎么装',
  '',
  '1. 下载上表里你需要的 zip（不用全下，一个 zip 就是一个插件）；',
  `2. 打开 [WHF 股票看板](${HOST_REPO_URL})，进入「插件工坊」→「导入插件」，选中该 zip；`,
  '3. 导入后启用，插件入口立即出现在应用里（菜单位置见各插件的说明）。',
  '',
  `> 应用本体与插件内核见 [WHF 股票看板](${HOST_REPO_URL})；插件 id、版本、入口以各插件的 \`manifest.json\` 为准。`,
  '',
].join('\n');

/**
 * 主流程
 */
const main = async () => {
  const rows = collectRows();
  const notes = renderNotes(rows);
  fs.mkdirSync(DIST, { recursive: true });
  fs.writeFileSync(NOTES_FILE, notes, 'utf8');

  process.stdout.write(`Release 说明已生成：${path.relative(ROOT, NOTES_FILE)}\n`);
  for (const row of rows) {
    process.stdout.write(`  ✓ ${row.id} v${row.version} → ${row.zipName}（${row.size}）\n`);
  }
  process.stdout.write(`共 ${rows.length} 个插件安装包。\n`);
};

await main();
