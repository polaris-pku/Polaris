# Polaris

一个**可演示的 Web 交互原型**：把「与单个 AI 聊天」升级为「像管理一支 AI 工程团队一样完成开发任务」。

项目起点是 **Scripted IDE Simulator**（假 IDE + 真实交互 + 预设 Agent 剧情），演示流程稳定、可重复、可一键重置。

**桌面版现已接通真实后端**：需求会真正交给 coding agent 执行，产出真实文件 —— 见「[真实后端（A + BCD）](#真实后端a--bcd)」。mock 剧本保留为无后端时的兜底通路。

> 界面已对齐后端协作链路规范：Task Board 完整建模 **N0–N18 端到端主链路**与 **11 态协调器状态机**，字段、状态、Gate 决策、事件均取自 `api/` 下的规范文档。

在 mock 剧本之上，**桌面版带真实文件系统能力**：agent 生成的文件会真正写入本机磁盘（含写入前人机确认）、项目可自定义保存目录或直接从磁盘文件夹打开、文件查看页可浏览真实文件内容 —— 见「[文件系统能力（桌面版）](#文件系统能力桌面版)」。

## 下载与安装（桌面版）

Polaris 提供 Windows / macOS 桌面安装包，**无需任何开发环境**：

1. 打开 [Releases](https://github.com/ExtraZhangYC/Polaris/releases) 页面
2. 下载对应平台的安装包：
   - **Windows** → `Polaris-<版本>-win-x64.exe`
   - **macOS**（Apple Silicon）→ `Polaris-<版本>-mac-arm64.dmg`
3. 双击安装并启动
4. **在设置里填一个 API key** —— 然后就能用了

**coding agent 随包分发**：Claude Code 的本体（平台专属原生二进制）已经打进安装包里，
你**不需要**另外安装 Claude Code、Node.js、npm/npx，也不需要联网现拉任何东西。
安装包因此比较大（Windows ≈ 178 MB，其中 agent 本体就占 226 MB 未压缩）。

装完只差一个凭据：设置 → 填入对应 agent 的 API key（`claude` → Anthropic API key）。
key 存在本机 userData 下（权限 0600），只进主进程、不回传渲染层、不进日志。

> **未签名构建**。Windows 首次运行 SmartScreen 会拦，点「更多信息 → 仍要运行」；
> macOS 提示「无法验证开发者」时，在 `系统设置 → 隐私与安全性` 点「仍要打开」，或右键图标选「打开」。
>
> macOS 只提供 **Apple Silicon (arm64)** 版本：随包的 agent 是平台专属原生二进制，
> universal 壳配单架构后端会在另一半机器上直接起不来，所以不再出 universal 包。
>
> 打包版只支持走 stdio 的 **ACP 协议 agent**（claude / gemini / codex 等）。
> 需要 PTY 的 agent（如 aider）未随包提供 —— 见 `scripts/stub-node-pty.cjs` 里的说明。

## 规范对齐（Single Source of Truth）

| 规范文档                             | 用途                                                                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `api/前端字段清单.json`              | 每个节点前端可拿到的 `decided`（已定）/ `tbd`（待定）字段、11 个核心 `TaskStatus`、Gate `allow/deny/ask/defer` → 状态落点、14 个标准事件 |
| `api/需求到处理-全流程图与状态机.md` | 端到端流程图、Task 主状态机、合并边界、Checkpoint、Council 状态机                                                                        |

术语约定：**英文规范术语 + 中文释义**（如 `running · 执行中`、`verdict=select`）。
当后端字段冻结/变更时，只需同步更新 `src/data/workflow.ts` 各节点的 `decided` / `tbd` / `events`。

### N0–N18 主链路与责任方

7 条泳道 = 责任方分区：**User · 用户 / 前端** ／ **C · 协调编排** ／ **B · 角色记忆** ／ **A · Driver 执行** ／ **D · Hook/Gate** ／ **Council · 议会** ／ **Merger · 合并边界**。

```
N0 需求到达 → N1 分诊 → N2 创建 Task → N3 创建 Run → N4 认领 → N5 ContextPack
   → N6 启动 Driver → N7 执行中 → N8 Driver 结果 → N9 注册 Artifact → N10 task.completed
   → N11/12 Hook+GateRequest → N13 Gate 决策 →(defer) N14 Council → N15 合并授权
   → N16 Checkpoint → N17 合并边界 → N18 Run 完成
```

- **N13 Gate** 展示 `allow/deny/ask/defer` 四分支 → 状态落点映射；demo 走 `defer → Council`（权限策略分歧）。
- **N14 Council** 产出 `CouncilDecision`：`verdict ∈ {select, needs_human, request_revision, reject}` + `evidence_refs` + `risk_signals`；仅 `select`（delegated 模式）会生成 `MergeAuthorization` 继续主链路。
- **Node Inspector** 展示每个节点的编号、责任方、冻结度（🟢frozen / 🟡partial / 🔴tbd / reserved）、`TaskStatus`、Gate 分支、`decided` / `tbd` 字段表、emit 事件。

### 方向冻结状态与对齐策略

原则：**已冻结的字段直接按规范字段名对齐；未冻结的先 mock 并在 UI 上标注**（🟢 已对齐 / `mock · 待冻结`）。

| 方向            | 负责对象（节点）                                                                                                         | 冻结度     | 前端策略                                                                                  | 体现位置                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **C**           | Task / Run / Event / ArtifactRef / Checkpoint / MergeAuthorization（N2/N3/N4/N9/N10/N15/N16/N18）                        | 🟢 frozen  | 直接对齐字段名                                                                            | Task Board 节点 + Node Inspector `decided`      |
| **D**           | HookResult / GateRequest / GateResult（N11/N12/N13）                                                                     | 🟢 frozen  | 直接对齐；展示 `allow/deny/ask/defer` → 状态落点                                          | N13 Gate Inspector                              |
| **C / Council** | CouncilDecision（N14：`verdict` / `selected_proposal_id` / `evidence_refs` / `risk_signals`）                            | 🟡 partial | 已定字段对齐；N-way Diff / PPC 可视化后置（mock/暂无）                                    | Council Board                                   |
| **A**           | Driver（N6/N7/N8）                                                                                                       | 🟡 partial | `DriverRunResultForCoordination` 入口对齐；`tool_events` / `budget_usage` / 实时进度 mock | N6–N8 Inspector `tbd`                           |
| **B**           | 角色画像 / 技能 / 经验（N5：`role_profile_id`、`capability_tags`）                                                       | 🟡 partial | 已定的 `role_profile_id` / `capability_tags` 对齐                                         | Agent Board · `capability_tags`                 |
| **B**           | Agent 画像 schema / 绩效指标（`AgentMetrics`、`persona_ref` / `skill_refs` / `experience_refs`）                         | 🔴 tbd     | **全部先 mock**，标注「mock · 待 B 冻结」                                                 | Agent Board · 核心指标 / 技能 / 协作 / 最近任务 |
| **User / 前端** | 需求文本 / 分诊结果（N0/N1）                                                                                             | 🔴 tbd     | 按「文本 + 可选元信息」mock，留扩展位                                                     | N0/N1 Inspector `tbd`                           |
| **B / N4**      | AgentRecord 身份（`agent_id` / `role_id` / `driver_id` / `session_id` / `worktree_id` / `last_heartbeat`）+ `file_lease` | 🟢 frozen  | 直接对齐字段名                                                                            | Agent Board · Identity & Runtime / file_lease   |

> Agent Board 上 **🟢 已对齐** 的区块来自字段清单已冻结字段；标 **`mock · 待 B 冻结`** 的区块属于 B 方向尚未冻结的画像/指标域，等 B 正式 Spec 冻结后再对齐到 `AgentMetrics`。

## 文件系统能力（桌面版）

Web 版全程 mock；桌面版（Electron）在同一份 UI 之上接通了真实文件 I/O，语义对齐 A 方向的 ACP 文件方法（`fs/write_text_file` = mkdir -p + 覆盖写，无独立 create）：

- **Agent 生成文件真实落盘**：任务推进到 N7 执行段时，`gate:allow` 的写操作自动写入磁盘；带权限请求的写操作挂起，等你在文件操作面板里点「允许」后才落盘（拒绝则不写）。每条写操作下方有落盘回执（写入中 / 已写入 + 绝对路径 / 失败原因），点路径可在系统文件管理器中定位；写成功的文件同步挂进左侧项目文件树。
- **自定义保存位置**：新建项目时可选保存文件夹；缺省写入 `文档/polaris-workspace/<项目名>/`。
- **从文件夹打开项目**：启动页「打开项目」内选择本机目录，自动扫描为项目文件树（跳过 `node_modules`/`.git`/`dist` 等，深度 8 / 2000 条护栏）；同一目录再次打开会切回已有项目。
- **启动停留在首页**：后台恢复历史任务只更新观测数据，不自动选择旧项目或任务，也不覆盖启动期间用户已打开的页面和输入的草稿。进入项目必须由用户选择；已有实例运行时再次点击快捷方式仍会聚焦该窗口，不中断当前工作。
- **续跑与交付以 Task 为准**：等待协作回复时，一个 Run 可以结束，但需求尚未交付。前端持续刷新 `task.get` 并跟随新的 `current_run`，不会停在第一段已结束的 Run；等待期间也不允许跨项目绑定重启后端。只有写入用户项目目录的交付路径进入文件列表，审查临时目录不算交付。
- **保存执行 Trace**：侧栏项目行的 Trace 按钮把 agent 执行审计快照（任务时间线 / 人机确认 / 落盘回执 / 事件观测窗口）存为 JSON —— 桌面版写入项目根目录 `.polaris/`，浏览器回退为下载。Trace 是只读复盘材料，不支持导回应用。
- **文件查看页**：点文件树中的文件即可只读浏览。内容来源按可信度降级：磁盘真实内容（`DISK` 徽标）→ agent 生成内容（`AGENT` 徽标，未落盘时的回退）→ 演示占位；落盘完成后自动从 AGENT 切到 DISK。
- **交付文件自动回填文件树**：以快照的 `delivery_report.files_written` 为主，兼容 `final_output.files_written` 与旧版 diff 制品路径；即使没有 diff 制品或完整图数据，也会显示后端确认已写入的文件。路径按提交时后端确认的工作区解析，支持 Windows 反斜杠与嵌套目录，不把后端审计目录误放进项目树。

安全模型：渲染进程**无法凭空指定任意磁盘路径**。自定义目录必须经过主进程的原生目录选择器（选择即授权，进入会话级 `authorizedRoots`）；默认工作区之外未经授权的路径，写入 / 读取 / 扫描 / 定位一律被主进程拒绝，授权目录内部也拒绝 `..` 逃逸。预览另有 512KB 大小与二进制两道护栏。实现见 `electron/fsBridge.cjs`（IPC）与 `src/lib/agentFs.ts`（渲染层适配）。

> 边界立场不变：真实后端下文件读写由 **A（Driver/ACP 客户端）** 执行，前端（E）只观测、渲染、接住人机确认；mock 演示里由桌面壳代 A 落盘，不构成对后端的新契约诉求（`FileOpObservation.content` 镜像的是 A 本就有的 `content` 入参）。

## 真实 Run 的投影

界面上与运行有关的一切**只来自后端**：`run.event` 状态事件流与 `run.getSnapshot` 快照（运行中定期刷新，终态再次对齐），
由 `src/lib/liveReplay.ts` 与 `src/lib/eventGraph.ts` 程序化派生——后端给什么展示什么，前端不补写叙事：

- **步骤由事件生成**：泳道图/步骤轨的节点是「事件 → 语义步骤」的投影（`eventGraph.STEPS`），
  没触发的步骤压根不出现，不预设条数、不画灰色待办；
- **协议节点由事件点亮**：N0–N18 的状态由时间线纯函数重建（`src/lib/protocolFlow.ts`）；主句优先显示 `activity` 的真实角色/工具状态，再使用 `current.cursor` 的精确阶段，不把粗粒度 `stage` 当作具体进度；
- **文案取事件 payload 原文**，时间戳只在后端给了的地方显示，不插值；
- **契约有但本次 run 没给的不虚构**：无 tool_events → 不显示文件操作流；无 Council 数据 → 合议页空态。

### 运行观测接口

已对齐 `frontend-run-observability-api.md` 描述的接口（上游 `9582f358`），只同步相关观测实现，保留本地代理与 PGlite 适配：

| 接口 / 字段                             | 前端用途                                                           |
| --------------------------------------- | ------------------------------------------------------------------ |
| `run.getUsage`                          | 「用量」折叠项中按 run / task / system / role 查询历史累计         |
| `run.getEvents`                         | 断号、重连时补拉事件；补拉不设 `limit`，避免并列序号被分页边界截断 |
| `run.getPayload`                        | 事件流展开后，按 `event.payload.payload_ref` 按需读取完整载荷      |
| `run.subscribe.after_sequence`          | 为运行中的 run 按快照水位重订阅，不丢并发订阅；历史终态只恢复快照  |
| `usage` / `activity` / `current.cursor` | 运行中每 2 秒刷新，终态短暂复查结算后停止轮询                      |

计费 token、上下文占用和分阶段代理用量**分别显示、互不相加**。运行中的 `pending_sources` 明示执行器账单尚待结算；缺失用量或耗时不显示成 0。`activity` 缺失不解释为「空闲」，陈旧状态明确提示。

三条 run 通道的同一事件使用同源 `sequence`，但序号可以并列：时间线按后端数组顺序展示、按 `event_id` 去重。连接中断不会被当作执行失败；重连后补拉快照并重建订阅。`-32601` 显示后端版本限制，`-32017` 显示载荷已不可读取，均不伪造空内容。

Task 快照携带可选的 `task.workspace_path`，始终是该需求的用户项目目录；启动恢复时按此路径关联项目与历史任务，但仍停留首页。Mailbox 续跑的 `run.workspace_path` 可能是角色会话绑定的审查目录，不能拿它作为最终交付落点；阶段上下文通过独立的 `delivery_workspace_path` 保持原项目目标不变。

浏览恢复的项目不触发后端重启。默认工作区的直属项目目录，无论通过项目名还是绝对路径访问，都使用同一默认权限边界；自定义目录在新会话中仍需经原生目录选择器授权，历史元数据不会自动授予磁盘访问权限。

> 启动页曾有一个「样例 · Run 回放」入口，加载仓库自带的落盘快照（`api/run_be712da2….zip`）。
> 它连同其余面向用户的 mock 数据在 `daaa45d` 一并删除——提交后端失败时亮出一整套假的交付报告，
> 用户会当成真发生过。契约镜像类型 `src/api/types/snapshot.ts` 保留作文档。

## 真实后端（A + BCD）

三个仓库已并成一个 pnpm workspace（`git subtree`，保留上游历史，可 `git subtree pull` 拉更新）：

| 包                    | 上游                           | 方向      | 职责                                       |
| --------------------- | ------------------------------ | --------- | ------------------------------------------ |
| `packages/acp-client` | `DWangSE/acp-client-prototype` | **A**     | ACP 客户端 / Driver：真正拉起 coding agent |
| `packages/newide-bcd` | `Neighhhbor/newide-scaffold`   | **B/C/D** | 记忆 · 协调编排/Council · Hook/Gate        |
| 根仓（`src/`)         | 本仓                           | **E**     | 前端：观测、渲染、人机交互                 |

### 进程链

```
Electron renderer (React = E)
   │  window.desktop.backend.*        ← IPC（electron/backendBridge.cjs）
Electron main
   │  行分隔 JSON-RPC over stdio
BCD 后端（coordinator / council / gate / memory）
   │  每个 prompt 拉起一次子进程：DriverPrompt → DriverRunResult
A（ACP runner）
   │  spawn
真实 agent CLI（claude / gemini / codex …）
```

**A ↔ BCD 仍走上游 Driver 契约**：BCD 通过 `ACP_DRIVER_RUNNER_DIR` 把 A 当外部 driver 拉起。
前端通过 BCD 一个入口调用 `run.*`、`task.*`、`memory.*` 等 RPC，事件由 `run.event` / `task.event` 推送。Electron IPC 与本地 Web bridge 共用 `electron/backend-rpc-methods.json` 方法白名单。

契约镜像见 `src/api/types/rpc.ts` 与 `src/api/types/observability.ts`（对齐 BCD 的 `frontend-workflow.v0.1`），传输选路见 `src/api/transport.ts`。本轮 `run.*` 接口尚未登记到后端 `system.schema` / 能力表，不能靠能力表判断它们是否存在。

多账号模型网关通过 Base URL 的路径前缀选择账号，例如 `http://127.0.0.1:4143/accounts/<alias>`。模型发现和 B / Driver 调用都会保留此前缀；不要误填网关根地址而切到默认账号。账号返回 401 / 403 时应修复该账号的授权或上游访问，不自动换用其他账号。

### 跑起来

桌面壳启动时会自动拉起 BCD（主进程负责，无需手动启后端）。打开项目时，agent 的工作区自动绑到该项目根目录 —— **agent 写进哪里 = 文件树读哪里**。

```bash
pnpm install
pnpm electron:dev      # 后端随桌面壳自动启动
```

顶栏事件指示灯：`LIVE` = 后端已就绪；`LOCAL` = 无后端（mock 兜底）；`OFFLINE` = 后端挂了。

**选 agent**（默认 `claude`）与**配密钥**：

```bash
export ACP_AGENT_ID=claude            # 或 gemini / codex / opencode …
# 密钥写进 A 的 .env，BCD 会读取并注入 driver 子进程：
#   packages/acp-client/.env  →  ANTHROPIC_API_KEY=... / GEMINI_API_KEY=... 等
```

> agent CLI 由 A 通过 `npx` 拉起。**这也意味着打包分发还不可行**（打包后的 Electron 里没有 `npx`/`node`）—— 当前真实后端仅在开发环境可用。

### 当前能力边界（诚实说明）

- **可以**：真实提交需求 → agent 真实写代码 → 前端实时收到 22 个流程事件（N0–N18 节点态、Gate 结果、Council 决策、交付报告）。
- **可以**：A 会以解析符号链接后的真实路径约束工作区、终端 cwd 与可继承环境变量；BCD 已接入持久 Mailbox、Plan-first Council、Skill 审批、Persona 演化和 Gate 输出解析。
- **不可以**：**人类无法真正挡住 agent**。BCD 目前只暴露「创建」和「取消」，Council 由 `proposer/reviewer/synthesis` 几个 agent 角色自己裁决（`can_create_merge_authorization` 恒为 `false`），A 那边权限请求也是自动批准的。
  前端的 Intervene / Council 裁决按钮仍可用，但**只改前端本地状态、不回写后端**。
  扩展位已留好：待 BCD 补上 `gate.submitDecision` / `council.submitVerdict` 之类的方法，只需在 `src/api/transport.ts` + `client.ts` 各加一个薄封装，**UI 层一行都不用改**（`map.ts` 里 UI→契约的裁决映射已经写好）。
- **前端仍不展示 token 级流式正文**：A 已保留回复正文、内联产物及完整 Driver 事件；BCD 会实时投影 turn/tool 生命周期并持久化完整事件审计，但 agent 消息 chunk 尚未投影成前端 `run.event`。**节点级进度推进与工具生命周期是真实且实时的**。

## 技术栈

- Vite + React + TypeScript
- Tailwind CSS（暗色 "Command Console" 风格）
- @xyflow/react（Task Board 泳道图）
- Zustand（Demo 状态机，按领域拆分为六个 slice）
- lucide-react（图标）
- Electron（桌面壳，Windows / macOS；渲染层复用同一份 React 应用，文件系统能力经 contextBridge + IPC 提供）
- Vitest（store 集成测试：落盘链路 / 项目打开 / 文件查看页导航）

## 启动方式

需要 **Node 22.22.1+ 与 pnpm 11+**（由 `packages/acp-client` 与 `packages/newide-bcd` 的 engines 约束；仓库带 `.nvmrc`，可直接 `nvm use`）：

```bash
pnpm install       # 首次运行（workspace，会一并装 A / BCD 的依赖）
pnpm dev           # http://localhost:5173/（Web 版：无桌面桥 → 后端与文件能力均降级为 mock）
```

构建生产版本：`pnpm build`，预览：`pnpm preview`；提交前自检：`pnpm verify`（前端 lint/typecheck/vitest、Electron/打包脚本回归与设计规范检查）。
全量自检（含 A / BCD）：`pnpm -r verify`。

> 若本机未全局安装 Node，项目可能内置一份本地运行时（`.node/`）。此时可运行 `./start.sh`，或先 `export PATH="$PWD/.node/bin:$PATH"` 再执行上面的命令。

## 桌面开发与发布

Web 版之上封装了 Electron 桌面壳，渲染层复用同一份 React 应用。

开发调试（Vite 热更 + 原生窗口 + DevTools）：

```bash
pnpm electron:dev
```

本地打包安装包（产出到 `release/`）：

```bash
pnpm electron:build:win    # Windows（需在 Windows 上，或配 wine）
pnpm electron:build:mac    # macOS（需在 Mac 上）
pnpm electron:build:dir    # 当前系统的免安装解包版，快速自测
```

> Linux/WSL 下运行需要 GUI 依赖库（`libnspr4 libnss3 libgbm1 libgtk-3-0 …`）。也可直接在原生 Windows / Mac 上开发。

### Windows 本地免安装版：更新并自动清理旧版

本项目的本地免安装版统一通过以下流程交付，不再手工往桌面累积多个旧包：

```bash
pnpm electron:portable:win
```

此命令构建 Windows x64 后端与**目录式免安装版**，一次复制到实际 Windows 桌面的 `Polaris-portable-x64/`，逐文件校验后更新「Polaris-免安装版」快捷方式，直接启动目录内的 `Polaris.exe`。单文件 NSIS portable 每次启动都完整解压、退出时又删除展开目录；日常使用不再走这个入口，也不需要安装或修改系统注册表。

已有目录版正在运行时会拒绝覆盖，需先退出；复制或快捷方式切换失败会保留旧版。首次从单文件版迁移时，可先放好新目录并切换快捷方式，不会强杀旧窗口；退出旧版、通过快捷方式启动新版后，会按交付清单和校验值自动清除旧桌面包及旧快捷方式。

清理仅针对同架构、不高于当前版本的已确认旧包。程序目录包含逐文件交付清单，更新前若发现自行添加或修改的文件会拒绝覆盖，不猜测其归属；请将项目保存在程序目录之外。配置、项目、B Memory、其他架构/更高版本包及仓库构建缓存均不在清理范围内。目录版不调用面向安装版的自动更新器，本地更新统一走此发布流程。

已经构建好的包可单独交付并触发相同的清理：

```bash
pnpm portable:deploy release/portable/win-unpacked
```

脚本兼容 Windows 和 WSL，通过系统接口定位实际 Windows 桌面。流程使用 `--publish never`，不会向 GitHub 上传本地测试包；回归检查为 `pnpm test:packaging`。仍可显式传入旧式 `Polaris-<version>-win-<arch>-portable.exe` 单文件包，但这种交付要求先退出所有 Polaris 实例，且启动时仍需完整解压。

### 发布新版本（自动出安装包）

安装包由 GitHub Actions 自动构建：**推送一个 `v*` 标签**即触发 `.github/workflows/release.yml`，在 Windows / macOS runner 上打包并上传到对应的 GitHub Release。

```bash
npm version patch          # 0.1.0 → 0.1.1，自动提交并打 v0.1.1 标签
git push --follow-tags     # 推送提交 + 标签，触发 Release 工作流
```

跨平台构建全部交给 CI，本地不需要 Mac 也能出 macOS 版；代码签名 / 公证暂未启用（MVP 阶段）。

## 页面

| 页面             | 作用                             | 关键交互                                                                                                                                              |
| ---------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project Launcher | 启动页 · 项目入口                | 新建项目（可自选保存位置）、打开项目（已有项目列表 + **从文件夹打开**，同一入口）                                                                     |
| Agent Board      | 组建 AI 团队                     | 查看 Agent 档案与 **Identity & Runtime（N4/N6 字段：agent_id / role_id / driver_id / session_id / file_lease / capability_tags）**、Assign to Project |
| Task Board       | 可观察、可介入的 N0–N18 执行地图 | Start Task → 需求分析 → 推荐 Workflow → Next Step / Auto Run → 在 N7 Intervene / 确认写入权限 → Node Inspector                                        |
| Council Board    | 基于证据组装 CouncilDecision     | 对比三方案、选择 `verdict`、查看 `evidence_refs` / `risk_signals`、提交 select                                                                        |
| File Viewer      | 只读文件查看                     | 点侧栏文件树打开；DISK / AGENT 内容来源徽标、行号视图、文件管理器定位                                                                                 |

## 推荐演示路径

1. **启动页**：新建项目（桌面版可自选保存位置），或「打开项目 → 从文件夹打开」一个本机目录；也可点 **「样例 · Run 回放」** 直接加载后端真实 run（贪吃蛇游戏，见上节）逐步回放
2. **Agent Board**：查看 `Backend Eng A` 详情（含 Identity & Runtime / file_lease / capability_tags），依次 Assign `Backend Eng A` / `Test Agent` / `Security Audit Agent`（≥3 人 → 团队就绪）
3. 切到 **Task Board**，使用默认任务，点击 **Start Task** → 查看需求分析
4. 点击 **Use Recommended Workflow** → 沿 7 条 Lane 生成 N0–N18 全链路泳道图
5. **Next Step / Auto Run** 逐步推进；点击任意节点查看 Node Inspector（含 decided/tbd 字段与事件）
6. 推进到 **N7 Executing** → 文件操作面板出现读/写/建流水，`gate:allow` 的写操作自动落盘（桌面版）；`permissionMatrix.ts` 挂**写入前人机确认**（暖琥珀色）→ 点「允许本次」→ 落盘回执显示绝对路径；也可点击 **Intervene** 注入 Admin 规则 → 下游 N13/N15/N18 标记「已被介入」
7. 在左侧文件树点击刚生成的文件（如 `src/auth/permissionService.ts`）→ **File Viewer** 查看真实磁盘内容（`DISK` 徽标）
8. 推进到 **N13 Gate**（decision=defer）→ **Go to Council** → 在 Council Board 选择 `verdict=select` → 采纳 `option-a · Use RBAC`
9. 返回 Task Board，推进到 **N18 Run Complete** → **View Delivery Report**
10. 侧栏项目行点 **Trace 按钮** → 执行审计快照写入项目 `.polaris/` 目录（浏览器为下载）
11. **Reset Demo** 可随时一键重置

## 目录结构

```text
api/                          # 后端协作链路规范（字段清单 + 流程图/状态机）— UI 的对齐基准
packages/
├── acp-client/               # 方向 A（subtree ← DWangSE/acp-client-prototype）：ACP 客户端 / Driver
└── newide-bcd/               # 方向 B/C/D（subtree ← Neighhhbor/newide-scaffold）：记忆 / 协调 / Hook·Gate
electron/                     # 桌面壳
├── main.cjs                  #   主进程（窗口 + 各桥注册）
├── preload.cjs               #   contextBridge：window.desktop（fs / backend / updates）
├── fsBridge.cjs              #   文件系统 IPC（写入/读取/目录选择/扫描/定位 + 授权模型）
├── backendBridge.cjs         #   BCD 后端桥：拉起子进程 + JSON-RPC/stdio 客户端 + IPC 转发
└── updater.cjs               #   自动更新（electron-updater + GitHub Releases）
src/
├── App.tsx / main.tsx / index.css
├── types/                    # 全局 UI 类型（index.ts）+ 桌面桥类型（desktop.d.ts）
├── api/                      # 后端接入层
│   ├── types/rpc.ts          #   BCD 最新 RPC 契约镜像（frontend-workflow.v0.1）
│   ├── types/*               #   其余契约镜像（A/B/C/D 实体形状）
│   ├── transport.ts          #   传输选路（Electron IPC / mock）+ 未来人类回写的扩展位
│   ├── client.ts             #   run.create / getSnapshot / cancel
│   ├── events.ts             #   run.event 订阅（按 event_id 去重，吸收订阅时的历史重放）
│   └── map.ts                #   UI 词表 ↔ 契约枚举 的防腐层
├── store/
│   ├── useDemoStore.ts       # Zustand store 组装 + 事件通道接线
│   ├── slices/               # 六个领域切片：project / team / task / execution / intervention / terminal
│   ├── lib/                  # 跨切片纯函数（taskSync / agentWrites 落盘调度 / fileTree / timeline …）
│   └── agentWrites.test.ts   # 落盘链路集成测试（vitest）
├── data/                     # 全部 mock data（workflow.ts = N0–N18 节点定义；fileops.ts = N7 文件操作剧本）
├── pages/                    # ProjectLauncher / AgentBoard / TaskBoard / CouncilBoard / FileViewer
├── components/               # AppShell / WorkflowCanvas / NodeInspector / FileOpsPanel / DeliveryReport ...
└── lib/                      # utils / agentFs（桌面文件桥适配层）/ projectFile ...
```
