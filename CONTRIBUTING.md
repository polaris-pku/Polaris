# 贡献指南

本仓库遵循团队《工程习惯规范》。提交前请确保本地 `pnpm verify` 通过。

## 环境

- Node `>=22.22.1`（见 `.nvmrc`，推荐 `nvm use`）
- 包管理器 **pnpm**（版本由 `package.json` 的 `packageManager` 锁定，建议 `corepack enable`）

```bash
corepack enable
pnpm install
pnpm build:backend # 构建后端及执行器运行时
pnpm electron:dev  # 桌面开发
pnpm verify       # lint + 类型检查 + 测试（提交前必跑，CI 跑的就是它）
```

仅调试渲染层时可使用 `pnpm dev`；后端代码修改后需重新运行 `pnpm build:backend`。

## 分支与提交

- `main` 永远可用、永远绿（CI 通过），**任何人不直推 main**。
- 每个任务从 `main` 切**短命分支**：`<类型>/<简述>`，如 `feat/parallel-lanes`、`fix/board-reset`。一个分支 ≈ 一个 Issue ≈ 1–3 天。
- 提交信息用 **Conventional Commits**：`<type>(<scope>): <subject>`
  - `type`：`feat | fix | docs | refactor | test | chore | build | ci`
  - 例：`feat(canvas): 支持 Backend∥Test 并行子链`
  - 用 `Closes #12` 关联 Issue，合并后自动关闭。
- 提交会经过 Husky 门禁：自动 `prettier --write` + `eslint --fix`（lint-staged），提交信息不合规会被 commitlint 拦下。

## Pull Request

- **小而聚焦**：一个 PR 只做一件事，优先 < 400 行。
- 按 PR 模板填写「做了什么 / 关联 / 自检清单」。
- 动了对外接口/契约，在 PR 里 @ 依赖方并更新 `api/` 下的契约文档。
- 至少 1 个 approve + CI 通过才能合并；**Squash & merge** 为默认，合并后删分支。

## 代码风格

- TypeScript `strict`；格式由 Prettier 统一（`prettier.config.js`），规则由 ESLint 统一（`eslint.config.js`）。
- 不要手动调格式，交给 `pnpm format:fix`。
