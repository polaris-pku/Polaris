# HCI IDE MVP · AI 工程团队驾驶舱

一个**可演示的 Web 交互原型**：把「与单个 AI 聊天」升级为「像管理一支 AI 工程团队一样完成开发任务」。

本项目是 **Scripted IDE Simulator**（假 IDE + 真实交互 + 预设 Agent 剧情）：不接真实 LLM / Agent / Git / 代码执行，演示流程稳定、可重复、可一键重置。

> 界面已对齐后端协作链路规范：Task Board 完整建模 **N0–N18 端到端主链路**与 **11 态协调器状态机**，字段、状态、Gate 决策、事件均取自 `api/` 下的规范文档。

在 mock 剧本之上，**桌面版带真实文件系统能力**：agent 生成的文件会真正写入本机磁盘（含写入前人机确认）、项目可自定义保存目录或直接从磁盘文件夹打开、文件查看页可浏览真实文件内容 —— 见「[文件系统能力（桌面版）](#文件系统能力桌面版)」。

## 下载与安装（桌面版）

HCI IDE 提供 Windows / macOS 桌面安装包，**无需任何开发环境**：

1. 打开 [Releases](https://github.com/ExtraZhangYC/hci-ide-mvp/releases) 页面
2. 下载对应平台的安装包：
   - **Windows** → `HCI-IDE-<版本>-win-x64.exe`
   - **macOS**（Apple Silicon）→ `HCI-IDE-<版本>-mac-arm64.dmg`
3. 双击安装并启动

> macOS 当前为**未签名**构建。首次打开若提示「无法验证开发者」，在 `系统设置 → 隐私与安全性` 点「仍要打开」，或右键应用图标选「打开」即可。

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
- **自定义保存位置**：新建项目时可选保存文件夹；缺省写入 `文档/hci-ide-workspace/<项目名>/`。
- **从文件夹打开项目**：启动页「打开项目」内选择本机目录，自动扫描为项目文件树（跳过 `node_modules`/`.git`/`dist` 等，深度 8 / 2000 条护栏）；同一目录再次打开会切回已有项目。
- **保存执行 Trace**：侧栏项目行的 Trace 按钮把 agent 执行审计快照（任务时间线 / 人机确认 / 落盘回执 / 事件观测窗口）存为 JSON —— 桌面版写入项目根目录 `.hci/`，浏览器回退为下载。Trace 是只读复盘材料，不支持导回应用。
- **文件查看页**：点文件树中的文件即可只读浏览。内容来源按可信度降级：磁盘真实内容（`DISK` 徽标）→ agent 生成内容（`AGENT` 徽标，未落盘时的回退）→ 演示占位；落盘完成后自动从 AGENT 切到 DISK。

安全模型：渲染进程**无法凭空指定任意磁盘路径**。自定义目录必须经过主进程的原生目录选择器（选择即授权，进入会话级 `authorizedRoots`）；默认工作区之外未经授权的路径，写入 / 读取 / 扫描 / 定位一律被主进程拒绝，授权目录内部也拒绝 `..` 逃逸。预览另有 512KB 大小与二进制两道护栏。实现见 `electron/fsBridge.cjs`（IPC）与 `src/lib/agentFs.ts`（渲染层适配）。

> 边界立场不变：真实后端下文件读写由 **A（Driver/ACP 客户端）** 执行，前端（E）只观测、渲染、接住人机确认；mock 演示里由桌面壳代 A 落盘，不构成对后端的新契约诉求（`FileOpObservation.content` 镜像的是 A 本就有的 `content` 入参）。

## 技术栈

- Vite + React + TypeScript
- Tailwind CSS（暗色 "Command Console" 风格）
- @xyflow/react（Task Board 泳道图）
- Zustand（Demo 状态机，按领域拆分为六个 slice）
- lucide-react（图标）
- Electron（桌面壳，Windows / macOS；渲染层复用同一份 React 应用，文件系统能力经 contextBridge + IPC 提供）
- Vitest（store 集成测试：落盘链路 / 项目打开 / 文件查看页导航）

## 启动方式

需要 Node 20+ 与 pnpm 9+：

```bash
pnpm install       # 首次运行
pnpm dev           # http://localhost:5173/（Web 版，文件能力自动降级为 mock）
```

构建生产版本：`pnpm build`，预览：`pnpm preview`；提交前自检：`pnpm verify`（lint + typecheck + vitest）。

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

1. **启动页**：新建项目（桌面版可自选保存位置），或「打开项目 → 从文件夹打开」一个本机目录
2. **Agent Board**：查看 `Backend Eng A` 详情（含 Identity & Runtime / file_lease / capability_tags），依次 Assign `Backend Eng A` / `Test Agent` / `Security Audit Agent`（≥3 人 → 团队就绪）
3. 切到 **Task Board**，使用默认任务，点击 **Start Task** → 查看需求分析
4. 点击 **Use Recommended Workflow** → 沿 7 条 Lane 生成 N0–N18 全链路泳道图
5. **Next Step / Auto Run** 逐步推进；点击任意节点查看 Node Inspector（含 decided/tbd 字段与事件）
6. 推进到 **N7 Executing** → 文件操作面板出现读/写/建流水，`gate:allow` 的写操作自动落盘（桌面版）；`permissionMatrix.ts` 挂**写入前人机确认**（暖琥珀色）→ 点「允许本次」→ 落盘回执显示绝对路径；也可点击 **Intervene** 注入 Admin 规则 → 下游 N13/N15/N18 标记「已被介入」
7. 在左侧文件树点击刚生成的文件（如 `src/auth/permissionService.ts`）→ **File Viewer** 查看真实磁盘内容（`DISK` 徽标）
8. 推进到 **N13 Gate**（decision=defer）→ **Go to Council** → 在 Council Board 选择 `verdict=select` → 采纳 `option-a · Use RBAC`
9. 返回 Task Board，推进到 **N18 Run Complete** → **View Delivery Report**
10. 侧栏项目行点 **Trace 按钮** → 执行审计快照写入项目 `.hci/` 目录（浏览器为下载）
11. **Reset Demo** 可随时一键重置

## 目录结构

```text
api/                          # 后端协作链路规范（字段清单 + 流程图/状态机）— UI 的对齐基准
electron/                     # 桌面壳
├── main.cjs                  #   主进程（窗口 + 各桥注册）
├── preload.cjs               #   contextBridge：window.desktop（fs / updates）
├── fsBridge.cjs              #   文件系统 IPC（写入/读取/目录选择/扫描/定位 + 授权模型）
└── updater.cjs               #   自动更新（electron-updater + GitHub Releases）
src/
├── App.tsx / main.tsx / index.css
├── types/                    # 全局 UI 类型（index.ts）+ 桌面桥类型（desktop.d.ts）
├── api/                      # 后端契约的前端镜像（types/*）+ 词表桥接（map.ts）+ 事件通道（events.ts）
├── store/
│   ├── useDemoStore.ts       # Zustand store 组装 + 事件通道接线
│   ├── slices/               # 六个领域切片：project / team / task / execution / intervention / council
│   ├── lib/                  # 跨切片纯函数（taskSync / agentWrites 落盘调度 / fileTree / timeline …）
│   └── agentWrites.test.ts   # 落盘链路集成测试（vitest）
├── data/                     # 全部 mock data（workflow.ts = N0–N18 节点定义；fileops.ts = N7 文件操作剧本）
├── pages/                    # ProjectLauncher / AgentBoard / TaskBoard / CouncilBoard / FileViewer
├── components/               # AppShell / WorkflowCanvas / NodeInspector / FileOpsPanel / DeliveryReport ...
└── lib/                      # utils / agentFs（桌面文件桥适配层）/ projectFile ...
```
