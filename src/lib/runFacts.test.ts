import { describe, expect, it } from 'vitest';
import type { RunEvent, RunSnapshot } from '@/api/types/rpc';
import { buildEventGraph } from '@/lib/eventGraph';
import {
  artifactFactsOf,
  blockingGateOf,
  councilFactsOf,
  eventsByNode,
  focusStepOf,
  gateFactOf,
  machineSteps,
  runMetaOf,
  stepOwnerOf,
  visibleSteps,
} from '@/lib/runFacts';
import type { LiveRunState } from '@/store/types';

let seq = 0;
const event = (type: string, payload: Record<string, unknown> = {}): RunEvent => {
  seq += 1;
  return {
    event_id: `evt-${String(seq)}`,
    sequence: seq,
    run_id: 'run-1',
    task_id: 'task-1',
    type,
    source: 'coordinator',
    created_at: `2026-07-13T09:00:${String(seq).padStart(2, '0')}.000Z`,
    payload,
    schema_version: 'v0.1',
  };
};

const liveRun = (timeline: RunEvent[], snapshot: RunSnapshot | null = null): LiveRunState => ({
  runId: 'run-1',
  taskId: 'task-1',
  status: snapshot ? 'completed' : 'running',
  timeline,
  snapshot,
  error: null,
});

/** 完整形态快照（contract_version 到位，isFrontendWorkflowV01 才认）。 */
const snapshotWith = (
  filesWritten: string[],
  artifacts: Record<string, unknown>[] = [],
): RunSnapshot =>
  ({
    contract_version: 'frontend-workflow.v0.1',
    schema_version: 'v0.1',
    run_id: 'run-1',
    task_id: 'task-1',
    mode: 'single_agent',
    status: 'completed',
    current: { stage: 'delivery', active_node_code: '' },
    task: {
      task_id: 'task-1',
      status: 'completed',
      spec: '为 user 模块补齐单测',
      completion_criteria: [],
      risk_level: 'low',
      affected_paths: [],
      created_at: '',
      updated_at: '',
      schema_version: 'v0.1',
    },
    run: {
      run_id: 'run-1',
      task_id: 'task-1',
      status: 'completed',
      mode: 'single_agent',
      event_ids: [],
    },
    flow: { active_node_code: '', node_statuses: [] },
    delivery_report: {
      worktree_path: '/w/order-service',
      files_written: filesWritten,
      artifacts_materialized: filesWritten.length,
    },
    links: {},
    timeline: [],
    agent_runs: [],
    artifacts,
    gates: [],
    errors: [],
  }) as RunSnapshot;

describe('runFacts · Gate 提取', () => {
  it('取最后一次 gate.result，并把 required_actions 带出来', () => {
    const timeline = [
      event('gate.result', { decision: 'allow' }),
      event('gate.result', {
        decision: 'ask',
        reason: '需要人工确认写入范围',
        required_actions: ['确认 src/user 下的改动'],
      }),
    ];
    expect(gateFactOf(timeline)).toEqual({
      decision: 'ask',
      reason: '需要人工确认写入范围',
      requiredActions: ['确认 src/user 下的改动'],
      phase: '',
      gateId: '',
      targetState: '',
    });
  });

  it('gate_id / phase / target_state 一并带出（后端给了就不丢）', () => {
    const fact = gateFactOf([
      event('gate.result', {
        decision: 'allow',
        reason: '',
        phase: 'pre_selection',
        gate_id: 'allow-gate',
        target_state: 'artifact_selection',
      }),
    ]);
    expect(fact?.phase).toBe('pre_selection');
    expect(fact?.gateId).toBe('allow-gate');
    expect(fact?.targetState).toBe('artifact_selection');
  });

  it('只有 ask / defer 算「需要你」；allow / deny 不是', () => {
    expect(blockingGateOf([event('gate.result', { decision: 'defer' })])?.decision).toBe('defer');
    expect(blockingGateOf([event('gate.result', { decision: 'allow' })])).toBeNull();
    expect(blockingGateOf([event('gate.result', { decision: 'deny' })])).toBeNull();
    expect(blockingGateOf([])).toBeNull();
  });
});

