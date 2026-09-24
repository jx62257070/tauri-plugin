/**
 * 从插件 README 的「版本记录」表格抽取本次版本的更新说明
 *
 * **为什么以 README 为唯一事实源**：变更说明本来就是人写给人看的，而人写它的地方已经存在
 * —— README 的「## 版本记录」表格。再引入一个 `CHANGELOG.md` 就等于同一句话维护两遍，
 * 且第二遍没有任何机制提醒你同步（发版只改了 `manifest.json` 的 version、忘了补表格，
 * 是最常见的漏法）。让构建期去读人已经在写的那张表，漏写就从「悄悄发一条没说明的更新」
 * 变成一次构建失败。
 *
 * **为什么失败即抛错、不回退空串**：主 app 在「发现新版本」弹窗里直接渲染这个字段。
 * 空串意味着用户看到「有更新，但不知道更新了什么」；而抽错行（拿到别的版本的说明）
 * 比空串更糟 —— 用户会以为装上了并没有的功能。与本仓库既有约定一致
 * （`collectPackageRows` 缺包不放行、`RELEASE_TAG` 缺失直接抛错）：
 * 产出一份坏清单比什么都不产出更糟。
 *
 * **为什么单独成模块而不是塞进 `plugin-rows.mjs`**：共用层只回答「有哪些包、什么版本、
 * 产物叫什么」这一组与包本身绑定的事实；README 解析是只有更新清单需要的派生，
 * 且将来 `release-notes.mjs` 若要在 Release 正文里复用同一句话，也是 import 这里。
 */
import fs from 'node:fs';
import path from 'node:path';
import { PLUGINS, ROOT } from './plugin-rows.mjs';

/** 变更说明所在的小节标题（四个插件 README 里统一写作「## 版本记录」） */
const SECTION_HEADING = '版本记录';

/**
 * 表头必须长成这样（三列、列序固定）
 *
 * 取值是按列序索引来的：表头一旦增删列或换序，按索引取出来的就是「日期」甚至别的列的内容，
 * 而且**看起来仍然像一句通顺的话** —— 这种错比崩掉危险得多，所以宁可苛刻。
 */
const EXPECTED_HEADER = ['版本', '日期', '变更'];

/** 「版本」列的索引（表头校验通过后才有意义） */
const VERSION_COLUMN = 0;

/** 「变更」列的索引 */
const CHANGE_COLUMN = 2;

/** 匹配小节标题行（`## 版本记录`） */
const HEADING_PATTERN = /^##\s+版本记录\s*$/;

/** 匹配下一个任意层级标题 —— 小节到此为止 */
const NEXT_HEADING_PATTERN = /^#{1,6}\s/;

/** 匹配表格分隔行的单元格（`:---` / `---` / `---:` 及其组合） */
const SEPARATOR_CELL_PATTERN = /^:?-{1,}:?$/;

/**
 * 转成相对仓库根的路径
 *
 * 错误信息里用它：绝对路径会因 checkout 位置不同而变成一堆噪音，且 CI 日志里太占地方。
 * @param file 绝对路径
 * @returns 相对路径
 */
const relative = (file) => path.relative(ROOT, file);

/**
 * 取一个插件 README 的路径
 * @param id 插件 id（= 插件目录名）
 * @returns README 绝对路径
 */
export const readmeFileOf = (id) => path.join(PLUGINS, id, 'README.md');

/**
 * 取「## 版本记录」小节的正文行（不含标题行）
 *
 * 只取到下一个标题为止：README 后半篇还有「许可」之类的段落，放进来会让「表格里没有这一行」
 * 的判断混进无关内容。
 * @param lines README 全文按行切好的数组
 * @returns 小节正文行；没找到该小节时返回 null
 */
const extractSectionLines = (lines) => {
  const titleIndex = lines.findIndex((line) => HEADING_PATTERN.test(line));
  if (titleIndex < 0) return null;
  const body = [];
  for (const line of lines.slice(titleIndex + 1)) {
    if (NEXT_HEADING_PATTERN.test(line)) break;
    body.push(line);
  }
  return body;
};

/**
 * 把一行表格拆成单元格
 *
 * 按**未转义**的 `|` 切分，再把 `\|` 还原成 `|`：Markdown 表格里要在单元格里写一个竖线
 * 只能转义，原样透传 `\|` 会让用户看到一根莫名其妙的反斜杠。
 * @param line 表格行原文（形如 `| 1.1.0 | 2026-09 | 变更 |`）
 * @returns 去掉首尾空白的单元格数组
 */
const splitRowCells = (line) => {
  let body = line.trim();
  if (body.startsWith('|')) body = body.slice(1);
  // 尾部的 `\|` 是转义竖线，不能当成行的结束符吃掉
  if (body.endsWith('|') && !body.endsWith('\\|')) body = body.slice(0, -1);
  const cells = [];
  let current = '';
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === '\\' && body[index + 1] === '|') {
      current += '|';
      index += 1;
    } else if (char === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
};

/**
 * 是不是表格分隔行（`| --- | --- | --- |`）
 * @param line 待判定行
 * @returns 是否分隔行
 */
const isSeparatorRow = (line) => {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return false;
  const cells = splitRowCells(trimmed);
  return cells.length > 0 && cells.every((cell) => SEPARATOR_CELL_PATTERN.test(cell));
};

