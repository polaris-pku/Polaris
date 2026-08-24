import js from '@eslint/js';
import ts from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default ts.config(
  // packages/ 下的 A、BCD 各自带 eslint 配置与 lint 命令（前端这套规则不适用于它们）。
  // 全量 lint 用 pnpm -r lint。
  // backend/ 是 scripts/build-backend.mjs 生成的打包产物（esbuild 单文件 + agent 运行时），不 lint。
  // `.newide/` 是后端运行时状态目录（.gitignore 已忽略）。Council 会把整个仓库复制一份
  // 到每个 participant 的工作区（.newide/**/council/**/cp_*/），跑过一次真实任务后
  // 它就有上千个文件——不排掉的话 `pnpm verify` 会扫进去然后炸。
  {
    ignores: [
      'dist/',
      'node_modules/',
      'coverage/',
      'packages/',
      'release/',
      'backend/',
      '.newide/',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  // 配置类脚本 / 构建脚本 / Electron 主进程 TS：都跑在 Node 环境
  {
    files: ['*.{js,ts}', 'vite.config.ts', 'scripts/**/*.{js,mjs,cjs}', 'electron/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  // Electron 主/预加载脚本：CommonJS + Node 环境
  {
    files: ['electron/**/*.cjs', '**/*.cjs'],
    languageOptions: {
      globals: globals.node,
      sourceType: 'commonjs',
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  prettier,
);
