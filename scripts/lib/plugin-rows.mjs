/**
 * 插件包行数据收集（`release-notes.mjs` 与 `build-update-index.mjs` 共用）
 *
 * 「有哪些插件、各自什么版本、产物叫什么」的答案必须只有一份：两个脚本各扫一遍
 * `plugins/` 就会在新增插件时漏改其中一处，于是 CI 产出的 Release 说明与更新清单
 * 互相不一致（说明里有、清单里没有，或反之）。
 *
 * 这里只产出**与包本身有关**的行数据（id / name / version / description / author /
 * zipName / zipFile / bytes）。「一句话摘要」「体积文本化」「sha256」「下载直链」
 * 这类某个脚本独有的派生由调用方自己 map 出来，不塞进共用层。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库根目录（本文件在 scripts/lib/ 下，故回退两级） */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 插件源码目录（README 抽取等派生逻辑也按它定位，故导出） */
export const PLUGINS = path.join(ROOT, 'plugins');

/** 打包产物目录（与 scripts/build-plugins.mjs 的 DIST 一致） */
export const DIST = path.join(ROOT, 'plugins-dist');

/** 表格里的插件顺序（与 README「插件清单」一致；未登记的按 id 排在最后） */
const DISPLAY_ORDER = ['dsh-mainline', 'dsh-dividend-screen', 'dsh-quick-note', 'dsh-sidebar-watch'];

/**
 * 一个插件包的行数据（与 `plugins-dist/` 下的一个 zip 一一对应）
 * @typedef {object} PluginPackageRow
 * @property {string} id 插件 id（= 插件目录名 = manifest.id）
 * @property {string} name 展示名（清单缺 name 时回退 id）
 * @property {string} version 语义化版本
 * @property {string} description 清单原文说明（缺时为空串）
 * @property {string} author 作者（缺时为空串）
 * @property {string} zipName 产物文件名 `<id>-<version>.zip`
 * @property {string} zipFile 产物绝对路径
 * @property {number} bytes 产物字节数
 */

/**
 * 列出插件 id
 *
 * 直接扫 `plugins/` 下的目录，避免与 `scripts/build-plugins.mjs` 的构建目标表
 * 各写一份（新增插件只要落了目录就会进 Release 说明）。
 * @returns 按展示顺序排好的插件 id 数组
 */
export const listPluginIds = () => {
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
export const readManifest = (id) => {
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
 * 收集每个插件的包行数据（清单字段 + 产物文件名 + 产物体积）
 *
 * 产物缺失直接抛错：Release 说明与更新清单都必须与本次上传的资产一一对应，缺包不放行。
 * @returns 包行数据数组（顺序同 `listPluginIds()`）
 */
export const collectPackageRows = () => {
  const rows = [];
  for (const id of listPluginIds()) {
    const manifest = readManifest(id);
    const zipName = `${id}-${manifest.version}.zip`;
    const zipFile = path.join(DIST, zipName);
    if (!fs.existsSync(zipFile)) {
      throw new Error(
        `找不到安装包 ${zipName}：请先跑 node scripts/build-plugins.mjs`
        + `（Release 说明与更新清单必须与资产一一对应，缺包不放行）`,
      );
    }
    rows.push({
      id,
      name: manifest.name ?? id,
      version: manifest.version,
      description: manifest.description ?? '',
      author: manifest.author ?? '',
      zipName,
      zipFile,
      bytes: fs.statSync(zipFile).size,
    });
  }
  if (rows.length === 0) {
    throw new Error(`plugins/ 下没有任何插件：${path.relative(ROOT, PLUGINS)}`);
  }
  return rows;
};
