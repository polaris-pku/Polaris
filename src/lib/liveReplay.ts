/**
 * 用**本次真实后端 run** 的数据驱动整个界面。
 *
 * 图由事件生成（见 lib/eventGraph.ts）——触发了什么就展示什么。这里负责把同一批事件
 * 派生成界面各处要的东西：节点日志 / 执行日志 / Inspector 事实 / 事件通道 / 场景 / Gate 走向。
 * 所有 per-node 数据都**按事件图的节点 id 键控**，与泳道图一一对应。
 *
 * 铁律：**后端给什么展示什么**。
 *  - 文案取事件 payload 原文，不补写叙事；
 *  - 事件自带 created_at，时间戳是真值；
 *  - 契约有但本次 run 没给的（tool_events / Council 数据…）不虚构占位。
 */
import type { RunEvent, RunSnapshot, FrontendWorkflowV01Snapshot } from '@/api/types/rpc';
import { isFrontendWorkflowV01 } from '@/api/types/rpc';
import type { Event as ContractEvent } from '@/api/types';
import { buildEventGraph, groupEvents, type LiveRunStatus } from '@/lib/eventGraph';
import { councilFactsFrom } from '@/lib/runFacts';
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

/** ISO → HH:MM:SS（事件都带 created_at，时间戳是后端给的真值） */
const hms = (iso: string) => iso.slice(11, 19);

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const str = (value: unknown, fallback = '—'): string =>
  value == null ? fallback : typeof value === 'string' ? value : JSON.stringify(value);

const payloadFacts = (payload: Record<string, unknown>, time?: string): RunNodeFact[] =>
  Object.entries(payload).map(([key, value]) => ({ key, value: str(value), time }));

/** 后端事件 → UI 日志级别。失败类标 warning，终态成功标 success。 */
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
  const body = Object.entries(asRecord(event.payload))
    .map(([k, v]) => `${k}=${str(v)}`)
    .join(' · ');
  return body ? `${event.type} · ${body}` : event.type;
}

// ── 事件 → 每节点视图（键 = 事件图的节点 id）──