/**
 * 从一节正文里取出第一张 Markdown 表格
 *
 * 认「`|` 开头且下一行是分隔行」为表格起点：这是 Markdown 表格唯一可靠的标记，
 * 光看 `|` 开头会把小节里随便一个竖线文本误当表头。
 * @param sectionLines 小节正文行
 * @param readmeFile README 路径（用于报错）
 * @returns 表头单元格与数据行（数组的数组）
 */
const extractTable = (sectionLines, readmeFile) => {
  const headerIndex = sectionLines.findIndex(
    (line, index) => line.trimStart().startsWith('|') && isSeparatorRow(sectionLines[index + 1] ?? ''),
  );
  if (headerIndex < 0) {
    throw new Error(
      `${relative(readmeFile)} 的「## ${SECTION_HEADING}」小节里找不到 Markdown 表格：`
      + '需要一张带分隔行（`| --- | --- | --- |`）的三列表格',
    );
  }
  const header = splitRowCells(sectionLines[headerIndex]);
  const rows = [];
  for (const line of sectionLines.slice(headerIndex + 2)) {
    if (!line.trimStart().startsWith('|')) break;
    rows.push(splitRowCells(line));
  }
  return { header, rows };
};

/**
 * 校验表头是预期的三列
 * @param header 表头单元格
 * @param readmeFile README 路径（用于报错）
 */
const assertHeader = (header, readmeFile) => {
  const matches = header.length === EXPECTED_HEADER.length
    && header.every((cell, index) => cell === EXPECTED_HEADER[index]);
  if (!matches) {
    throw new Error(
      `${relative(readmeFile)}「## ${SECTION_HEADING}」表格的表头不是预期的`
      + `「${EXPECTED_HEADER.join(' | ')}」（实际「${header.join(' | ')}」）：`
      + '本脚本按固定列序取「版本」与「变更」两列，表头一变就会张冠李戴，请改回三列表头',
    );
  }
};

/**
 * 读一个插件在指定版本的更新说明
 *
 * 版本列按**原文精确匹配**（只去首尾空白）：宽松匹配（比如容忍 `v1.1.0`）会把
 * 「表格与 manifest 写法不一致」这类不一致静默吞掉，而报错信息里已经列出了表格里
 * 实际存在的版本，改哪边都是一秒钟的事。
 *
 * 单元格里的 Markdown（反引号、链接）原样透传：主 app 是纯文本 `<p>` 渲染，这里的取舍是
 * 「宁可多一对反引号，也不丢信息」—— 反引号在纯文本里至少还能表明 `watch:repo` 是个服务名，
 * 而任何剥离规则都会顺手误伤 `Ctrl+Enter` 这类正当内容，且不可逆。
 *
 * 同一个版本出现多行时取第一行：表格按时间倒序写，最上面一条即最新。
 *
 * 命中行的**列数也校验**：表头是三列不代表每行都写满三列，少一列会让取值落到 `undefined`。
 * @param id 插件 id（= 插件目录名）
 * @param version manifest 里的版本（形如 `1.1.0`）
 * @returns 变更说明原文
 */
export const readPluginChangelog = (id, version) => {
  const readmeFile = readmeFileOf(id);
  if (!fs.existsSync(readmeFile)) {
    throw new Error(
      `缺少 README：${relative(readmeFile)} —— 更新说明从它的「## ${SECTION_HEADING}」表格抽取`,
    );
  }
  const lines = fs.readFileSync(readmeFile, 'utf8').split(/\r?\n/);
  const sectionLines = extractSectionLines(lines);
  if (sectionLines === null) {
    throw new Error(
      `${relative(readmeFile)} 缺少「## ${SECTION_HEADING}」小节：`
      + '更新说明以它下面的三列表格为唯一事实源，请补上该小节与表格',
    );
  }

  const { header, rows } = extractTable(sectionLines, readmeFile);
  assertHeader(header, readmeFile);

  const row = rows.find((cells) => cells[VERSION_COLUMN] === version);
  if (row === undefined) {
    const found = rows.map((cells) => cells[VERSION_COLUMN]).join('、') || '（空表）';
    throw new Error(
      `${relative(readmeFile)} 的「## ${SECTION_HEADING}」表格里没有版本 ${version} 这一行`
      + `（表格里有：${found}）：manifest.json 的 version 是 ${version}，`
      + '请在该表格补一行同版本的变更说明',
    );
  }

  // 表头对不代表每行都写满了：`| 1.0.0 | 2026-09 |` 这种少一列的行会让 row[CHANGE_COLUMN]
  // 变成 undefined，后面的 `.length` 抛 TypeError —— 发版的人得从堆栈反推才知道表格列数不对。
  // 这里拦成一句人话；不补齐成空串，理由与「变更列为空抛错」相同：残缺说明等于没说明。
  if (row.length !== EXPECTED_HEADER.length) {
    throw new Error(
      `${relative(readmeFile)} 的「## ${SECTION_HEADING}」表格里版本 ${version} 那一行列数不对`
      + `（实际 ${row.length} 列，应为 ${EXPECTED_HEADER.length} 列「${EXPECTED_HEADER.join(' | ')}」）：`
      + '请照三列写全，尤其是「变更」列',
    );
  }

  const changelog = row[CHANGE_COLUMN];
  if (changelog.length === 0) {
    throw new Error(
      `${relative(readmeFile)} 的「## ${SECTION_HEADING}」表格里版本 ${version} 的「变更」列是空的：`
      + '空说明等于用户看到一条没有内容的更新，请补上后再跑',
    );
  }
  return changelog;
};
