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

阶段：交付。事件：`artifact.selected` · `worktree.materialized` · `checkpoint.saved` · `coord.checkpoint_observed` · `run.completed` · `run.failed` · `run.cancelled` · `run.interrupted`。中断不是交付成功，未闭合的执行步骤显示为暂停。

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

## 可恢复中断

停止使用 `task.interrupt({ task_id })`，继续使用 `task.resume({ task_id })`；不附加 prompt、session 或 checkpoint 参数，不以 `task.cancel`、`task.create` 或 `run.restart` 冒充继续。停止确认后 Task 通常 blocked、没有 current_run，历史 Run 为 interrupted；其他 blocked 状态不自动显示为用户中断。

Task 身份不变，恢复创建新的审计 Run。前端保留旧 Run，合并权威快照；请求接受不等于执行完成。后端校验恢复锚点和原生会话，不新建会话冒充恢复。继续前提示可能回写工作区文件。

每次 ready 重连都会回读 Task 并重新订阅。替换 watcher 时先清理旧订阅；按 revision 防止旧值覆盖，旧连接的异步回包作废。Task 和 Run 通道共用 event_id 去重；after_event_id 失效的 `-32009` 通过无游标重订阅恢复，不触发重新执行。

`-32601` 表示旧后端缺少接口；`-32014` 显示恢复锚点诊断并保留等待态；`-32007` / `-32008` / `-32010` 等竞态错误先回读状态，不自动重复 resume 或改走 restart。

## 驱动路由

- `driver.getConfig`：读取 `driver-routing.v1` 快照。
- `driver.refresh({ force: true })`：显式重新探测本机驱动，返回完整路由快照。
- `driver.list` / `driver.probe`：返回原始 `driver-probe.v1` 诊断，不用于填充选择器。
- `driver.updateRouting`：保存默认驱动和完整角色映射。
- `driver.resetRouting`：删除界面覆盖，恢复文件配置。

`roles` 包含目录未确认的显式映射，`known_role=false` 不代表映射无效。与默认驱动相同的映射由后端合并。

`selectable` 决定选项是否可选；`degraded` 与 `AGENT_CLI_READINESS_NOT_VERIFIABLE` 表示执行器 CLI 就绪状态未验证，不是驱动故障。

首屏只读取配置，不重复探测。显式刷新期间禁用重复操作；成功整体替换快照及未保存草稿，失败保留旧状态。不可选择条目保留诊断，但界面不展示启动命令、路径或凭据。

保存和恢复都需携带 `expected_revision`：

- `-32021`：版本冲突，保留草稿并读取最新配置，由用户选择如何合并。
- `-32022` / `-32023`：驱动不存在或不可选，`field` 指向对应选项。
- `-32024`：配置读写失败。
- `-32025`：默认驱动由部署配置锁定，`locked_driver_id` 为固定值。
- `-32026`：配置正在写入，可重试同一请求。
- `-32027`：探针模块缺失，不代表没有安装执行器。
- `-32028`：探测失败，保留旧列表。
- `-32029`：自动发现配置无法持久化。
- `-32030`：发现文件锁忙。

覆盖文件位于项目的 `.agent/drivers.ui.local.yaml`。保存不重启后端：已创建 Run 保留冻结映射，新 Run 才读取新配置。议会各阶段按 `activity_run_id` 所属 Run 的映射执行。

配置根由宿主显式传入的 `projectRoot` 决定，不从 `ACP_WORKSPACE` 隐式推导，也不使用状态目录 cwd。自动发现档案由后端刷新维护；手工档案仍通过配置文件管理。路由设置不安装 CLI，也不编辑凭据。

## 记忆维护

`memory.getCapabilities` v4 的 `memory_maintenance.ownership=external` 描述业务所有权：在线执行只提交上下文和反馈，不在任务执行链路内提取或晋升记忆；它不表示维护消费者一定运行在另一个进程。

当前生产宿主按顺序运行五个后台通道：`context_delivery`、`driver_feedback`、`feedback_reconcile`、`skill_promotion`、`persona_evolution`。`NEWIDE_B_DELIVERY_DRAIN_INTERVAL_MS` 未设置时沿用 `NEWIDE_MAINTENANCE_INTERVAL_MS`，默认 3,600,000 毫秒，首次处理发生在该间隔之后。

技能晋升置信度阈值由 `NEWIDE_B_PROMOTION_CONFIDENCE_THRESHOLD` 控制，默认 0.95。只有将 `NEWIDE_B_SKILL_AUTO_APPROVE` / `NEWIDE_B_PERSONA_AUTO_APPROVE` 显式设为 `1` 才自动批准；默认记录待人工审核的标记，不直接创建技能或新版 Persona。

## Gate 与合议

Gate 有四种结论：

- `allow`：放行。
- `deny`：拒绝。
- `ask`：请求人工确认。
- `defer`：延后决策。

当前界面只展示 Gate 结果，不提供回复入口。合议中的提案、评审、综合与方案选择由后端执行。
