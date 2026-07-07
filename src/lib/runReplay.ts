import type { Event, FrontendRunSnapshot, RunMailboxMessage, RunTimelineEntry } from '@/api/types';
import type {
  LogEntry,
  LogLevel,
  NodeExecLogLine,
  NodeExecutionLogDetail,
  RunNodeFact,
  RunReplay,
  TimelineCheckpoint,
} from '@/types';
import type { Scenario } from '@/data/scenario';

/**
 * 从后端 Run 快照（frontend-snapshot.json v0）程序化派生前端回放数据。
 *
 * 核心原则（E 的铁律）：**后端给什么展示什么**——
 *  - 所有文案取快照原文（事件 name/text、消息 payload、checkpoint 清单…），不补写叙事；
 *  - 时间戳只在后端给了的地方显示（mailbox 消息的 created_at 等），
 *    timeline 事件本身无时间戳 → 显示序号 `#k`，不插值、不编造时刻；
 *  - 契约有但本次 run 没给的字段（FileLease / tool_events / Gate decision…）不虚构占位；
 *  - 唯一的 E 侧自由度是「路由」：把事件挂到哪个 N 节点、字段放哪个区块——
 *    这是展示位置的决定，不产生后端没说过的内容。
 */

// ── 小工具 ──

/** ISO 时间戳 → HH:MM:SS（快照时间戳均为 UTC；仅用于后端给了时间戳的数据） */
const hms = (iso: string) => iso.slice(11, 19);

/** timeline 序号占位（后端 timeline 条目不带时间戳，展示发生顺序而非编造时刻） */
const seqTag = (index: number) => `#${String(index + 1).padStart(2, '0')}`;

/** 后端 level → UI LogLevel（未知值按 info 渲染，不丢条目） */
const logLevel = (level: RunTimelineEntry['level']): LogLevel =>
  level === 'success' ? 'success' : level === 'warning' || level === 'error' ? 'warning' : 'info';

/** 把消息 payload 展平为 `key = value` 的事实行（值为快照原文） */
const payloadFacts = (payload: Record<string, unknown>, time?: string): RunNodeFact[] =>
  Object.entries(payload).map(([key, value]) => ({ key, value: String(value), time }));

// ── 事件 → 节点路由（E 侧展示位置决定，不改写内容） ──

type EventRoute = { test: RegExp; nodeId: string; eventType: string };

/** timeline 事件名 → N0–N18 节点 + 契约事件词表（core.EventType，开放词）。 */
const EVENT_ROUTES: EventRoute[] = [
  { test: /^TaskCreated$/, nodeId: 'n2-create-task', eventType: 'task.created' },
  { test: /^RunCreated$/, nodeId: 'n3-create-run', eventType: 'run.created' },
  {
    test: /^MailboxMessageSent \(task\.assigned\)$/,
    nodeId: 'n4-claim',
    eventType: 'mailbox.message_sent',
  },
  { test: /^ContextPackBuilt$/, nodeId: 'n5-contextpack', eventType: 'context_pack.built' },
  {
    test: /^DriverSessionStarted$/,
    nodeId: 'n6-start-driver',
    eventType: 'driver.session_started',
  },
  {
    test: /^MailboxMessageSent \(driver\.requested\)$/,
    nodeId: 'n6-start-driver',
    eventType: 'mailbox.message_sent',
  },
  {
    test: /^MailboxMessageAcked \(driver\.requested\)$/,
    nodeId: 'n6-start-driver',
    eventType: 'mailbox.message_acked',
  },
  {
    test: /^MailboxMessageSent \(driver\.completed\)$/,
    nodeId: 'n8-driver-result',
    eventType: 'mailbox.message_sent',
  },
  { test: /^DriverRunResult$/, nodeId: 'n8-driver-result', eventType: 'driver.run_result' },
  { test: /^ArtifactRegistered$/, nodeId: 'n9-artifact', eventType: 'artifact.registered' },
  { test: /^TaskCompleted$/, nodeId: 'n10-task-completed', eventType: 'task.completed' },
  { test: /^HookMatched$/, nodeId: 'n11-hook-gate', eventType: 'hook.matched' },
  { test: /^GateResult$/, nodeId: 'n13-gate', eventType: 'gate.result' },
  { test: /^ArtifactSelected$/, nodeId: 'n15-merge-auth', eventType: 'artifact.selected' },
  { test: /^CheckpointSaved$/, nodeId: 'n16-checkpoint', eventType: 'checkpoint.saved' },
  {
    test: /^WorktreeMaterialized$/,
    nodeId: 'n17-merge-boundary',
    eventType: 'worktree.materialized',
  },
  { test: /^RunCompleted$/, nodeId: 'n18-run-complete', eventType: 'run.completed' },
];

