/**
 * 用**本次真实后端 run** 的快照驱动整个界面。
 *
 * 为什么需要这个文件：`runReplay.ts` 早就搭好了「快照 → 全界面」的通道，但它的事件路由表
 * 用的是旧词表（`RunCreated` 这种 PascalCase，来自落盘样例 `coordinator.frontend_run_snapshot.v0`），
 * 而 BCD 现在通过 RPC 发的是 `frontend-workflow.v0.1`（`run.created` 这种点分小写，
 * 且没有 mailbox 区块）。两套形状对不上 —— 于是真实 run 的数据根本喂不进渲染机制，
 * 界面只能一直回落到 mock 剧本。这里补上新词表的那一条通道。
 *
 * 铁律与 runReplay 相同：**后端给什么展示什么**。
 *  - 文案取快照原文（事件 payload、checkpoint 清单、gate reason…），不补写叙事；
 *  - 新快照的事件**自带 created_at**，所以时间戳是真的，不再需要 `#k` 序号占位；
 *  - 契约有但本次 run 没给的（tool_events / Council 数据…）不虚构占位；
 *  - E 的唯一自由度是「路由」：把事件挂到哪个 N 节点 —— 这是展示位置的决定，
 *    不产生后端没说过的内容。
 */
import type {
  RunEvent,
  RunNodeStatus,
  RunSnapshot,
  FrontendWorkflowV01Snapshot,
} from '@/api/types/rpc';
import { isFrontendWorkflowV01 } from '@/api/types/rpc';
import type { Event as ContractEvent } from '@/api/types';
import type { ExecAgentSpec } from '@/data/workflow';
import type {
  GateDecision,
  LogEntry,
  LogLevel,
  NodeExecLogLine,
  NodeExecutionLogDetail,
  RunNodeFact,
  RunReplay,
  TimelineCheckpoint,
} from '@/types';
import type { Scenario } from '@/data/scenario';

/** ISO → HH:MM:SS（新快照的事件都带 created_at，时间戳是后端给的真值） */
const hms = (iso: string) => iso.slice(11, 19);

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const str = (value: unknown, fallback = '—'): string =>
  value == null ? fallback : typeof value === 'string' ? value : JSON.stringify(value);

/** payload 展平为 `key = value` 事实行（值为快照原文） */
const payloadFacts = (payload: Record<string, unknown>, time?: string): RunNodeFact[] =>
  Object.entries(payload).map(([key, value]) => ({ key, value: str(value), time }));

// ── 事件 → 节点路由（E 侧展示位置决定，不改写内容）──

/**
 * BCD `frontend-workflow.v0.1` 的事件词表 → N0–N18 节点 id。
 * mailbox 事件靠 `payload.message_type` 区分收件段（后端就是这么标的）。
 */
function routeOf(event: RunEvent): string | undefined {
  const messageType = str(asRecord(event.payload).message_type, '');
  switch (event.type) {
    case 'task.created':
      return 'n2-create-task';
    case 'run.created':
    case 'run.started':
      return 'n3-create-run';
    case 'mailbox.message_sent':
    case 'mailbox.message_acked':
      if (messageType === 'task.assigned') return 'n4-claim';
      if (messageType === 'driver.requested') return 'n6-start-driver';
      if (messageType === 'driver.completed') return 'n8-driver-result';
      return undefined;
    case 'memory.context_pack_built':
      return 'n5-contextpack';
    case 'driver.session_started':
      return 'n6-start-driver';
    // agent 执行段：这是后端真正「在干活」的两条事件，挂到 N7 执行中
    case 'agent.execution_requested':
    case 'agent.execution_completed':
      return 'n7-executing';
    case 'driver.run_result':
      return 'n8-driver-result';
    case 'artifact.registered':
      return 'n9-artifact';
    case 'task.completed':
      return 'n10-task-completed';
    case 'hook.matched':
    case 'gate.requested':
      return 'n11-hook-gate';
    case 'gate.result':
      return 'n13-gate';
    case 'council.started':
    case 'council.decision':
    case 'council.completed':
      return 'n14-council';
    case 'artifact.selected':
      return 'n15-merge-auth';
    case 'checkpoint.saved':
    case 'coord.checkpoint_observed':
      return 'n16-checkpoint';
    case 'worktree.materialized':
      return 'n17-merge-boundary';
    case 'run.completed':
    case 'run.failed':
    case 'run.cancelled':
      return 'n18-run-complete';
    default:
      return undefined;
  }
}

