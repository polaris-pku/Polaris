import js from '@eslint/js';
import ts from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default ts.config(
  // packages/ 下的 A、BCD 各自带 eslint 配置与 lint 命令（前端这套规则不适用于它们）。
  // 全量 lint 用 pnpm -r lint。
  { ignores: ['dist/', 'node_modules/', 'coverage/', 'packages/', 'release/'] },
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
  // 配置类脚本运行在 Node 环境
  {
    files: ['*.{js,ts}', 'vite.config.ts'],
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
