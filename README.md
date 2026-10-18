<img src="assets/SVG/logo_main.svg" width="64" alt="Polaris 标志" />

# Polaris

**面向软件开发的智能协作空间。**

组织 Agent 协作，将需求转化为本地项目中的代码与文件。

## 协作逻辑

```mermaid
flowchart LR
    Request["提出需求"] --> Task["任务编排"]
    Task --> Single["单 Agent 执行"]
    Task --> Council["多 Agent 合议"]
    Single --> Delivery["检查与交付"]
    Council --> Delivery
    Delivery --> Files["项目文件"]
```

单 Agent 直接执行；多 Agent 通过提案、评审与综合完成协作。进度、角色记忆与交付文件集中在同一个项目中。

## 功能与架构

| 功能     | 可以做什么                                           |
| -------- | ---------------------------------------------------- |
| 任务协作 | 选择执行模式，按角色配置驱动，跟踪任务与续跑         |
| 过程观测 | 查看阶段进度、工具活动、事件和 token 用量            |
| 角色记忆 | 管理 Agent 画像、技能、经验与技能市场                |
| 项目交付 | 浏览交付文件、恢复历史任务，使用 Python 终端运行脚本 |

```mermaid
flowchart TB
    E["协作空间<br/>项目 · 任务 · 产物"]
    C["任务编排<br/>执行 · 协作 · 交付"]
    B["角色记忆<br/>画像 · 技能 · 经验"]
    A["执行引擎<br/>Coding Agent"]
    D["策略检查<br/>规则 · 审查"]
    Files["本地文件与运行记录"]

    E <-->|请求与状态| C
    C <--> B
    C <--> A
    C <--> D
    A -->|执行读写| Files
    C -->|交付与归档| Files
```

内置 Claude Code 与本地记忆存储。可在「设置 → 驱动路由」中为角色选择执行器；其他执行器需要单独安装并配置。

## 开始使用

### 安装版

从 [Releases](https://github.com/polaris-pku/Polaris/releases) 下载已发布的平台安装包。
安装包包含后端与 Claude Code，无需另外安装 Node.js 或开发工具。没有对应平台安装包时，可从源码启动。

1. **配置模型**：打开「设置 → 模型与认证」，选择服务商并填写 API Key；自定义服务还需填写端点和模型，然后「保存并重启后端」。
2. **选择项目**：在首页新建项目，或通过「打开项目 → 从文件夹打开」选择已有目录。
3. **提交需求**：点击「新建需求」，填写需求与验收标准，选择「单 Agent」或「多 Agent 合议」。
4. **查看交付**：在运行页查看进度与用量，在项目文件树查看产物；运行 Python 脚本前，先在「运行时」中选择或安装解释器。

支持 Anthropic 官方 API、DeepSeek 和自定义 Anthropic 兼容端点。

> Agent 会执行命令并修改文件，所需的项目内容会发送给你选择的模型服务。请在有版本控制的项目中使用；Polaris 不是系统沙箱。

### 从源码启动

需要 **Node.js 22.22.1+**（见 [.nvmrc](.nvmrc)）与 **pnpm**（版本见 [package.json](package.json) 的 `packageManager`）。

```bash
git clone https://github.com/polaris-pku/Polaris.git
cd Polaris
corepack enable
pnpm install
pnpm build:backend
pnpm electron:dev
```

首次构建后端会下载执行器运行时；修改后端代码后需重新运行 `pnpm build:backend`。
已有完整运行时且只修改源码时，可用 `pnpm build:backend --bundles-only` 更新宿主、ACP runner、驱动探针与配置，保留 Node、Agent 和 PGlite 运行时；不能用它代替首次完整构建。
Linux / WSL 需要可用的图形环境及 Electron 系统依赖。启动后按上面的步骤配置模型和项目。

### 内嵌后端版本

BCD 与 A 按各自上游 `main` 同步，本次同步基线为：

- BCD：[`polaris-pku/newide-scaffold@861b185d`](https://github.com/polaris-pku/newide-scaffold/commit/861b185d8c6e9c16a0248084810b4839bd42cbbc)。
- A：[`polaris-pku/acp-client-prototype@e8a58ed3`](https://github.com/polaris-pku/acp-client-prototype/commit/e8a58ed3b5835d06d050a26a7f213687f776fafe)。

保留桌面宿主所需的项目根注入、包内 Node 启动与打包适配。原生会话恢复失败会显式报错，不以新建会话冒充恢复；真实模型的单 Agent / 合议恢复及目标平台安装包仍需实机验收。

此本地测试分支额外保留无凭据代理入口：已有的 `modelProxy.baseUrl` 和
`modelProxy.model` 会作为本地测试路由，设置中显示“本地代理测试（无凭据）”。
只允许 loopback 端点，启动前检查所选模型，不发送 API Key，
代理不可用时显式报错而不回退到官方服务。显式选择其他服务商会关闭代理模式。
该测试分支与正式 API 认证的 PR 构建独立交付，不回退上述 A/BCD 基线或 Memory 修复。

## 深入了解

[使用指南](src/docs/overview.md) · [运行参考](src/docs/protocol.md) · [Python 终端](src/docs/python-terminal.md) · [开发与贡献](CONTRIBUTING.md)
