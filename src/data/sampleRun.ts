import type { FrontendRunSnapshot } from '@/api/types';
import type { DemoTask, FileNode, RunReplay, WorkflowNodeData } from '@/types';
import { composeRunWorkflowNodes, stripExecSuffix, type ExecAgentSpec } from '@/data/workflow';
import { buildRunReplay } from '@/lib/runReplay';

/**
 * 后端真实 run 的样例（api/run_be712da2….zip 落盘产物的前端镜像）。
 *
 * 本模块只放两类东西：
 *   1) 后端数据原件：frontend-snapshot.json 逐字段镜像（checkpoint 的
 *      runtime_state / artifact_refs 取自同包 checkpoint.json，同为后端落盘产物）；
 *   2) E 侧的组装决定：参与者推导、图组合、少量节点 statusNote（值均为快照原文）。
 * 所有展示内容（时间轴/执行日志/事实/事件/场景）由 buildRunReplay(snapshot)
 * 程序化派生——后端给什么展示什么，此处不写一句叙事文案。
 */

const RUN_ID = 'run_be712da2-fb27-477b-99b7-a239a37b8e4d';
const TASK_ID = 'task_d9b95ede-8bda-4550-8101-f2b9d63568ee';
const ARTIFACT_ID = 'artifact-tr881vmx';
const CHECKPOINT_ID = 'checkpoint_8547a4e6-b0ca-4485-ab0e-64ebd401c2d8';
const WORKTREE = `.newide/worktrees/${TASK_ID}`;
const RUNS_DIR = `.newide/runs/${RUN_ID}`;
/** run 启动时刻（task.assigned / driver.requested 的 created_at） */
const T_START = '2026-07-07T01:47:30.108Z';
/** driver 完成时刻（driver.completed 的 created_at） */
const T_DONE = '2026-07-07T01:48:16.753Z';
/** 快照生成时刻 */
const T_END = '2026-07-07T01:48:16.802Z';