/** 事件名 ↔ mailbox 消息时间戳的关联：`MailboxMessageSent (<type>)` 用该消息的 created_at */
function eventTime(entry: RunTimelineEntry, messages: RunMailboxMessage[]): string | undefined {
  const sent = /^MailboxMessageSent \((.+)\)$/.exec(entry.name);
  if (!sent) return undefined;
  const msg = messages.find((m) => m.type === sent[1]);
  return msg ? hms(msg.created_at) : undefined;
}

// ── 派生主入口 ──

export function buildRunReplay(snapshot: FrontendRunSnapshot): RunReplay {
  const messages = snapshot.mailbox.messages;
  const routed = snapshot.timeline.map((entry, index) => ({
    entry,
    index,
    route: EVENT_ROUTES.find((r) => r.test.test(entry.name)),
    time: eventTime(entry, messages),
  }));

  // 时间轴日志：每个节点一条，文本 = 该节点全部事件的后端原文（多事件用 · 连接）
  const nodeLogs: Record<string, LogEntry & { checkpoint?: TimelineCheckpoint }> = {};
  for (const { entry, index, route, time } of routed) {
    if (!route) continue;
    const prev = nodeLogs[route.nodeId];
    if (prev) {
      prev.text = `${prev.text} · ${entry.text}`;
      if (logLevel(entry.level) === 'success') prev.level = 'success';
      continue;
    }
    nodeLogs[route.nodeId] = {
      time: time ?? seqTag(index),
      source: entry.source,
      text: entry.text,
      level: logLevel(entry.level),
      // 可回溯锚点只挂在后端标记 success 的事件上，label 用后端原文
      ...(logLevel(entry.level) === 'success'
        ? {
            checkpoint: {
              label: entry.name,
              description: `快照 timeline ${seqTag(index)} · level=success`,
            },
          }
        : {}),
    };
  }

  // 节点执行日志：该节点的事件按快照顺序原样列出（tag = 后端 source）
  const nodeExecLogs: Record<string, NodeExecutionLogDetail> = {};
  for (const { entry, index, route, time } of routed) {
    if (!route) continue;
    const line: NodeExecLogLine = {
      time: time ?? seqTag(index),
      tag: entry.source.toUpperCase(),
      message: entry.text,
      level: logLevel(entry.level),
    };
    (nodeExecLogs[route.nodeId] ??= { lines: [] }).lines.push(line);
  }
  // N7 执行段：后端未提供过程流（无 tool_events），只有事后诊断 → 只挂 duration
  const durationMs = snapshot.delivery_report.driver_diagnostics.duration_ms;
  nodeExecLogs['n7-executing'] = {
    duration: `${durationMs} ms`,
    lines: [
      {
        time: '—',
        tag: 'DIAG',
        message: `driver_diagnostics.duration_ms = ${durationMs}（本次 run 未提供执行过程流）`,
        level: 'info',
      },
    ],
  };

  // 后端事实（Node Inspector「本次 Run · 后端数据」）：全部为快照字段原文
  const requested = messages.find((m) => m.type === 'driver.requested');
  const assigned = messages.find((m) => m.type === 'task.assigned');
  const completed = messages.find((m) => m.type === 'driver.completed');
  const ck = snapshot.checkpoint;
  const report = snapshot.delivery_report;

  const messageFacts = (m: RunMailboxMessage | undefined): RunNodeFact[] =>
    m
      ? [
          { key: 'message_id', value: m.message_id, time: hms(m.created_at) },
          {
            key: 'from → to',
            value: `${m.from_agent_id} → ${m.to.map((t) => t.agent_id ?? t.role_id ?? '?').join(', ')}`,
          },
          ...payloadFacts(m.payload),
          { key: 'requires_ack', value: String(m.requires_ack) },
          ...(m.deadline_seconds != null
            ? [{ key: 'deadline_seconds', value: String(m.deadline_seconds) }]
            : []),
        ]
      : [];

  const eventIdFacts = (nodeId: string): RunNodeFact[] =>
    routed
      .filter((r) => r.route?.nodeId === nodeId)
      .map(({ entry, index, time }) => ({
        key: entry.name,
        value: entry.id,
        time: time ?? seqTag(index),
      }));

  const nodeFacts: Record<string, RunNodeFact[]> = {
    'n0-intake': requested
      ? [
          {
            key: 'prompt（driver.requested.payload）',
            value: String(requested.payload.prompt ?? '—'),
            time: hms(requested.created_at),
          },
        ]
      : [],
    'n2-create-task': eventIdFacts('n2-create-task'),
    'n3-create-run': [
      ...eventIdFacts('n3-create-run'),
      { key: 'run_id', value: snapshot.run.run_id },
      { key: 'task_id', value: snapshot.run.task_id },
      { key: 'status', value: snapshot.run.status },
      { key: 'mode', value: snapshot.run.mode },
      { key: 'driver_id', value: snapshot.run.driver_id },
      { key: 'created_at', value: snapshot.run.created_at, time: hms(snapshot.run.created_at) },
    ],
    'n4-claim': messageFacts(assigned),
    'n5-contextpack': eventIdFacts('n5-contextpack'),
    'n6-start-driver': [...eventIdFacts('n6-start-driver'), ...messageFacts(requested)],
    'n7-executing': [
      { key: 'driver_diagnostics.driver_id', value: report.driver_diagnostics.driver_id },
      { key: 'driver_diagnostics.duration_ms', value: String(durationMs) },
      ...(requested
        ? [
            {
              key: 'driver.requested',
              value: requested.created_at,
              time: hms(requested.created_at),
            },
          ]
        : []),
      ...(completed
        ? [
            {
              key: 'driver.completed',
              value: completed.created_at,
              time: hms(completed.created_at),
            },
          ]
        : []),
    ],
    'n8-driver-result': [...eventIdFacts('n8-driver-result'), ...messageFacts(completed)],
    'n9-artifact': snapshot.artifacts.flatMap((a) => [
      { key: 'artifact_id', value: a.artifact_id },
      { key: 'type', value: a.type },
      { key: 'uri', value: a.uri },
      { key: 'source_path', value: a.source_path },
      { key: 'materialized_record_path', value: a.materialized_record_path },
    ]),
    'n10-task-completed': [
      ...eventIdFacts('n10-task-completed'),
      { key: 'current.task_status', value: snapshot.current.task_status },
    ],
    'n11-hook-gate': eventIdFacts('n11-hook-gate'),
    'n13-gate': eventIdFacts('n13-gate'),
    'n14-council': [],
    'n15-merge-auth': eventIdFacts('n15-merge-auth'),
    'n16-checkpoint': [
      { key: 'checkpoint_id', value: ck.checkpoint_id },
      ...(ck.checkpoint_type ? [{ key: 'checkpoint_type', value: ck.checkpoint_type }] : []),
      { key: 'trigger', value: ck.trigger },
      { key: 'validity_status', value: ck.validity_status },
      { key: 'base_commit', value: ck.mechanical_snapshot.base_commit },
      ...(ck.mechanical_snapshot.snapshot_commit
        ? [{ key: 'snapshot_commit', value: ck.mechanical_snapshot.snapshot_commit }]
        : []),
      { key: 'branch', value: ck.mechanical_snapshot.branch },
      { key: 'worktree_path', value: ck.mechanical_snapshot.worktree_path },
      { key: 'modified_files', value: ck.mechanical_snapshot.modified_files.join('\n') },
      ...(ck.mechanical_snapshot.diff_artifact_id
        ? [{ key: 'diff_artifact_id', value: ck.mechanical_snapshot.diff_artifact_id }]
        : []),
      ...(
        ['done', 'in_progress', 'blocked_on', 'assumptions', 'next_steps', 'known_risks'] as const
      ).map((k) => ({
        key: `semantic_handoff.${k}`,
        value: ck.semantic_handoff[k].join('\n') || '—',
      })),
      ...(ck.runtime_state
        ? Object.entries(ck.runtime_state).map(([k, v]) => ({
            key: `runtime_state.${k}`,
            value: String(v),
          }))
        : []),
      ...(ck.artifact_refs ? [{ key: 'artifact_refs', value: ck.artifact_refs.join('\n') }] : []),
    ],
    'n17-merge-boundary': [
      ...eventIdFacts('n17-merge-boundary'),
      { key: 'worktree_path', value: report.worktree_path },
      { key: 'files_written', value: report.files_written.join('\n') },
      { key: 'artifacts_materialized', value: String(report.artifacts_materialized) },
    ],
    'n18-run-complete': [
      ...eventIdFacts('n18-run-complete'),
      { key: 'run.status', value: snapshot.run.status },
      { key: 'generated_at', value: snapshot.generated_at, time: hms(snapshot.generated_at) },
      ...Object.entries(snapshot.links).map(([k, v]) => ({ key: `links.${k}`, value: v })),
    ],
  };

  // 事件通道：timeline 原文包成契约 Event；created_at 用关联消息时间戳，
  // 无关联时退回快照生成时刻（快照顶层 generated_at，同为后端给出）
  const nodeEvents: Record<string, Event[]> = {};
  for (const { entry, route, time } of routed) {
    if (!route) continue;
    (nodeEvents[route.nodeId] ??= []).push({
      event_id: entry.id,
      event_type: route.eventType,
      subject_id: entry.id,
      run_id: snapshot.run_id,
      task_id: snapshot.task_id,
      payload: {
        name: entry.name,
        source: entry.source,
        level: entry.level,
        replay_of: snapshot.run_id,
      },
      created_at: time
        ? (messages.find((m) => hms(m.created_at) === time)?.created_at ?? snapshot.generated_at)
        : snapshot.generated_at,
      schema_version: snapshot.schema_version,
    });
  }

  // 场景内容：需求分析 / 交付报告逐字段取自快照；Council 本次未触发 → 空（不用 mock 顶替）
  const scenario: Scenario = {
    subject: String(requested?.payload.prompt ?? snapshot.task_id),
    domain: `${snapshot.run.mode} · driver=${snapshot.run.driver_id}`,
    understanding: {
      goal: String(requested?.payload.prompt ?? '—'),
      modules: snapshot.artifacts.map((a) => a.source_path.split('/').pop() ?? a.artifact_id),
      testDir: '—',
      risks: [...ck.semantic_handoff.known_risks],
      workflow: `${snapshot.run.mode} · driver=${snapshot.run.driver_id}`,
    },
    council: {
      context: {
        title: '本次 run 未触发 Council',
        description: '快照中无 Council 数据（Gate 后直接进入合并段）。',
        decisionMode: '—',
        councilId: '—',
      },
      discussion: [],
      options: [],
      evidenceRefs: [],
      riskSignals: [],
      recommendedReason: '—',
    },
    delivery: {
      summary: `run.status=${snapshot.run.status} · driver=${report.driver_diagnostics.driver_id} · duration_ms=${durationMs} · artifacts_materialized=${report.artifacts_materialized}`,
      changedFiles: [
        ...report.files_written,
        ...snapshot.artifacts.map((a) => `source_path: ${a.source_path}`),
      ],
      testResult: { passed: 0, failed: 0, coverageDelta: '—' },
      riskNotes: [...ck.semantic_handoff.known_risks],
    },
  };

  return {
    snapshot,
    nodeLogs,
    nodeExecLogs,
    nodeFacts,
    nodeEvents,
    // 本次 run 未提供 A 方向的工具事件流（fs/* 操作观测）→ 不虚构文件操作
    nodeFileOps: {},
    scenario,
    // 流程推进控制：快照无任何 Council 证据且任务完成 → Gate 直通（仅控制推进，不作为展示值）
    gateDecision: snapshot.timeline.some((e) => /council/i.test(e.name)) ? 'defer' : 'allow',
  };
}
