# 协议参考

运行状态、事件、用量与驱动路由的字段说明。原始事件可在底部「事件流」中查看。

## 事件与阶段

运行过程按已发生的事件归为以下步骤。

### 需求受理

阶段：受理。事件：`task.created` · `run.created` · `run.started`。

### 分派与上下文

阶段：执行。事件：`memory.context_pack_built` · `driver.session_started` · `mailbox.message_sent` · `mailbox.message_acked`。

### Agent 执行

阶段：执行。事件：`agent.execution_requested` · `agent.execution_completed` · `agent.execution_failed`。

运行期间的 turn / tool 生命周期归入同一执行步骤。工具结束不代表 Agent 执行结束，单次工具失败也不等于整个任务失败。

### 产出

阶段：执行。事件：`driver.run_result` · `artifact.registered`，以及 `message_type=driver.completed` 的信箱事件。

### 审查

阶段：审查。事件：`task.completed` · `hook.matched` · `gate.requested` · `gate.result`。

### 议会

阶段：审查。事件：`council.started` · `council.decision` · `council.completed`。

### 交付

阶段：交付。事件：`artifact.selected` · `worktree.materialized` · `checkpoint.saved` · `coord.checkpoint_observed` · `run.completed` · `run.failed` · `run.cancelled`。

### 文件交付字段

- `RunEvent('worktree.materialized').payload.files_written`：文件数量。
- `RunSnapshot.delivery_report.files_written`：文件路径数组。

## 运行观测接口

`run.getSnapshot` 提供运行状态。`activity.agents` 记录思考、委派与工具活动；缺少活动数据不代表空闲，`stale` 表示观测可能已陈旧。

`current.cursor` 标识当前阶段：`select_agent`、`execute_agent`、`council`、`gate`、`deliver`、`mailbox_wait`、`done`。

### 用量

三种统计口径互不相加：

- `billed`：按 `proxy` 与驱动计费来源分别统计 token。`proxy` 表示后端模型 API 调用；`pending_sources` 标记待结算来源。
- `context`：执行器上下文占用，不是计费用量。`complete=false` 表示观测不完整。
- `by_stage`：模型 API 调用的分阶段用量，不是阶段总用量。

`run.getUsage` 支持按运行、任务、系统或角色查询历史累计。缺少用量或耗时不按 0 处理。

### 增量事件与重连

`run.event`、`run.getEvents` 与快照时间线使用同源 `sequence`。序号可能并列，事件按 `event_id` 去重并保留原顺序。

断线后重新读取快照、补拉事件，再通过 `run.subscribe.after_sequence` 恢复订阅。

### 完整载荷

大字段通过 `event.payload.payload_ref` 引用。展开对应事件，选择「读取完整载荷」，由 `run.getPayload` 获取内容。

- `-32017`：载荷已截断或清理，无法读取。
- `-32601`：后端不支持该接口。

状态时间线不逐条展示消息 chunk、工具 progress 或 stderr。

## 驱动路由

- `driver.getConfig`：读取 `driver-routing.v1` 快照。
- `driver.updateRouting`：保存默认驱动和完整角色映射。
- `driver.resetRouting`：删除界面覆盖，恢复文件配置。

`roles` 包含目录未确认的显式映射，`known_role=false` 不代表映射无效。与默认驱动相同的映射由后端合并。

`selectable` 决定选项是否可选；`degraded` 与 `AGENT_CLI_READINESS_NOT_VERIFIABLE` 表示执行器 CLI 就绪状态未验证，不是驱动故障。

保存和恢复都需携带 `expected_revision`：

- `-32021`：版本冲突，保留草稿并读取最新配置，由用户选择如何合并。
- `-32022` / `-32023`：驱动不存在或不可选，`field` 指向对应选项。
- `-32024`：配置读写失败。
- `-32025`：默认驱动由部署配置锁定，`locked_driver_id` 为固定值。
- `-32026`：配置正在写入，可重试同一请求。

覆盖文件位于项目的 `.agent/drivers.ui.local.yaml`。保存不重启后端：已创建 Run 保留冻结映射，新 Run 才读取新配置。议会各阶段按 `activity_run_id` 所属 Run 的映射执行。

新增或移除驱动档案需要重启后端。路由设置不安装 CLI，也不编辑凭据。

## Gate 与合议

Gate 有四种结论：

- `allow`：放行。
- `deny`：拒绝。
- `ask`：请求人工确认。
- `defer`：延后决策。

当前界面只展示 Gate 结果，不提供回复入口。合议中的提案、评审、综合与方案选择由后端执行。