describe('runFacts · 产出文件的两种 files_written 形状', () => {
  it('快照在：delivery_report.files_written 是 string[]（路径）→ 计数取 length', () => {
    const facts = artifactFactsOf(
      liveRun(
        [],
        snapshotWith(
          ['tests/test_user.py', 'src/user.py'],
          [{ type: 'diff', source_path: '/w/order-service/tests/test_user.py' }],
        ),
      ),
    );
    expect(facts.count).toBe(2);
    expect(facts.files.map((f) => f.label)).toEqual(['tests/test_user.py', 'src/user.py']);
    // 只有能拿到绝对路径的那个才允许「在文件管理器里打开」
    expect(facts.files[0].absPath).toBe('/w/order-service/tests/test_user.py');
    expect(facts.files[1].absPath).toBeUndefined();
  });

  it('快照未到：worktree.materialized.payload.files_written 是 number（数量）→ 直接当数字用', () => {
    const facts = artifactFactsOf(
      liveRun([
        event('artifact.registered', { type: 'diff', uri: 'file:///w/x/tests/test_user.py' }),
        event('artifact.registered', { type: 'transcript', uri: 'acp://session/abc123' }),
        event('worktree.materialized', { files_written: 3 }),
      ]),
    );
    expect(facts.count).toBe(3);
    // transcript 产物的尾段是 session id，不是文件名 —— 不许混进文件列表
    expect(facts.files).toEqual([{ label: 'test_user.py' }]);
  });

  it('快照未到：文件名取 changed_files（真数组），而不是同名同源的 files_written（数字）', () => {
    const facts = artifactFactsOf(
      liveRun([
        event('worktree.materialized', {
          files_written: 2, // 数量
          changed_files: ['snake.py', 'README.md'], // 路径 —— 名字就在这儿
        }),
      ]),
    );
    expect(facts.count).toBe(2);
    // 名字明明已经到手了，就不该再让界面说「路径要等快照」
    expect(facts.files).toEqual([{ label: 'snake.py' }, { label: 'README.md' }]);
  });

  it('changed_files 优先于 artifact.registered 的 uri 尾段', () => {
    const facts = artifactFactsOf(
      liveRun([
        event('artifact.registered', { type: 'diff', uri: 'file:///w/x/a.py' }),
        event('worktree.materialized', { files_written: 1, changed_files: ['src/snake.py'] }),
      ]),
    );
    // changed_files 是后端登记的真实相对路径；uri 尾段只是个兜底的 basename
    expect(facts.files).toEqual([{ label: 'src/snake.py' }]);
  });

  it('既没有快照也没有 worktree 事件：退回 diff 产物的条数', () => {
    const facts = artifactFactsOf(
      liveRun([event('artifact.registered', { type: 'diff', uri: 'file:///w/x/a.py' })]),
    );
    expect(facts.count).toBe(1);
  });

  it('没有 run：0 个文件，不编造', () => {
    expect(artifactFactsOf(undefined)).toEqual({ count: 0, files: [] });
  });
});

describe('runFacts · 步骤', () => {
  const timeline = [
    event('task.created', { spec: '为 user 模块补齐单测' }),
    event('memory.context_pack_built', { role_id: 'role_ts_engineer', memory_refs: ['a'] }),
    event('driver.session_started', { driver_id: 'acp-external' }),
    event('agent.execution_requested', { role_id: 'role_ts_engineer' }),
    event('agent.execution_completed', { role_id: 'role_ts_engineer', status: 'ok' }),
    event('artifact.registered', { type: 'diff', uri: 'file:///w/x/a.py' }),
    event('gate.result', { decision: 'allow' }),
  ];
  const { nodes } = buildEventGraph(timeline, 'running');

  it('machine-tier 步骤被聚合计数（永不单独成 Fold）', () => {
    // prepare（分派与上下文）是 machine；intake / execute / produce / review 不是
    expect(machineSteps(nodes).map((n) => n.labelCn)).toEqual(['分派与上下文']);
    expect(visibleSteps(nodes)).toHaveLength(nodes.length - 1);
  });

  it('每个步骤背后的原始事件条数 = evidence 的 n', () => {
    const byNode = eventsByNode(timeline);
    const machine = machineSteps(nodes)[0];
    // memory.context_pack_built + driver.session_started 都归到「分派与上下文」
    expect(byNode[machine.id]).toHaveLength(2);
  });

  it('执行者过 roleName()，绝不显示 role_ts_engineer 原文', () => {
    const byNode = eventsByNode(timeline);
    const execute = nodes.find((n) => n.labelCn === 'Agent 执行');
    if (!execute) throw new Error('缺少 Agent 执行步骤');
    expect(stepOwnerOf(execute, byNode[execute.id])).toBe('TypeScript 工程师');
  });

  it('拿不到 role_id 的执行步骤回退「后端 Agent」', () => {
    const anonymous = [event('agent.execution_requested', {})];
    const graph = buildEventGraph(anonymous, 'running');
    const byNode = eventsByNode(anonymous);
    expect(stepOwnerOf(graph.nodes[0], byNode[graph.nodes[0].id])).toBe('后端 Agent');
  });

  it('聚焦：选中优先，否则跟着 agent 走（active）', () => {
    // 跨度未闭合（agent 还在干活）→ 「Agent 执行」是 active
    const running = timeline.filter((e) => e.type !== 'agent.execution_completed');
    const live = buildEventGraph(running, 'running').nodes;
    const active = live.find((n) => n.status === 'active');
    expect(active?.labelCn).toBe('Agent 执行');
    expect(focusStepOf(live, null)?.id).toBe(active?.id);

    const intake = visibleSteps(live)[0];
    expect(focusStepOf(live, intake.id)?.id).toBe(intake.id);
  });

  it('run 结束后（没有 active）落在最后一个已发生的步骤上', () => {
    const visible = visibleSteps(nodes);
    const last = visible[visible.length - 1];
    expect(focusStepOf(nodes, null)?.id).toBe(last.id);
  });
});

