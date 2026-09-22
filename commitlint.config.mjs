/**
 * Commitlint 配置（Conventional Commits）
 *
 * 与主 app 保持一致：主 app 目前**没有**这一层（无 husky / commitlint），
 * 本仓库自建，两边提交信息格式因此同源可对齐。
 *
 * 允许的类型：
 * - feat 新功能 / fix 修 bug / docs 文档 / refactor 重构
 * - perf 性能 / test 测试 / build 构建与依赖 / ci 流水线
 * - chore 杂项 / revert 回滚
 *
 * 特殊放行：
 * - `chore(release)` / `chore(deps)` 等常规 chore 不受限制
 * - 插件版本提交形如 `feat(dsh-quick-note): 支持关联股票`，scope 用插件 id
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'refactor',
        'perf',
        'test',
        'build',
        'ci',
        'chore',
        'revert',
      ],
    ],
    // 中文正文常见较长，放宽到 100
    'header-max-length': [2, 'always', 100],
    // 插件 id 带连字符（dsh-quick-note），scope 允许小写 + 连字符 + 数字
    'scope-enum': [0],
    'subject-case': [0],
  },
};