/** 快照原件（frontend-snapshot.json，逐字段镜像）。 */
export const sampleRunSnapshot: FrontendRunSnapshot = {
  snapshot_type: 'coordinator.frontend_run_snapshot.v0',
  schema_version: 'v0',
  generated_at: T_END,
  run_id: RUN_ID,
  task_id: TASK_ID,
  current: { stage: 'delivery', task_status: 'completed', active_node_code: 'N18' },
  run: {
    run_id: RUN_ID,
    task_id: TASK_ID,
    status: 'completed',
    mode: 'single_agent',
    driver_id: 'claude',
    created_at: T_END,
  },
  timeline: [
    { id: TASK_ID, name: 'TaskCreated', level: 'info', source: 'Coordinator', text: 'TaskCreated' },
    { id: RUN_ID, name: 'RunCreated', level: 'info', source: 'Coordinator', text: 'RunCreated' },
    {
      id: 'event_de2b97d2-d26f-4d7a-8cee-002d2c538f9a',
      name: 'MailboxMessageSent (task.assigned)',
      level: 'info',
      source: 'Coordinator',
      text: 'MailboxMessageSent (task.assigned)',
    },
    {
      id: 'event_b77e9b5b-a81d-451b-aeaa-dbada90fea2b',
      name: 'ContextPackBuilt',
      level: 'info',
      source: 'Coordinator',
      text: 'ContextPackBuilt',
    },
    {
      id: 'event_c5155b1c-cfa2-44a8-93dc-df3726d6c279',
      name: 'DriverSessionStarted',
      level: 'info',
      source: 'Driver',
      text: 'DriverSessionStarted',
    },
    {
      id: 'event_ca43550e-9f8c-4d5c-8aae-c6c8d8ea9b28',
      name: 'MailboxMessageSent (driver.requested)',
      level: 'info',
      source: 'Coordinator',
      text: 'MailboxMessageSent (driver.requested)',
    },
    {
      id: 'event_9ec884ff-7dfa-494a-8721-35f4f095ae04',
      name: 'MailboxMessageAcked (driver.requested)',
      level: 'info',
      source: 'Coordinator',
      text: 'MailboxMessageAcked (driver.requested)',
    },
    {
      id: 'event_0196825b-e68b-48b2-8e99-9dd52c6c88e0',
      name: 'MailboxMessageSent (driver.completed)',
      level: 'info',
      source: 'Coordinator',
      text: 'MailboxMessageSent (driver.completed)',
    },
    {
      id: 'event_52ee9fa3-7937-4872-8af6-f16034b256e6',
      name: 'DriverRunResult',
      level: 'info',
      source: 'Driver',
      text: 'DriverRunResult',
    },
    {
      id: ARTIFACT_ID,
      name: 'ArtifactRegistered',
      level: 'info',
      source: 'Coordinator',
      text: 'ArtifactRegistered',
    },
    {
      id: 'event_3bd31410-148b-4e31-96df-709a5dbec6fa',
      name: 'TaskCompleted',
      level: 'success',
      source: 'Coordinator',
      text: 'TaskCompleted',
    },
    {
      id: 'event_7803cf0a-d9f2-40a9-a668-90fd3e0222f1',
      name: 'HookMatched',
      level: 'info',
      source: 'Gate',
      text: 'HookMatched',
    },
    {
      id: 'event_2f8082fa-a786-4108-9bdf-4f8927cfcc6f',
      name: 'GateResult',
      level: 'info',
      source: 'Gate',
      text: 'GateResult',
    },
    {
      id: 'event_80300dba-b7a4-4507-a7f7-81adfe141307',
      name: 'ArtifactSelected',
      level: 'info',
      source: 'Coordinator',
      text: 'ArtifactSelected',
    },
    {
      id: 'event_402fb06a-194f-41ba-9a34-bd87ea3847d7',
      name: 'WorktreeMaterialized',
      level: 'info',
      source: 'Coordinator',
      text: 'WorktreeMaterialized',
    },
    {
      id: CHECKPOINT_ID,
      name: 'CheckpointSaved',
      level: 'info',
      source: 'Coordinator',
      text: 'CheckpointSaved',
    },
    {
      id: 'event_afa40142-b1ca-4ec4-aaed-f40c1e8a5709',
      name: 'RunCompleted',
      level: 'success',
      source: 'Coordinator',
      text: 'RunCompleted',
    },
  ],
  delivery_report: {
    worktree_path: WORKTREE,
    files_written: [`${WORKTREE}/${ARTIFACT_ID}.json`],
    artifacts_materialized: 1,
    driver_diagnostics: { driver_id: 'claude', duration_ms: 45468 },
  },
  artifacts: [
    {
      artifact_id: ARTIFACT_ID,
      type: 'diff',
      uri: `artifact://diff/${TASK_ID}/%2FUsers%2Fneighhhbor%2FDesktop%2FSEKE_Projects%2FnewIDE%2FBCD%2Fnewide-scaffold%2F.newide%2Fmock-workspace%2Fsnake.html`,
      source_path:
        '/Users/neighhhbor/Desktop/SEKE_Projects/newIDE/BCD/newide-scaffold/.newide/mock-workspace/snake.html',
      materialized_record_path: `${WORKTREE}/${ARTIFACT_ID}.json`,
    },
  ],
  checkpoint: {
    checkpoint_id: CHECKPOINT_ID,
    trigger: 'manual',
    validity_status: 'valid',
    semantic_handoff: {
      done: [
        'task created',
        'driver completed',
        'gates passed',
        'artifacts selected',
        'worktree materialized',
      ],
      in_progress: [],
      blocked_on: [],
      assumptions: [
        'Integration v0 flow completed successfully',
        'Artifacts materialized to worktree',
      ],
      next_steps: ['Ready for user review', 'Can be resumed if needed'],
      known_risks: ['Checkpoint is in-memory only', 'Resume not yet implemented'],
    },
    mechanical_snapshot: {
      base_commit: 'demo-head',
      snapshot_commit: 'demo-head',
      worktree_path: WORKTREE,
      branch: 'integration-v0-demo',
      modified_files: [`${WORKTREE}/${ARTIFACT_ID}.json`],
      diff_artifact_id: ARTIFACT_ID,
    },
    // 以下三项快照内嵌视图不携带，取自同包 checkpoint.json（后端落盘原件）
    checkpoint_type: 'full',
    runtime_state: {
      scheduler_policy: 'single_agent',
      current_turn: 1,
      next_agent_ref: 'user_review',
      resume_cursor: 'worktree.materialized',
    },
    artifact_refs: [ARTIFACT_ID, 'artifact-i7meflfh'],
  },
  mailbox: {
    thread_id: RUN_ID,
    message_refs: [
      'message_f5dfe09e-e6ba-4afc-bdb5-70013ba8fb09',
      'message_5fc70580-787d-4f73-b767-b855e00bb181',
      'message_7ea9cee7-de05-478f-8195-c03c559b4758',
    ],
    messages: [
      {
        message_id: 'message_f5dfe09e-e6ba-4afc-bdb5-70013ba8fb09',
        thread_id: RUN_ID,
        from_agent_id: 'coordinator',
        to: [{ agent_id: 'acp-external' }],
        type: 'task.assigned',
        payload: { task_id: TASK_ID, agent_id: 'acp-external', session_id: 'acp-external:session' },
        requires_ack: false,
        created_at: T_START,
        schema_version: 'v0',
      },
      {
        message_id: 'message_5fc70580-787d-4f73-b767-b855e00bb181',
        thread_id: RUN_ID,
        from_agent_id: 'coordinator',
        to: [{ agent_id: 'acp-external' }],
        type: 'driver.requested',
        payload: { task_id: TASK_ID, run_id: RUN_ID, prompt: '贪吃蛇游戏' },
        requires_ack: true,
        deadline_seconds: 300,
        created_at: T_START,
        schema_version: 'v0',
      },
      {
        message_id: 'message_7ea9cee7-de05-478f-8195-c03c559b4758',
        thread_id: RUN_ID,
        from_agent_id: 'acp-external',
        to: [{ agent_id: 'coordinator' }],
        type: 'driver.completed',
        payload: {
          task_id: TASK_ID,
          run_id: RUN_ID,
          status: 'succeeded',
          artifact_count: 1,
          driver_run_result_id: 'driver_result-5ihlp05q',
        },
        requires_ack: false,
        created_at: T_DONE,
        schema_version: 'v0',
      },
    ],
  },
  links: {
    result_path: `${RUNS_DIR}/result.json`,
    summary_path: `${RUNS_DIR}/summary.json`,
    timeline_path: `${RUNS_DIR}/timeline.json`,
    checkpoint_path: `${RUNS_DIR}/checkpoint.json`,
    message_thread_path: `${RUNS_DIR}/message-thread.json`,
    frontend_snapshot_path: `${RUNS_DIR}/frontend-snapshot.json`,
  },
};