function deriveNodeViews(events: RunEvent[]) {
  const groups = groupEvents(events);

  const nodeLogs: Record<string, LogEntry & { checkpoint?: TimelineCheckpoint }> = {};
  const nodeExecLogs: Record<string, NodeExecutionLogDetail> = {};
  const nodeFacts: Record<string, RunNodeFact[]> = {};
  const nodeEvents: Record<string, ContractEvent[]> = {};

  for (const group of groups) {
    const { nodeId } = group;
    const lines: NodeExecLogLine[] = [];
    const facts: RunNodeFact[] = [];
    const contractEvents: ContractEvent[] = [];
    let level: LogLevel = 'info';
    let text = '';

    for (const event of group.events) {
      const time = hms(event.created_at);
      const eventLevel = levelOf(event);
      if (eventLevel === 'success') level = 'success';
      else if (eventLevel === 'warning' && level !== 'success') level = 'warning';
      text = text ? `${text} · ${textOf(event)}` : textOf(event);

      lines.push({
        time,
        tag: event.source.toUpperCase(),
        message: textOf(event),
        level: eventLevel,
      });
      facts.push(
        { key: event.type, value: event.event_id, time },
        ...payloadFacts(asRecord(event.payload), time),
      );
      contractEvents.push({
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

    const first = group.events[0];
    nodeLogs[nodeId] = {
      time: hms(first.created_at),
      source: first.source,
      text,
      level,
      ...(level === 'success'
        ? {
            checkpoint: {
              label: first.type,
              description: `后端事件 #${String(first.sequence)} · source=${first.source}`,
            },
          }
        : {}),
    };
    nodeExecLogs[nodeId] = { lines };
    nodeFacts[nodeId] = facts;
    nodeEvents[nodeId] = contractEvents;
  }

  return { groups, nodeLogs, nodeExecLogs, nodeFacts, nodeEvents };
}

/** 该事件类型的节点 id（用于把快照里的额外数据挂到对应节点上）。 */
function nodeIdForType(groups: ReturnType<typeof groupEvents>, type: string): string | undefined {
  return groups.find((g) => g.events.some((e) => e.type === type))?.nodeId;
}

// ── 实时（只有事件流，还没有快照）──

/**
 * 实时回放数据源：**只靠事件流**，run 还在跑时就能用。
 * 快照才有的东西（产物 source_path / checkpoint / 交付报告）此时拿不到 —— 留空，不猜。
 */
export function buildLiveProgressReplay(
  events: RunEvent[],
  meta: { runId: string; taskId: string; mode: string; status: string },
): RunReplay {
  const { groups, nodeLogs, nodeExecLogs, nodeFacts, nodeEvents } = deriveNodeViews(events);

  const spec = events
    .filter((e) => e.type === 'task.created')
    .map((e) => str(asRecord(e.payload).spec, ''))
    .find(Boolean);

  const gateDecision: GateDecision = events
    .filter((e) => e.type === 'gate.result')
    .map((e) => str(asRecord(e.payload).decision, ''))
    .includes('defer')
    ? 'defer'
    : 'allow';

  // 实时握手：`coord.checkpoint_observed` 的 semantic_handoff（已完成 / 进行中 / 下一步 /
  // 已知风险）是 agent 干活期间后端唯一的进度自述。终态路径把 checkpoint.saved 的同款数据
  // 摊开成事实 —— 实时路径对齐同一处理，不再把它整段丢掉等快照。
  const observed = [...events].reverse().find((e) => e.type === 'coord.checkpoint_observed');
  const liveHandoff = observed ? asRecord(asRecord(observed.payload).semantic_handoff) : {};
  const handoffNodeId = nodeIdForType(groups, 'coord.checkpoint_observed');
  if (handoffNodeId && Object.keys(liveHandoff).length > 0) {
    nodeFacts[handoffNodeId] = [
      ...(nodeFacts[handoffNodeId] ?? []),
      ...Object.entries(liveHandoff).map(([key, value]) => ({
        key: `semantic_handoff.${key}`,
        value: Array.isArray(value) ? value.join('\n') || '—' : str(value),
      })),
    ];
  }
  const liveRisks = Array.isArray(liveHandoff.known_risks)
    ? liveHandoff.known_risks.map(String)
    : [];

  // 议会（事件先行）：council.* 事件到达即渲染，不等终态快照。
  const council = councilFactsFrom(events);

  return {
    source: 'live',
    meta: {
      ...meta,
      driverId: events
        .filter((e) => e.type === 'driver.session_started')
        .map((e) => str(asRecord(e.payload).driver_id, ''))
        .find(Boolean),
    },
    nodeLogs,
    nodeExecLogs,
    nodeFacts,
    nodeEvents,
    nodeFileOps: {},
    scenario: {
      subject: spec ?? meta.taskId,
      domain: `${meta.mode} · run=${meta.status}`,
      understanding: {
        goal: spec ?? '—',
        modules: [], // 产物路径要等快照，运行中还不知道 —— 留空而不是编造
        testDir: '—',
        risks: liveRisks,
        workflow: meta.mode,
      },
      council: council
        ? {
            context: {
              title: `Council · ${council.status}`,
              description:
                [
                  council.verdict && `verdict=${council.verdict}`,
                  council.proposalCount > 0 && `提案 ${String(council.proposalCount)}`,
                  council.reviewCount > 0 && `评审 ${String(council.reviewCount)}`,
                  council.synthesisDone && '综合完成',
                  council.failedCode && `失败 ${council.failedCode}`,
                ]
                  .filter(Boolean)
                  .join(' · ') || '议会进行中',
              decisionMode: council.decisionMode || '—',
              councilId: council.selectedProposalId || '—',
            },
            discussion: [],
            options: [],
            evidenceRefs: [],
            riskSignals: [],
            recommendedReason: '—',
          }
        : {
            context: {
              title: '本次 run 未触发 Council',
              description: '运行中；如触发 Council，事件到达后此处会更新。',
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
        summary: `run.status=${meta.status} · mode=${meta.mode}（执行中，交付数据待 run 结束）`,
        changedFiles: [],
        testResult: { passed: 0, failed: 0, coverageDelta: '—' },
        riskNotes: liveRisks,
      },
    },
    gateDecision,
  };
}

// ── 终态（事件 + 快照）──

/**
 * 终态回放：事件图不变，再把快照独有的事实挂到对应节点上
 * （产物挂到 artifact.registered 节点、checkpoint 挂到 checkpoint.saved 节点…）。
 *
 * 只接受完整形态（`frontend-workflow.v0.1`）—— 瘦快照（早早被取消的 run）缺 task/run，
 * 派生不出可展示的东西，返回 null，调用方保持原状。
 */
export function buildLiveRunReplay(snapshot: RunSnapshot): RunReplay | null {
  if (!isFrontendWorkflowV01(snapshot)) return null;

  const { groups, nodeLogs, nodeExecLogs, nodeFacts, nodeEvents } = deriveNodeViews(
    snapshot.timeline,
  );

  const checkpoint = asRecord(snapshot.checkpoint);
  const mechanical = asRecord(checkpoint.mechanical_snapshot);
  const handoff = asRecord(checkpoint.semantic_handoff);
  const report = snapshot.delivery_report;

  /** 把额外事实挂到某个事件类型对应的节点上（该事件没发生 → 无处可挂，也就不该有这块数据） */
  const attach = (type: string, extra: RunNodeFact[]) => {
    const nodeId = nodeIdForType(groups, type);
    if (!nodeId || extra.length === 0) return;
    nodeFacts[nodeId] = [...(nodeFacts[nodeId] ?? []), ...extra];
  };

  attach(
    'artifact.registered',
    snapshot.artifacts.flatMap((artifact) => payloadFacts(asRecord(artifact))),
  );
  attach(
    'gate.result',
    snapshot.gates.flatMap((gate) => payloadFacts(asRecord(gate))),
  );
  attach('checkpoint.saved', [
    ...payloadFacts(mechanical),
    ...Object.entries(handoff).map(([key, value]) => ({
      key: `semantic_handoff.${key}`,
      value: Array.isArray(value) ? value.join('\n') || '—' : str(value),
    })),
  ]);
  attach('worktree.materialized', [
    { key: 'worktree_path', value: str(report.worktree_path) },
    { key: 'files_written', value: report.files_written.join('\n') || '—' },
    { key: 'artifacts_materialized', value: String(report.artifacts_materialized) },
  ]);
  attach('run.completed', [
    ...snapshot.errors.map((e) => ({ key: `error.${e.code}`, value: e.message })),
    ...Object.entries(snapshot.links).map(([key, value]) => ({
      key: `links.${key}`,
      value: str(value),
    })),
  ]);
  attach('run.failed', [
    ...snapshot.errors.map((e) => ({ key: `error.${e.code}`, value: e.message })),
    ...Object.entries(snapshot.links).map(([key, value]) => ({
      key: `links.${key}`,
      value: str(value),
    })),
  ]);
  // 议会终态：快照的 council 段（proposals / reviews / synthesis / 决议字段）摊开挂到
  // 议会节点上 —— 与 gates / artifacts 的处理同款。completed / failed 只会有其一。
  if (snapshot.council) {
    const councilRows = payloadFacts(asRecord(snapshot.council));
    if (nodeIdForType(groups, 'council.completed')) attach('council.completed', councilRows);
    else attach('council.failed', councilRows);
  }

  const producedFiles = liveProducedFiles(snapshot);

  const scenario: Scenario = {
    subject: snapshot.task.spec,
    domain: `${snapshot.run.mode} · run=${snapshot.run.status}`,
    understanding: {
      goal: snapshot.task.spec,
      modules: producedFiles.map((path) => path.split('/').pop() ?? path),
      testDir: '—',
      risks: Array.isArray(handoff.known_risks) ? handoff.known_risks.map(String) : [],
      workflow: snapshot.run.mode,
    },
    council: snapshot.council
      ? {
          context: {
            title: `Council · ${snapshot.council.status}`,
            description: [
              `verdict=${snapshot.council.verdict ?? '—'}`,
              `decision_mode=${snapshot.council.decision_mode ?? '—'}`,
              snapshot.council.proposals?.length &&
                `提案 ${String(snapshot.council.proposals.length)}`,
              snapshot.council.reviews?.length && `评审 ${String(snapshot.council.reviews.length)}`,
              snapshot.council.synthesis && '综合完成',
            ]
              .filter(Boolean)
              .join(' · '),
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
        `artifacts_materialized=${String(report.artifacts_materialized)}` +
        (snapshot.errors.length ? ` · errors=${snapshot.errors.map((e) => e.code).join(',')}` : ''),
      changedFiles: producedFiles,
      testResult: { passed: 0, failed: 0, coverageDelta: '—' },
      riskNotes: Array.isArray(handoff.known_risks) ? handoff.known_risks.map(String) : [],
    },
  };

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

/** 事件图（供 store 投影泳道图用）。 */
export { buildEventGraph };
export type { FrontendWorkflowV01Snapshot, LiveRunStatus };