describe('runFacts · 运行信息', () => {
  it('模式 / 执行器 / 事件数全部取后端原文，拿不到就是空串', () => {
    const timeline = [event('driver.session_started', { driver_id: 'acp-external' })];
    const meta = runMetaOf(liveRun(timeline, snapshotWith([])));
    expect(meta).toEqual({
      runId: 'run-1',
      taskId: 'task-1',
      mode: 'single_agent',
      driverId: 'acp-external',
      eventCount: 1,
      sourceCounts: [['coordinator', 1]],
      selection: null,
    });
    expect(runMetaOf(liveRun([])).driverId).toBe('');
  });

  it('事件分布按 source 计数；artifact.selected 的选择结论带出 mode + selected_count', () => {
    const meta = runMetaOf(
      liveRun([
        event('task.created', {}),
        event('run.started', {}),
        event('artifact.selected', { mode: 'single_agent_artifacts', selected_count: 2 }),
      ]),
    );
    expect(meta.sourceCounts).toEqual([['coordinator', 3]]);
    expect(meta.selection).toEqual({ mode: 'single_agent_artifacts', selectedCount: 2 });
  });
});

describe('runFacts · Council', () => {
  it('没有 council 事件也没有快照 council 段 → null（Fold 压根不出现）', () => {
    expect(councilFactsOf(liveRun([event('task.created', {})]))).toBeNull();
    expect(councilFactsOf(undefined)).toBeNull();
  });

  it('实时：proposal / review / synthesis 事件逐个到达即计数，状态由事件推导', () => {
    const facts = councilFactsOf(
      liveRun([
        event('council.started', { decision_mode: 'advisory' }),
        event('council.proposal.completed', { role_id: 'role_proposer_a', proposal_id: 'prop-1' }),
        event('council.proposal.completed', { role_id: 'role_proposer_b', proposal_id: 'prop-2' }),
        event('council.review.completed', {
          role_id: 'role_reviewer',
          review_ids: ['rev-1', 'rev-2'],
        }),
      ]),
    );
    expect(facts?.status).toBe('running');
    expect(facts?.proposalCount).toBe(2);
    expect(facts?.reviewCount).toBe(1);
    expect(facts?.synthesisDone).toBe(false);
    expect(facts?.decisionMode).toBe('advisory');
    expect(facts?.roles).toEqual([
      { kind: '提案', roleId: 'role_proposer_a', refId: 'prop-1' },
      { kind: '提案', roleId: 'role_proposer_b', refId: 'prop-2' },
      { kind: '评审', roleId: 'role_reviewer', refId: 'rev-1, rev-2' },
    ]);
  });

  it('council.failed → status=failed，code 带出', () => {
    const facts = councilFactsOf(
      liveRun([
        event('council.started', {}),
        event('council.failed', { code: 'PROPOSAL_ROLE_FAILED' }),
      ]),
    );
    expect(facts?.status).toBe('failed');
    expect(facts?.failedCode).toBe('PROPOSAL_ROLE_FAILED');
  });

  it('决议字段来自 council.decision；快照到达后以快照为准', () => {
    // verdict 取值一律用后端真实词表（select / needs_human / request_revision / reject）——
    // 编过的值（'approved' / 'needs_iteration'）会让测试看起来通过，却证明不了任何真事。
    const timeline = [
      event('council.decision', {
        verdict: 'select',
        decision_mode: 'advisory',
        selected_proposal_id: 'prop-1',
      }),
      event('council.completed', {}),
    ];
    const eventsOnly = councilFactsOf(liveRun(timeline));
    expect(eventsOnly?.status).toBe('completed');
    expect(eventsOnly?.verdict).toBe('select');
    expect(eventsOnly?.selectedProposalId).toBe('prop-1');

    const snapshot = {
      ...snapshotWith([]),
      council: {
        enabled: true as const,
        status: 'completed' as const,
        verdict: 'request_revision' as const,
        decision_mode: 'binding',
        selected_proposal_id: 'prop-2',
        selected_artifact_refs: [],
        required_next_actions: ['补充测试'],
        blocked_by: ['gate-x'],
        can_create_merge_authorization: false,
        proposals: [{ proposal_id: 'prop-1' }, { proposal_id: 'prop-2' }],
        reviews: [{ review_id: 'rev-1' }],
        synthesis: { synthesis_id: 'syn-1' },
      },
    };
    const withSnapshot = councilFactsOf(liveRun(timeline, snapshot));
    expect(withSnapshot?.verdict).toBe('request_revision');
    expect(withSnapshot?.decisionMode).toBe('binding');
    expect(withSnapshot?.selectedProposalId).toBe('prop-2');
    expect(withSnapshot?.proposalCount).toBe(2);
    expect(withSnapshot?.synthesisDone).toBe(true);
    expect(withSnapshot?.requiredNextActions).toEqual(['补充测试']);
    expect(withSnapshot?.blockedBy).toEqual(['gate-x']);
  });
});