/** 完整回放数据源：从快照程序化派生（内容与快照一一对应，无手写文案）。 */
export const sampleRunReplay: RunReplay = buildRunReplay(sampleRunSnapshot);

/**
 * 参与执行的 agent —— 从快照推导，不由前端预设：
 * mailbox `task.assigned` 的指派对象（agent_id）+ run 的 driver_id。
 * 本次 run 是 single_agent，所以只有一条执行子链/泳道；若后端快照里
 * 出现多个被派单的 agent，这里就会映射出多条（E 只投影后端的派单事实）。
 */
const runExecAgents: ExecAgentSpec[] = sampleRunSnapshot.mailbox.messages
  .filter((m) => m.type === 'task.assigned')
  .map((m) => {
    const agentId = String(m.payload.agent_id);
    return {
      suffix: agentId,
      lane: agentId,
      owner: `${agentId} · ${sampleRunSnapshot.run.driver_id}`,
    };
  });

/**
 * 节点 statusNote 补丁（key 为去后缀 id）：卡片上一眼可见的后端原值索引。
 * 值一律为快照字段原文；N13/N14 陈述的是数据事实（GateResult 未附 decision、
 * 无 Council 数据），不下「allow」这类后端没说过的结论。
 */
const nodePatches: Record<string, Partial<WorkflowNodeData>> = {
  'n2-create-task': { statusNote: `task_id=${TASK_ID}` },
  'n3-create-run': { statusNote: `run_id=${RUN_ID}` },
  'n6-start-driver': { statusNote: 'payload.session_id=acp-external:session' },
  'n9-artifact': { statusNote: `artifact_id=${ARTIFACT_ID} · type=diff` },
  'n13-gate': { gateDecision: undefined, statusNote: 'GateResult 已发生 · payload 未附 decision' },
  'n14-council': { statusNote: '本次 run 无 Council 数据' },
  'n18-run-complete': {
    statusNote: `run.status=${sampleRunSnapshot.run.status} · duration_ms=${sampleRunSnapshot.delivery_report.driver_diagnostics.duration_ms}`,
  },
};

/** 样例项目的静态描述（启动页入口 & taskSlice.loadSampleRun 共用）。 */
export const sampleRunProjectMeta = {
  name: '贪吃蛇游戏 · Run 回放',
  description: `后端真实 run 样例（${RUN_ID.slice(0, 12)}…）`,
  tags: ['样例', 'Integration v0'],
  files: [
    {
      name: '.newide',
      children: [
        {
          name: 'runs',
          children: [
            {
              name: RUN_ID,
              children: [
                { name: 'frontend-snapshot.json' },
                { name: 'result.json' },
                { name: 'summary.json' },
                { name: 'timeline.json' },
                { name: 'checkpoint.json' },
                { name: 'message-thread.json' },
              ],
            },
          ],
        },
        {
          name: 'worktrees',
          children: [{ name: TASK_ID, children: [{ name: `${ARTIFACT_ID}.json` }] }],
        },
      ],
    },
    { name: 'snake.html' },
  ] satisfies FileNode[],
};

/**
 * 构造样例回放任务（contractTaskId 直接采用后端真实 task_id）。
 * 泳道图按快照推导的参与者正向组图（composeRunWorkflowNodes）：
 * 后端本次派了 1 个 agent（acp-external），图上就只有这 1 条执行子链/泳道。
 */
export function createSampleRunTask(id: string, projectId: string): DemoTask {
  const nodes = composeRunWorkflowNodes(runExecAgents).map((n) => ({
    ...n,
    ...nodePatches[stripExecSuffix(n.id)],
    input: [...n.input],
    output: [...n.output],
    deps: [...n.deps],
  }));
  return {
    id,
    projectId,
    title: '贪吃蛇游戏 · Run 回放',
    taskText: '贪吃蛇游戏',
    // 团队 = 快照里被派单的 agent（Agent 池中有 acp-external 的档案）
    assignedAgentIds: runExecAgents.map((a) => a.suffix),
    contractTaskId: TASK_ID,
    stage: 'analyzing',
    analysisReady: true,
    nodes,
    revealedNodeCount: 0,
    activeStepIndex: -1,
    selectedNodeId: null,
    interventionRules: [],
    confirmedCouncilOptionId: null,
    interventionFeedback: null,
    filePermissionOutcomes: {},
    timeline: [],
    replay: sampleRunReplay,
  };
}
