import js from '@eslint/js';
import pluginVue from 'eslint-plugin-vue';
import jsdoc from 'eslint-plugin-jsdoc';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * ESLint flat config（口径与主 app `whf-stock-board/eslint.config.mjs` 保持一致）
 *
 * 卡口口径（团队 TS 规范）：
 * - 禁 enum（const 对象 + as const 替代）
 * - 类型导入必须 `import type`（verbatimModuleSyntax 对齐）
 * - 导出声明必须带 JSDoc（@param / @returns 齐全）
 * - 禁未使用变量 / 禁显式 any（宽松：参数隐式 any 允许，交给 vue-tsc）
 *
 * 与主 app 的三处差异（本仓库结构决定，改配置前先看这里）：
 * 1. `host/` 整棵忽略 —— 它是 `pnpm sync:host` 从主 app 拷来的**类型快照**，
 *    改动会被下次同步覆盖，lint 它没有意义（真要改得去主 app 改）。
 *    注意：`pnpm typecheck` 仍然检查 `host/`（tsconfig include），两者不冲突。
 * 2. `.vue` 不忽略 —— 主 app 忽略根层 `*.vue`，本仓库源码在 `plugins/<id>/` 子目录下，
 *    面板与视图全靠 .vue，必须照常校验。
 * 3. `scripts/` 下的 .mjs 额外补 node 全局 —— 打包 / 同步脚本要用 `process` / `globalThis`，
 *    只有 browser 全局会误报 `no-undef`。
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.ai/**',
      '.readme-rewrite/**',
      '.workbuddy/**',
      // 自动生成，勿手改（同步自主 app）
      'host/**',
      // 产物 zip 与打包临时目录
      'plugins-dist/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.{js,mjs,ts,vue}'],
    plugins: { jsdoc },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      // —— TS 规范硬性卡口 ——
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSEnumDeclaration',
          message: '禁用 enum，请使用 const 对象 + as const + satisfies 替代',
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-unused-vars': 'off',
      // 全角空格仅用于 tooltip 文案排版间隔，字符串/模板内放行
      'no-irregular-whitespace': ['error', { skipStrings: true, skipTemplates: true }],

      // —— JSDoc：导出声明必须带文档 ——
      'jsdoc/require-jsdoc': [
        'warn',
        {
          publicOnly: true,
          require: { FunctionDeclaration: true, MethodDefinition: true, ClassDeclaration: false },
          contexts: [
            'ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > ArrowFunctionExpression',
            'ExportDefaultDeclaration > VariableDeclaration > VariableDeclarator > ArrowFunctionExpression',
          ],
        },
      ],
      'jsdoc/require-param': 'warn',
      'jsdoc/require-returns': 'warn',
      'jsdoc/check-param-names': 'error',

      // —— Vue ——
      'vue/multi-word-component-names': 'off',
      /*
       * 未注册组件卡口：模板里用了但没 import（或没全局注册）的组件，
       * vue-tsc / vite build / 其余 lint 规则**全都查不出来**——运行时只打一条
       * `Failed to resolve component` 的 Vue warn，UI 表现为「点了没反应」。
       * 全局注册的 vue-router 组件用 ignorePattern 放行。
       */
      'vue/no-undef-components': ['error', { ignorePatterns: ['^Router(View|Link)$'] }],
      'vue/no-v-html': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/html-indent': ['error', 2],
      'vue/attributes-order': 'off',

      // —— 通用 ——
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  // 构建脚本跑在 Node 下（主 app 的 server 目录同理，本仓库对应 scripts/）
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser, sourceType: 'module' },
    },
  },
);
