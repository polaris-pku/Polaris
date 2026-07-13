# 协议参考

这一页是给要看后端日志的人的。主界面上不会再出现这些编号和字段名 —— 它们有价值，只是不该占着你每天都要看的那块屏幕。

想看某一次 run 的原始事件，去 Dock 的「事件流」频道：那里是全应用唯一渲染事件原文的地方。

（正文里没有表格 —— 帮助抽屉只认七种块：标题、小标题、段落、无序表、有序表、代码块、引用。栏宽 396px，表格在这里必然折行。）

## 事件与阶段

后端一次 run 会发出 20 余条事件，但人真正关心的只有七件事。所以界面不做「一个事件一个节点」，而是把事件汇聚成语义步骤。

下面这七步与 `src/lib/eventGraph.ts` 里的 `STEPS` 同源 —— 改了那张表却忘了改这一页，`src/docs/docs.test.ts` 会红。

### 需求受理

阶段：受理。汇聚：`task.created` · `run.created` · `run.started`。

### 分派与上下文

阶段：执行（机器握手，默认折叠）。汇聚：`memory.context_pack_built` · `driver.session_started` · `mailbox.message_sent` · `mailbox.message_acked`。

### Agent 执行

阶段：执行。汇聚：`agent.execution_requested` · `agent.execution_completed` · `agent.execution_failed`。

这一步是一个跨度（requested → completed / failed）。未闭合时界面上跑的是实时秒表 —— 后端在 agent 干活的那十几秒里一个事件都不发，没有秒表，界面在最关键的时段是死的。

### 产出

阶段：执行。汇聚：`driver.run_result` · `artifact.registered`，以及 `message_type` 为 `driver.completed` 的那条信箱事件。

### 审查

阶段：审查。汇聚：`task.completed` · `hook.matched` · `gate.requested` · `gate.result`。

### 议会

阶段：审查。汇聚：`council.started` · `council.decision` · `council.completed`。单 agent 模式下这一步永不触发。

### 交付

阶段：交付。汇聚：`artifact.selected` · `worktree.materialized` · `checkpoint.saved` · `coord.checkpoint_observed` · `run.completed` · `run.failed` · `run.cancelled`。

### 三条规则

- 一个步骤只有在有事件佐证时才存在：没触发的步骤压根不出现。
- 未登记的事件类型不丢弃、不编造：归进「审查」，原文照样能在事件流里逐条查到。
- 未闭合的跨度就是「正在进行中」，不是「卡住了」。

### 字段陷阱：files_written

同一个名字，两种形状，看你从哪儿读：

- `RunEvent('worktree.materialized').payload.files_written` 是一个数字（文件数量）。
- `RunSnapshot.delivery_report.files_written` 是一个字符串数组（文件路径）。

快照到了就用数组的长度；快照还没到，就直接把那个数字当数量用。

## Gate 与合议

Gate 的结论只有四个分支（方向 D 的 `GateDecision`）：

- `allow` —— 放行。无感：run 继续往下走。
- `deny` —— 拒绝。run 失败，主句转为失败色。
- `ask` —— 需要人明确同意。运行状态转「需要你」。
- `defer` —— 挂起，等人裁决。同上。

只有 `ask` 与 `defer` 意味着「停下来，这里需要人」。这也是界面上暖色唯一的语义 —— 全屏最多一处。

> 当前版本只如实呈现 Gate 的结论，不提供在界面里回应 Gate 的按钮（后端的 `gate.respond` 尚未接通）。一个没有 onClick 的按钮比没有按钮更坏。

议会（合议）是 Gate 之后的可选一步：多个提案 → 一次裁决 → 选中的方案进入合并。

## 字段冻结度

契约里的每个字段都带一个冻结度（`FrozenLevel`），它说的是「这个字段现在能不能直接对接」：

- `frozen` —— 已冻结，可直接对接。
- `partial` —— 部分待定，形状可能还会动。
- `tbd` —— 尚未冻结。
- `reserved` —— 后置，本期不实现。

界面的取数规则只有一条 —— 只渲染后端真的给过的字段。契约里有、这次 run 没给的（FileLease、tool_events、Gate decision……）一律不虚构占位值。

## 节点编号

后端主链路的节点编号。日志里、事件的 `source` 里、以及后端同学的口头语里会用到它们。

- `N0` 需求到达 —— 用户
- `N1` 分诊 —— 调度
- `N2` 创建 Task —— 调度
- `N3` 创建 Run —— 调度
- `N4` 认领任务 —— Agent
- `N5` 构建 ContextPack —— 记忆
- `N6` 启动 Driver Session —— Driver
- `N7` 执行中 —— Driver
- `N8` Driver 运行结果 —— Driver
- `N9` 注册 Artifact —— 调度
- `N10` 完成事件 —— 调度
- `N11` / `N12` Hook 匹配 —— 安全检查
- `N13` Gate 决策 —— 安全检查
- `N14` 议会（可选）—— 调度
- `N15` 合并授权 —— 调度
- `N16` 保存 Checkpoint —— 调度
- `N17` 合并边界 —— 合并器
- `N18` Run 完成 —— 调度

拓扑：`N0`–`N3` 是共享前段；`N3` 之后按参与的 agent 分叉出并发子链（各跑一遍 `N4`–`N9`）；在 `N10` 收敛回主干，经 Hook 与 Gate、可选的议会，再到合并与完成。

## 模块方向

A/B/C/D 是仓库结构，不是产品概念。它出现在类型文件的注释里，也出现在后端同学的对话里。

- A · Driver / ACP 接入 —— agent 怎么被启动、怎么读写文件。
- B · 记忆与上下文 —— ContextPack 的装配、Agent 的画像与指标。
- C · 调度 —— Task / Run / AgentSession / Checkpoint / Message / 合议。
- D · Hook 与 Gate —— 安全检查点与放行决策。
- E · 前端 —— 就是你正在用的这个应用。E 不执行文件读写、不强制租约、不判定 Gate。界面上出现的 lease / gate / artifact 字段全都是后端给出的既成事实，前端只据此渲染。