/** 后端事件 → UI 日志级别。失败类事件标 warning，终态成功标 success。 */
function levelOf(event: RunEvent): LogLevel {
  if (event.type.endsWith('.failed') || event.type === 'run.cancelled') return 'warning';
  if (
    event.type === 'run.completed' ||
    event.type === 'task.completed' ||
    event.type === 'agent.execution_completed' ||
    event.type === 'checkpoint.saved'
  ) {
    return 'success';
  }
  return 'info';
}

/** 事件的展示文案：事件类型 + payload 原文（不叙事化） */
function textOf(event: RunEvent): string {
  const payload = asRecord(event.payload);
  const body = Object.entries(payload)
    .map(([k, v]) => `${k}=${str(v)}`)
    .join(' · ');
  return body ? `${event.type} · ${body}` : event.type;
}

/**
 * 泳道图的执行 agent：取后端派单事件（mailbox `task.assigned`）里的收件 agent。
 * 后端派几个，图上就长几条执行泳道 —— 前端不预设条数。
 */
export function liveExecAgents(snapshot: FrontendWorkflowV01Snapshot): ExecAgentSpec[] {
  const driverId = snapshot.timeline
    .filter((e) => e.type === 'driver.session_started')
    .map((e) => str(asRecord(e.payload).driver_id, ''))
    .find(Boolean);

  const assigned = snapshot.timeline
    .filter(
      (e) =>
        e.type === 'mailbox.message_sent' &&
        str(asRecord(e.payload).message_type, '') === 'task.assigned',
    )
    .map((e) => str(asRecord(e.payload).to_agent_id, ''))
    .filter(Boolean);

  const unique = [...new Set(assigned)];
  return unique.map((agentId) => ({
    suffix: agentId,
    lane: agentId,
    owner: driverId && driverId !== agentId ? `${agentId} · ${driverId}` : agentId,
  }));
}

// ── 派生主入口 ──

/**
 * 从本次真实 run 的 RPC 快照派生回放数据源。
 *
 * 只接受完整形态（`frontend-workflow.v0.1`）—— 瘦快照（早期被取消的 run）缺 task/run/flow，
 * 派生不出可展示的东西，返回 null，调用方保持 mock 兜底。
 */
