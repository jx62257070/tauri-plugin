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
import { DIST, ROOT, collectPackageRows } from './lib/plugin-rows.mjs';

/** 说明正文输出文件（CI 用 --notes-file 消费） */
const NOTES_FILE = path.join(DIST, 'release-notes.md');

/** 宿主应用仓库地址（说明里引导用户先装应用） */
const HOST_REPO_URL = 'https://github.com/WHF293/whf-stock-board';

/** 「一句话说明」的最大字符数（含末尾省略号） */
const SUMMARY_MAX = 56;

/** 截断后回退时认的「子句边界」分隔符 */
const CLAUSE_BREAKS = ['，', '、', '；', ';', '：', '/'];

/** 回退到子句边界后至少要剩这么多字，否则宁可硬切（避免退成「同花顺…」这种残句） */
const SUMMARY_MIN = 12;

/**
 * 截断到子句边界：先按字数硬切，再从切点往回找最近的分隔符，在边界处收尾
 *
 * 只硬切会把「…（萌芽·确认·狂热·…」这类断在半句话里的尾巴留在表格里，
 * 所以硬切之后要往回退到最近的子句分隔符；退完剩得太短就说明没有可用边界，宁可硬切。
 * @param text 待截断文本
 * @param max 最大字符数（含省略号）
 * @returns 截断后的文本
 */
const truncateAtClause = (text, max) => {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  let breakAt = -1;
  for (const mark of CLAUSE_BREAKS) {
    breakAt = Math.max(breakAt, cut.lastIndexOf(mark));
  }
  return breakAt >= SUMMARY_MIN ? `${text.slice(0, breakAt)}…` : `${cut}…`;
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
  return truncateAtClause(text, max);
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
 * 汇总每一行：共用包行数据 + 本脚本独有的「一句话摘要」与「体积文本」
 *
 * 包行数据（id / 版本 / 产物文件名 / 字节数）来自 `collectPackageRows()`，
 * 与 `scripts/build-update-index.mjs` 同源 —— 新增插件时两边不会漏改一处。
 * @returns 表格行数据数组
 */
const collectRows = () =>
  collectPackageRows().map((row) => ({
    ...row,
    summary: summarize(row.description ?? ''),
    size: formatKb(row.bytes),
  }));

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
