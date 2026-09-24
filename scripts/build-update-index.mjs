/**
 * 插件更新清单生成器：插件清单 + 打包产物 → plugins-dist/index.json
 *
 * 用法：
 * ```bash
 * node scripts/build-plugins.mjs                                # 先出包（本脚本读的就是它的产物）
 * RELEASE_TAG=v1.1.0 node scripts/build-update-index.mjs         # 再生成 plugins-dist/index.json
 * ```
 *
 * 主 app「插件在线更新」消费这份清单：拉一次 `index.json` 就知道每个插件的最新版本与
 * zip 直链，不必碰 GitHub Releases API（未鉴权 60 次/小时，走 CDN 才无限流）。
 *
 * 两个刻意的取舍：
 * - **zip 直链钉在本 Release 的 tag 上**，不用 `latest/download`：`latest` 会随下次发版漂移，
 *   而 `zipName` 属于本次 Release，一漂移就是 404。所以 `RELEASE_TAG` 是必填项，
 *   缺失直接抛错 —— 产出一份没有 tag 的坏清单比什么都不产出更糟。
 * - **sha256 是可选语义**：有就算（能发现下载截断 / 资产被换），清单里没有就跳过，
 *   旧清单与手写清单照样可用。
 * - **changelog 从 README 的「## 版本记录」表格抽**（见 `lib/plugin-changelog.mjs`）：
 *   主 app 在确认弹窗里直接渲染它，抽不到就抛错中止 —— 一份没有说明的更新清单，
 *   和一份 zip 直链 404 的清单同样不可用。
 *
 * 产出文件由 CI 随 zip 一起 `gh release upload`（见 .github/workflows/release.yml）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DIST, ROOT, collectPackageRows } from './lib/plugin-rows.mjs';
import { readPluginChangelog } from './lib/plugin-changelog.mjs';

/** 清单契约版本（主 app 读到非 1 视为不可用；将来改结构时 +1） */
const SCHEMA_VERSION = 1;

/** 缺省仓库（CI 里由 `GITHUB_REPOSITORY` 覆盖，本地跑用它兜底） */
const DEFAULT_REPO = 'jx62257070/tauri-plugin';

/** 单包体积门禁（8MB，与主 app `USER_PLUGIN_PACKAGE_MAX_BYTES` 对齐） */
const MAX_ZIP_BYTES = 8 * 1024 * 1024;

/** 输出文件（CI 上传；.gitignore 已忽略） */
const INDEX_FILE = path.join(DIST, 'index.json');

/** stdout 里 sha256 只打印前几位（全串太长，够肉眼比对即可） */
const SHA256_PREVIEW_LENGTH = 8;

/** stdout 里更新说明只打印前几个字（够肉眼确认不是空串、没抽错插件即可） */
const CHANGELOG_PREVIEW_LENGTH = 20;

/**
 * 取本次 Release 的 tag
 *
 * 必填：没有 tag 就拼不出固定直链（只能用会漂移的 `latest`），产出即坏清单。
 * @returns Release tag（形如 `v1.1.0`）
 */
const resolveTag = () => {
  const tag = (process.env.RELEASE_TAG ?? '').trim();
  if (tag.length === 0) {
    throw new Error(
      '缺少环境变量 RELEASE_TAG：用法 RELEASE_TAG=v1.1.0 node scripts/build-update-index.mjs',
    );
  }
  return tag;
};

/**
 * 取仓库全名（`owner/repo`）
 * @returns 仓库全名
 */
const resolveRepo = () => (process.env.GITHUB_REPOSITORY ?? '').trim() || DEFAULT_REPO;

/**
 * 算一个 zip 的 SHA-256（十六进制小写）
 * @param file zip 绝对路径
 * @returns sha256 十六进制串
 */
const sha256Of = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/**
 * 拼本 Release 的发布页地址
 * @param repo 仓库全名
 * @param tag Release tag
 * @returns 发布页 URL
 */
const releaseUrlOf = (repo, tag) => `https://github.com/${repo}/releases/tag/${tag}`;

/**
 * 拼某个包的固定 tag 直链
 * @param repo 仓库全名
 * @param tag Release tag
 * @param zipName 产物文件名
 * @returns 下载直链
 */
const downloadUrlOf = (repo, tag, zipName) =>
  `https://github.com/${repo}/releases/download/${tag}/${zipName}`;

/**
 * 体积门禁：超 8MB 直接中止（主 app 装不进去，早失败比上传完才发现好）
 * @param row 包行数据
 */
const assertZipSize = (row) => {
  if (row.bytes > MAX_ZIP_BYTES) {
    throw new Error(
      `${row.zipName} 体积 ${(row.bytes / 1024 / 1024).toFixed(1)} MB 超出上限 8MB：`
      + '主 app 装不下，请精简产物后重跑',
    );
  }
};

/**
 * 生成更新清单对象
 * @returns 清单对象（可直接 JSON.stringify）
 */
const buildIndex = () => {
  const tag = resolveTag();
  const repo = resolveRepo();
  const releaseUrl = releaseUrlOf(repo, tag);
  const plugins = collectPackageRows().map((row) => {
    assertZipSize(row);
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      description: row.description,
      author: row.author,
      zipName: row.zipName,
      zipSize: row.bytes,
      sha256: sha256Of(row.zipFile),
      downloadUrl: downloadUrlOf(repo, tag, row.zipName),
      changelog: readPluginChangelog(row.id, row.version),
    };
  });
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    repo,
    tag,
    releaseUrl,
    plugins,
  };
};

/** 主流程 */
const main = () => {
  const index = buildIndex();
  fs.mkdirSync(DIST, { recursive: true });
  fs.writeFileSync(INDEX_FILE, `${JSON.stringify(index, null, 2)}\n`, 'utf8');

  process.stdout.write(`更新清单已生成：${path.relative(ROOT, INDEX_FILE)}\n`);
  for (const plugin of index.plugins) {
    const preview = plugin.changelog.slice(0, CHANGELOG_PREVIEW_LENGTH);
    process.stdout.write(
      `  ✓ ${plugin.id} v${plugin.version} → ${plugin.zipName}`
      + `（${(plugin.zipSize / 1024).toFixed(1)} KB）`
      + `sha256=${plugin.sha256.slice(0, SHA256_PREVIEW_LENGTH)}… `
      // 说明也打出来：CI 日志里能一眼看出有没有抽空，不必下载 index.json 去看
      + `说明=${preview}${preview.length < plugin.changelog.length ? '…' : ''}\n`,
    );
  }
  process.stdout.write(
    `共 ${index.plugins.length} 个插件，tag=${index.tag}，repo=${index.repo}\n`,
  );
};

main();