export function buildLiveRunReplay(snapshot: RunSnapshot): RunReplay | null {
  if (!isFrontendWorkflowV01(snapshot)) return null;

  const routed = snapshot.timeline
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map((event) => ({ event, nodeId: routeOf(event), time: hms(event.created_at) }));

  // 时间轴日志：每个节点一条，文本 = 该节点全部事件的后端原文
  const nodeLogs: Record<string, LogEntry & { checkpoint?: TimelineCheckpoint }> = {};
  for (const { event, nodeId, time } of routed) {
    if (!nodeId) continue;
    const level = levelOf(event);
    const prev = nodeLogs[nodeId];
    if (prev) {
      prev.text = `${prev.text} · ${textOf(event)}`;
      if (level === 'success') prev.level = 'success';
      continue;
    }
    nodeLogs[nodeId] = {
      time,
      source: event.source,
      text: textOf(event),
      level,
      ...(level === 'success'
        ? {
            checkpoint: {
              label: event.type,
              description: `后端事件 #${event.sequence} · source=${event.source}`,
            },
          }
        : {}),
    };
  }

  // 节点执行日志：该节点的事件按 sequence 原样列出（tag = 后端 source）
  const nodeExecLogs: Record<string, NodeExecutionLogDetail> = {};
  for (const { event, nodeId, time } of routed) {
    if (!nodeId) continue;
    const line: NodeExecLogLine = {
      time,
      tag: event.source.toUpperCase(),
      message: textOf(event),
      level: levelOf(event),
    };
    (nodeExecLogs[nodeId] ??= { lines: [] }).lines.push(line);
  }
  // N7 执行段：用 agent.execution_requested → completed 的真实耗时（后端未给过程流，不虚构）
  const started = routed.find((r) => r.event.type === 'agent.execution_requested')?.event;
  const finished = routed.find((r) => r.event.type === 'agent.execution_completed')?.event;
  if (started && finished) {
    const durationMs =
      new Date(finished.created_at).getTime() - new Date(started.created_at).getTime();
    nodeExecLogs['n7-executing'] = {
      duration: `${durationMs} ms`,
      lines: nodeExecLogs['n7-executing']?.lines ?? [],
    };
  }

  const facts = (nodeId: string): RunNodeFact[] =>
    routed
      .filter((r) => r.nodeId === nodeId)
      .flatMap(({ event, time }) => [
        { key: event.type, value: event.event_id, time },
        ...payloadFacts(asRecord(event.payload), time),
      ]);

  const checkpoint = asRecord(snapshot.checkpoint);
  const mechanical = asRecord(checkpoint.mechanical_snapshot);
  const handoff = asRecord(checkpoint.semantic_handoff);
  const report = snapshot.delivery_report;

  const nodeFacts: Record<string, RunNodeFact[]> = {
    // N0 需求：后端权威 task.spec（就是用户提交的原文）
    'n0-intake': [
      { key: 'spec', value: snapshot.task.spec },
      { key: 'completion_criteria', value: snapshot.task.completion_criteria.join('\n') || '—' },
      { key: 'risk_level', value: snapshot.task.risk_level },
    ],
    'n2-create-task': [
      ...facts('n2-create-task'),
      { key: 'task_id', value: snapshot.task.task_id },
      { key: 'task.status', value: snapshot.task.status },
    ],
    'n3-create-run': [
      ...facts('n3-create-run'),
      { key: 'run_id', value: snapshot.run.run_id },
      { key: 'mode', value: snapshot.run.mode },
      { key: 'run.status', value: snapshot.run.status },
      ...(snapshot.run.started_at
        ? [
            {
              key: 'started_at',
              value: snapshot.run.started_at,
              time: hms(snapshot.run.started_at),
            },
          ]
        : []),
    ],
    'n4-claim': facts('n4-claim'),
    'n5-contextpack': facts('n5-contextpack'),
    'n6-start-driver': facts('n6-start-driver'),
    'n7-executing': [
      ...facts('n7-executing'),
      ...snapshot.agent_runs.flatMap((run) => payloadFacts(asRecord(run))),
    ],
    'n8-driver-result': facts('n8-driver-result'),
    // N9 产物：source_path 是 agent 真正写到工作区的文件路径
    'n9-artifact': snapshot.artifacts.flatMap((artifact) => payloadFacts(asRecord(artifact))),
    'n10-task-completed': [
      ...facts('n10-task-completed'),
      { key: 'current.task_status', value: str(snapshot.current.task_status) },
    ],
    'n11-hook-gate': facts('n11-hook-gate'),
    'n13-gate': [
      ...facts('n13-gate'),
      ...snapshot.gates.flatMap((gate) => payloadFacts(asRecord(gate))),
    ],
    // Council 只在 mode=council 且后端真给了数据时才有内容 —— 没有就是没有，不用 mock 顶替
    'n14-council': snapshot.council ? payloadFacts(asRecord(snapshot.council)) : [],
    'n15-merge-auth': facts('n15-merge-auth'),
    'n16-checkpoint': [
      ...facts('n16-checkpoint'),
      ...payloadFacts(mechanical),
      ...Object.entries(handoff).map(([key, value]) => ({
        key: `semantic_handoff.${key}`,
        value: Array.isArray(value) ? value.join('\n') || '—' : str(value),
      })),
    ],
    'n17-merge-boundary': [
      ...facts('n17-merge-boundary'),
      { key: 'worktree_path', value: str(report.worktree_path) },
      { key: 'files_written', value: report.files_written.join('\n') || '—' },
      { key: 'artifacts_materialized', value: String(report.artifacts_materialized) },
    ],
    'n18-run-complete': [
      ...facts('n18-run-complete'),
      { key: 'run.status', value: snapshot.status },
      ...snapshot.errors.map((e) => ({ key: `error.${e.code}`, value: e.message })),
      ...Object.entries(snapshot.links).map(([key, value]) => ({
        key: `links.${key}`,
        value: str(value),
      })),
    ],
  };

  // 事件通道：后端事件原样包成前端 Event 形状（不改写内容）
  const nodeEvents: Record<string, ContractEvent[]> = {};
  for (const { event, nodeId } of routed) {
    if (!nodeId) continue;
    (nodeEvents[nodeId] ??= []).push({
      event_id: event.event_id,
      event_type: event.type as ContractEvent['event_type'],
      subject_id: event.run_id,
      run_id: event.run_id,
      task_id: event.task_id,
      payload: event.payload,
      created_at: event.created_at,
      schema_version: event.schema_version as ContractEvent['schema_version'],
    });
  }

  // agent 真正写到工作区的文件（artifacts[].source_path，type=diff）
  const producedFiles = snapshot.artifacts
    .map((artifact) => asRecord(artifact))
    .filter((artifact) => artifact.type === 'diff')
    .map((artifact) => str(artifact.source_path, ''))
    .filter(Boolean);

  const scenario: Scenario = {
    subject: snapshot.task.spec,
    domain: `${snapshot.run.mode} · run=${snapshot.run.status}`,
    understanding: {
      goal: snapshot.task.spec,
      modules: producedFiles.map((path) => path.split('/').pop() ?? path),
      testDir: '—',
      risks: Array.isArray(handoff.known_risks) ? handoff.known_risks.map(String) : [],
      workflow: `${snapshot.run.mode}`,
    },
    council: snapshot.council
      ? {
          context: {
            title: `Council · ${snapshot.council.status}`,
            description: `verdict=${snapshot.council.verdict ?? '—'} · decision_mode=${snapshot.council.decision_mode ?? '—'}`,
            decisionMode: snapshot.council.decision_mode ?? '—',
            councilId: snapshot.council.decision_id ?? '—',
          },
          discussion: [],
          options: [],
          evidenceRefs: snapshot.council.selected_artifact_refs,
          riskSignals: snapshot.council.blocked_by,
          recommendedReason: '—',
        }
      : {
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
      summary:
        `run.status=${snapshot.status} · mode=${snapshot.run.mode} · ` +
        `artifacts_materialized=${report.artifacts_materialized}` +
        (snapshot.errors.length ? ` · errors=${snapshot.errors.map((e) => e.code).join(',')}` : ''),
      changedFiles: producedFiles,
      testResult: { passed: 0, failed: 0, coverageDelta: '—' },
      riskNotes: Array.isArray(handoff.known_risks) ? handoff.known_risks.map(String) : [],
    },
  };

  // Gate 走向只用于控制推进：后端给了 decision 就用后端的
  const gateDecision: GateDecision = snapshot.gates
    .map((gate) => str(asRecord(gate).decision, ''))
    .includes('defer')
    ? 'defer'
    : 'allow';

  return {
    source: 'live',
    meta: {
      runId: snapshot.run_id,
      taskId: snapshot.task_id,
      mode: snapshot.run.mode,
      status: snapshot.status,
      driverId: snapshot.timeline
        .filter((e) => e.type === 'driver.session_started')
        .map((e) => str(asRecord(e.payload).driver_id, ''))
        .find(Boolean),
    },
    liveSnapshot: snapshot,
    nodeLogs,
    nodeExecLogs,
    nodeFacts,
    nodeEvents,
    // 后端未提供 A 方向的工具事件流（fs/* 操作观测）→ 不虚构文件操作剧本
    nodeFileOps: {},
    scenario,
    gateDecision,
  };
}

/** 本次 run 里 agent 真正写到工作区的文件绝对路径（用于挂进项目文件树）。 */
export function liveProducedFiles(snapshot: RunSnapshot): string[] {
  if (!isFrontendWorkflowV01(snapshot)) return [];
  return snapshot.artifacts
    .map((artifact) => asRecord(artifact))
    .filter((artifact) => artifact.type === 'diff')
    .map((artifact) => str(artifact.source_path, ''))
    .filter(Boolean);
}

/** 后端 flow.node_statuses：N 编号 → 状态（供泳道图标注真实推进态）。 */
export function liveNodeStatuses(snapshot: RunSnapshot): RunNodeStatus[] {
  return isFrontendWorkflowV01(snapshot) ? snapshot.flow.node_statuses : [];
}
