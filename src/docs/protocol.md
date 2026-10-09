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

这一步是一个跨度（requested → completed / failed）。运行期间还会收到执行器 turn / tool 生命周期事件；主句优先读取活动快照，区分思考、委派和执行工具。流式文字片段不进入状态事件流。

执行器生命周期归入同一个执行步骤，工具结束不会提前关闭 Agent 跨度；工具失败后 Agent 成功恢复，也不会把整个步骤判成失败。用量记账事件仅供用量与原始事件查看，不凭空生成审查步骤。

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

## 运行观测接口

运行中会定期读取 `run.getSnapshot`。主句和「当前活动」使用 `activity.agents` 中的思考、委派及执行器工具状态；缺少活动块不代表空闲。`stale` 表示观测可能已陈旧，`since` 与 `last_event_at` 都来自后端。

`current.cursor` 是精确阶段：`select_agent`、`execute_agent`、`council`、`gate`、`deliver`、`mailbox_wait`、`done`。`stage` 只是粗映射；没有 `invocation_id` 表示此刻没有阶段调用在跑。

### 用量

「用量」分三种口径，互不相加：

- `billed`：按 `proxy` 与 `claude_session_jsonl` 分来源的计费 token。运行中通常只有代理一侧，`pending_sources` 标出尚待收尾结算的来源。
- `context`：执行器上下文占用，不是计费用量。`complete=false` 会显示观测不完整。
- `by_stage`：仅模型代理一侧的分阶段计费统计，不是阶段总量。没有 `duration_ms` 时显示「耗时未提供」，不是 0。

`run.getUsage` 可按 run、task、system、role 查看持久历史累计。没有用量的运行计入 `runs_without_usage`，不当作 0；查询失败会显示错误与刷新入口。

### 增量事件与重连

`run.event`、`run.getEvents` 与快照时间线对同一事件使用相同的 `sequence`。序号可以并列，因此按后端数组顺序展示、按 `event_id` 去重。

断号与重连时先补拉、再对齐快照，并用 `run.subscribe.after_sequence` 恢复订阅。后端重启可能改变持久回放的序号空间，所以重连必须重新读取权威快照，不能仅沿用旧水位。前端补拉不分页，避免并列序号在页边界丢失。

### 完整载荷

超出内联上限的大字段在 `event.payload.payload_ref` 留引用。展开事件流中的对应行，点「读取完整载荷」，由 `run.getPayload` 取回原始事件。

引用对应的文件可能已经截断或清理：`-32017` 会显示不可读取，不返回假空内容。`-32601` 表示后端版本不支持接口。状态事件照常推送，但消息 chunk、工具 progress 和 stderr 不逐条进入状态时间线，也没有独立的流式文字合并通道。

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
