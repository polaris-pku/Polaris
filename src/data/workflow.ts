import type { Lane, WorkflowNodeData } from '@/types';

/** 泳道顺序（自上而下）= 执行角色分区 */
export const lanes: Lane[] = ['User', 'System', 'Backend', 'Test', 'Security', 'Council'];

export const laneLabels: Record<Lane, string> = {
  User: 'User · 用户 / 前端',
  System: 'System · 调度 / 协调',
  Backend: 'Backend · 后端 Agent',
  Test: 'Test · 测试 Agent',
  Security: 'Security · 安全 / Gate',
  Council: 'Council · 议会',
};

/**
 * 端到端主链路 N0–N18（见 api/需求到处理-全流程图与状态机.md）。
 * 每个节点的 decided / tbd 字段直接来自 api/前端字段清单.json。
 *
 * 拓扑：N0–N3 为共享前段；N3 后分叉出 Backend / Test 两条并发执行子链
 * （各跑 N4–N9，column 4–9 同列并行）；在 N10 收敛回 System 主干，
 * 经 Security 的 Gate(N13)、可选 Council(N14)、合并(N15–N18)完成。
 *
 * store 会基于此创建可变副本，仅改动 status 字段。
 */

/** N4–N9 执行段模板：按参与 agent 生成一条并发子链（id 加 -<suffix> 后缀） */
function makeExecSegment(suffix: string, lane: Lane, ownerName: string): WorkflowNodeData[] {
  const s = (base: string) => `${base}-${suffix}`;
  return [
    {
      id: s('n4-claim'),
      code: 'N4',
      label: 'Claim',
      labelCn: '认领任务',
      lane,
      direction: 'C',
      column: 4,
      tier: 'machine',
      deps: ['n3-create-run'],
      owner: ownerName,
      status: 'pending',
      taskStatus: 'claimed',
      frozen: 'frozen',
      summary: '_coord.task.claim：Agent 认领子任务，签发文件租约 FileLease。',
      input: ['task_id', 'agent_id'],
      output: ['Task(claimed)', 'AgentRecord', 'FileLease'],
      decided: [
        { key: 'owner_agent_id', desc: '认领的 Agent' },
        {
          key: 'agent',
          desc: '{ agent_id, role_id, driver_id, session_id, status, worktree_id?, last_heartbeat? }',
        },
        {
          key: 'file_lease',
          desc: '{ lease_id, path_glob, scope: read|write, expires_at, status }',
        },
      ],
      tbd: [{ key: 'agent.capabilities', desc: 'Agent 能力集 schema 待 A/B 定' }],
      events: ['task.claimed'],
      risk: '文件租约冲突会阻塞认领；并行子任务需路径不重叠。',
      nextAction: '进入 N5 构建 ContextPack。',
    },
    {
      id: s('n5-contextpack'),
      code: 'N5',
      label: 'ContextPack',
      labelCn: '构建 ContextPack',
      lane,
      direction: 'B',
      column: 5,
      tier: 'machine',
      deps: [s('n4-claim')],
      owner: ownerName,
      status: 'pending',
      taskStatus: 'claimed',
      frozen: 'partial',
      summary: '组装上下文包，引用 B 方向的角色画像 RoleProfileRef。',
      input: ['RoleProfileRef', 'artifact_refs'],
      output: ['ContextPackRef'],
      decided: [
        { key: 'context_pack_id', desc: 'string' },
        { key: 'uri', desc: 'string' },
        { key: 'summary', desc: 'string? 上下文摘要' },
        { key: 'role_profile_id', desc: '角色画像引用' },
        { key: 'capability_tags', desc: 'string[]?' },
      ],
      tbd: [
        {
          key: 'persona_ref / skill_refs / experience_refs',
          desc: 'B 的画像/技能/经验引用格式待 B 定',
        },
      ],
      events: [],
      risk: 'B 画像字段未冻结，引用格式可能调整。',
      nextAction: '进入 N6 启动 Driver。',
    },
    {
      id: s('n6-start-driver'),
      code: 'N6',
      label: 'Start Driver',
      labelCn: '启动 Driver Session',
      lane,
      direction: 'A',
      column: 6,
      tier: 'machine',
      deps: [s('n5-contextpack')],
      owner: ownerName,
      status: 'pending',
      taskStatus: 'running',
      frozen: 'partial',
      summary: '启动 Driver 会话，绑定 session_id，子任务进入 running。',
      input: ['ContextPack', 'prompt'],
      output: ['AgentRecord.session_id'],
      decided: [
        { key: 'session_id', desc: 'string' },
        { key: 'driver_id', desc: 'string' },
        { key: 'started_at', desc: '时间' },
      ],
      tbd: [{ key: 'capabilities', desc: 'driver 是否支持实时事件等，待 A 定' }],
      events: ['task.started'],
      risk: 'Driver schema 待 A 冻结。',
      nextAction: '进入 N7 执行中。',
    },
    {
      id: s('n7-executing'),
      code: 'N7',
      label: 'Executing',
      labelCn: '执行中',
      lane,
      direction: 'A',
      column: 7,
      tier: 'human',
      deps: [s('n6-start-driver')],
      owner: ownerName,
      status: 'pending',
      taskStatus: 'running',
      frozen: 'partial',
      summary: 'Driver 执行编码工作；用户可在此节点 Intervene 注入业务规则。',
      input: ['实现计划', '用户实时介入规则'],
      output: ['tool_events / diagnostics'],
      decided: [{ key: 'retry_state', desc: '{ attempt, max_attempts, exhausted }' }],
      tbd: [
        { key: 'tool_events', desc: '工具调用事件流（实时进度），待 A 定' },
        { key: 'budget_usage', desc: '预算消耗，待 A 是否暴露' },
        { key: 'diagnostics', desc: '运行诊断' },
      ],
      events: [],
      risk: '实时进度依赖 A 方向，当前只保证结果入口。',
      nextAction: '可在此 Intervene 注入规则，随后进入 N8 Driver 结果。',
    },
    {
      id: s('n8-driver-result'),
      code: 'N8',
      label: 'Driver Result',
      labelCn: 'Driver 运行结果',
      lane,
      direction: 'A',
      column: 8,
      tier: 'machine',
      deps: [s('n7-executing')],
      owner: ownerName,
      status: 'pending',
      taskStatus: 'running',
      frozen: 'partial',
      summary: 'Driver 返回 DriverRunResultForCoordination（C 侧消费入口已冻结）。',
      input: ['执行过程'],
      output: ['DriverRunResultForCoordination'],
      decided: [
        { key: 'session_id', desc: 'string' },
        { key: 'status', desc: 'success | failed | cancelled | timeout' },
        { key: 'transcript_ref', desc: '{ artifact_id, type, uri }?' },
        { key: 'error', desc: '{ code, message, retryable? }?' },
      ],
      tbd: [{ key: '其余字段', desc: 'A 正式 DriverRunResult 冻结后补全' }],
      events: [],
      risk: '失败 + retryable 会触发 N7 重试回流。',
      nextAction: '进入 N9 注册 Artifact。',
    },
    {
      id: s('n9-artifact'),
      code: 'N9',
      label: 'Register Artifact',
      labelCn: '注册 Artifact',
      lane,
      direction: 'C',
      column: 9,
      tier: 'milestone',
      deps: [s('n8-driver-result')],
      owner: ownerName,
      status: 'pending',
      taskStatus: 'running',
      frozen: 'frozen',
      summary: '_coord.artifact.register：登记补丁 / 测试日志等产物 ArtifactRef。',
      input: ['Artifact'],
      output: ['ArtifactRef'],
      decided: [
        { key: 'artifact_id', desc: 'string' },
        {
          key: 'type',
          desc: 'patch | diff | test_log | transcript | driver_report | review | ...',
        },
        { key: 'uri', desc: '查看/下载地址' },
        { key: 'sha256', desc: 'string?' },
        { key: 'producer_type', desc: 'agent | driver | gate | council | merger | runtime' },
        { key: 'created_at', desc: '时间' },
      ],
      tbd: [],
      events: [],
      risk: '—',
      nextAction: '两条子链产物在 N10 收敛。',
    },
  ];
}

const backendSegment = makeExecSegment('be', 'Backend', 'Backend Agent · backend-a');
const testSegment = makeExecSegment('te', 'Test', 'Test Agent · test-agent');

/** 并行段按 column 交错排列（同列 Backend 在前、Test 在后），保证数组按 (column, lane) 有序 */
const parallelSegment: WorkflowNodeData[] = backendSegment.flatMap((be, i) => [be, testSegment[i]]);

export const workflowNodes: WorkflowNodeData[] = [
  {
    id: 'n0-intake',
    code: 'N0',
    label: 'Intake',
    labelCn: '需求到达',
    lane: 'User',
    direction: 'User',
    column: 0,
    tier: 'human',
    deps: [],
    owner: 'User / 前端',
    status: 'pending',
    taskStatus: null,
    statusNote: 'pre-task · 字段未冻结',
    frozen: 'tbd',
    summary: '接收用户提出的原始需求文本，作为整条协作链路的入口。',
    input: ['用户原始需求文本'],
    output: ['raw_spec_text'],
    decided: [{ key: 'raw_spec_text', desc: '需求文本' }],
    tbd: [
      { key: 'submitted_at', desc: '提交时间' },
      { key: 'submitter', desc: '提交人' },
      { key: 'attachments', desc: '附件' },
    ],
    events: [],
    risk: '需求结构尚未冻结，先按「文本 + 可选元信息」渲染。',
    nextAction: '进入 N1 Triage 进行分诊。',
  },
  {
    id: 'n1-triage',
    code: 'N1',
    label: 'Triage',
    labelCn: '分诊',
    lane: 'System',
    direction: 'C',
    column: 1,
    tier: 'milestone',
    deps: ['n0-intake'],
    owner: 'C / Runtime（M3）',
    status: 'pending',
    taskStatus: null,
    statusNote: '(triaged) · 扩展态，v0 不要求',
    frozen: 'tbd',
    summary:
      '分析需求风险、影响路径与建议角色，拆分为可并行的子任务，产出 TaskCreateRequest 草案。',
    input: ['raw_spec_text'],
    output: ['TaskCreateRequest 草案'],
    decided: [],
    tbd: [
      { key: 'risk_level', desc: 'low | medium | high | critical' },
      { key: 'affected_paths', desc: '影响文件路径' },
      { key: 'role_id', desc: '建议角色' },
      { key: 'completion_criteria_draft', desc: '完成标准草案' },
    ],
    events: [],
    risk: '分诊结果结构尚未冻结，留扩展位。',
    nextAction: '进入 N2 创建 Task。',
  },
  {
    id: 'n2-create-task',
    code: 'N2',
    label: 'Create Task',
    labelCn: '创建 Task',
    lane: 'System',
    direction: 'C',
    column: 2,
    tier: 'machine',
    deps: ['n1-triage'],
    owner: 'Coordinator',
    status: 'pending',
    taskStatus: 'created',
    frozen: 'frozen',
    summary: '_coord.task.create：用 TaskCreateRequest 创建 Task(created)。',
    input: ['TaskCreateRequest'],
    output: ['Task(created)'],
    decided: [
      { key: 'task_id', desc: 'string' },
      { key: 'status', desc: 'created' },
      { key: 'spec', desc: '需求文本' },
      { key: 'completion_criteria', desc: 'string[] 完成标准（非空）' },
      { key: 'risk_level', desc: 'string?' },
      { key: 'affected_paths', desc: 'string[]?' },
      { key: 'role_id', desc: 'string?' },
      {
        key: 'budget',
        desc: '{ max_tokens?, max_wall_clock_seconds?, max_tool_calls?, deadline_at? }?',
      },
      { key: 'created_at', desc: '时间' },
      { key: 'updated_at', desc: '时间' },
    ],
    tbd: [],
    events: ['task.created'],
    risk: 'completion_criteria 必须非空，否则后续 Gate 无法判定完成。',
    nextAction: '进入 N3 创建 Run。',
  },
  {
    id: 'n3-create-run',
    code: 'N3',
    label: 'Create Run',
    labelCn: '创建 Run',
    lane: 'System',
    direction: 'C',
    column: 3,
    tier: 'machine',
    deps: ['n2-create-task'],
    owner: 'C / Runtime',
    status: 'pending',
    taskStatus: 'created',
    frozen: 'frozen',
    summary:
      '_coord.run.create：为 Task 创建一次执行 Run(created)，随后分发给 Backend / Test 两个角色 Agent 并行认领。',
    input: ['task_id'],
    output: ['Run(created)'],
    decided: [
      { key: 'run_id', desc: 'string' },
      { key: 'task_id', desc: 'string' },
      { key: 'status', desc: 'created' },
      { key: 'event_ids', desc: 'string[] 关联事件' },
    ],
    tbd: [],
    events: [],
    risk: '—',
    nextAction: '分叉为 Backend / Test 两条并发子链（各自 N4 认领）。',
  },
  ...parallelSegment,
  {
    id: 'n10-task-completed',
    code: 'N10',
    label: 'task.completed',
    labelCn: '完成事件',
    lane: 'System',
    direction: 'C',
    column: 10,
    tier: 'machine',
    deps: ['n9-artifact-be', 'n9-artifact-te'],
    owner: 'Coordinator',
    status: 'pending',
    taskStatus: 'reviewing',
    frozen: 'frozen',
    summary: '两条子链产物收敛；发出 task.completed 事件，任务进入 reviewing，触发 Hook 路由。',
    input: ['ArtifactRef（Backend）', 'ArtifactRef（Test）'],
    output: ['Event(task.completed)'],
    decided: [
      { key: 'event_id', desc: 'string' },
      { key: 'event_type', desc: 'task.completed' },
      { key: 'task_id', desc: 'string' },
      { key: 'run_id', desc: 'string?' },
      { key: 'created_at', desc: '时间' },
      { key: 'payload', desc: 'object' },
    ],
    tbd: [],
    events: ['task.completed'],
    risk: '需等待全部并行子链产物齐备方可收敛。',
    nextAction: '进入 N11/N12 Hook 匹配。',
  },
  {
    id: 'n11-hook-gate',
    code: 'N11/N12',
    label: 'Hook + GateRequest',
    labelCn: 'Hook 匹配',
    lane: 'System',
    direction: 'D',
    column: 11,
    tier: 'machine',
    deps: ['n10-task-completed'],
    owner: 'D · Hook/Gate',
    status: 'pending',
    taskStatus: 'reviewing',
    frozen: 'frozen',
    summary: 'HookEvent 命中检查点，路由到对应 Gate 并生成 GateRequest。',
    input: ['HookEvent'],
    output: ['HookResult', 'GateRequest'],
    decided: [
      { key: 'event_type', desc: 'task.completed | before_merge' },
      { key: 'matched_hook_point', desc: '命中的检查点' },
      { key: 'gate_point', desc: 'string' },
      { key: 'subject_id', desc: '被检查对象' },
    ],
    tbd: [],
    events: [],
    risk: '—',
    nextAction: '进入 N13 Gate 决策。',
  },
  {
    id: 'n13-gate',
    code: 'N13',
    label: 'Gate Decision',
    labelCn: 'Gate 决策',
    lane: 'Security',
    direction: 'D',
    column: 12,
    tier: 'human',
    deps: ['n11-hook-gate'],
    owner: 'D → C',
    status: 'pending',
    taskStatus: 'reviewing',
    statusNote: '→ blocked / waiting_input / pending_gate / pending_council',
    frozen: 'frozen',
    gateDecision: 'defer',
    summary: 'Gate 给出 allow/deny/ask/defer 决策。本次存在权限策略分歧，判为 defer → 证据化决策。',
    input: ['GateRequest'],
    output: ['GateResult / GateResultRecord'],
    decided: [
      { key: 'decision', desc: 'allow | deny | ask | defer' },
      { key: 'reason', desc: '原因' },
      { key: 'required_actions', desc: 'string[] 需要补的动作' },
      { key: 'target_state', desc: 'string?' },
      { key: 'audit_ref', desc: 'string?' },
      { key: 'created_at', desc: '时间' },
    ],
    tbd: [],
    events: ['lifecycle.human_gate'],
    risk: '决策直接决定任务落点状态，需可审计（audit_ref）。',
    nextAction: 'defer → 进入 N14 Council 证据化裁决。',
  },
  {
    id: 'n14-council',
    code: 'N14',
    label: 'Council',
    labelCn: '议会（可选）',
    lane: 'Council',
    direction: 'C',
    column: 13,
    tier: 'human',
    deps: ['n13-gate'],
    owner: 'C / Council',
    status: 'pending',
    taskStatus: 'pending_council',
    frozen: 'partial',
    summary: '_council.run_mock：多 Agent 给出方案与证据，由用户基于证据裁决。',
    input: ['CouncilRunRequest'],
    output: ['CouncilDecision'],
    decided: [
      { key: 'decision_id', desc: 'string' },
      { key: 'verdict', desc: 'select | needs_human | request_revision | reject' },
      { key: 'selected_proposal_id', desc: 'string?' },
      { key: 'reason', desc: 'string' },
      { key: 'evidence_refs', desc: 'string[] 证据引用' },
      { key: 'risk_signals', desc: 'string[]?' },
    ],
    tbd: [{ key: 'N-way Diff / PPC 可视化', desc: '后置能力，暂无' }],
    events: ['council.decision'],
    risk: 'CouncilDecision 不能直接授权 merge，需经 N15。',
    nextAction: 'verdict=select → 进入 N15 合并授权。',
  },
  {
    id: 'n15-merge-auth',
    code: 'N15',
    label: 'Merge Authorization',
    labelCn: '合并授权',
    lane: 'System',
    direction: 'C',
    column: 14,
    tier: 'milestone',
    deps: ['n14-council'],
    owner: 'C / Runtime',
    status: 'pending',
    taskStatus: 'reviewing',
    frozen: 'frozen',
    summary: '生成 MergeAuthorization——只有 authorized=true 才能进入合并边界。',
    input: ['GateResultRecord / CouncilDecision'],
    output: ['MergeAuthorization'],
    decided: [
      { key: 'merge_authorization_id', desc: 'string' },
      { key: 'authorized', desc: 'bool 是否授权' },
      { key: 'source', desc: 'deterministic_gate | human | human_delegated | council_advisory' },
      { key: 'target_branch', desc: '目标分支' },
      { key: 'allowed_paths', desc: 'string[] 允许路径' },
      { key: 'expires_at', desc: '时间?' },
      { key: 'created_at', desc: '时间' },
    ],
    tbd: [],
    events: ['task.before_merge'],
    risk: '授权过期或路径不匹配会在 N17 被拦截。',
    nextAction: '进入 N16 保存 Checkpoint。',
  },
  {
    id: 'n16-checkpoint',
    code: 'N16',
    label: 'Checkpoint',
    labelCn: '保存 Checkpoint',
    lane: 'System',
    direction: 'C',
    column: 15,
    tier: 'machine',
    deps: ['n15-merge-auth'],
    owner: 'Coordinator',
    status: 'pending',
    taskStatus: null,
    statusNote: '任意非终态均可触发',
    frozen: 'frozen',
    summary: '_coord.state.checkpoint：保存协作边界状态，支持超时/中断后恢复。',
    input: ['CheckpointRequest'],
    output: ['Checkpoint'],
    decided: [
      { key: 'checkpoint_id', desc: 'string' },
      {
        key: 'trigger',
        desc: 'manual | periodic | shutdown | blocked | gate_result | timeout | budget_exceeded',
      },
      { key: 'mechanical_snapshot', desc: '{ base_commit, branch, modified_files[] }' },
      { key: 'semantic_handoff', desc: '{ done[], in_progress[], next_steps[], known_risks[] }' },
      { key: 'validity_status', desc: 'valid | invalid | needs_migration' },
      { key: 'created_at', desc: '时间' },
    ],
    tbd: [],
    events: ['agent.checkpoint'],
    risk: 'valid 仅表示链可恢复，不等于可直接写。',
    nextAction: '进入 N17 合并边界。',
  },
  {
    id: 'n17-merge-boundary',
    code: 'N17',
    label: 'Merge Boundary',
    labelCn: '合并边界',
    lane: 'System',
    direction: 'Merger',
    column: 16,
    tier: 'machine',
    deps: ['n16-checkpoint'],
    owner: 'Merger',
    status: 'pending',
    taskStatus: null,
    statusNote: 'merging · v0 reserved',
    frozen: 'reserved',
    summary:
      '唯一写集成分支的组件：授权校验 → gate refs 校验 → 试合并 → 合入前 Gate → integrated。',
    input: ['MergeAuthorization'],
    output: ['集成分支写入'],
    decided: [
      {
        key: 'boundary_state',
        desc: 'merge_requested → authorization_check → gate_refs_check → trial_merge → before_merge → integrated',
      },
      {
        key: 'failure_state',
        desc: 'authorization_missing | gate_refs_missing | merge_conflict | gate_blocked',
      },
    ],
    tbd: [{ key: 'trial_merge / integrated', desc: 'v0 不要求完整实现' }],
    events: ['task.before_merge'],
    risk: 'Council 推荐不能跳过 authorization_check → trial_merge → before_merge。',
    nextAction: '进入 N18 Run 完成。',
  },
  {
    id: 'n18-run-complete',
    code: 'N18',
    label: 'Run Complete',
    labelCn: 'Run 完成',
    lane: 'System',
    direction: 'C',
    column: 17,
    tier: 'milestone',
    deps: ['n17-merge-boundary'],
    owner: 'C / Runtime',
    status: 'pending',
    taskStatus: 'completed',
    frozen: 'frozen',
    summary: '_coord.run.complete：Run 落终态 completed，汇总生成 Delivery Report。',
    input: ['run_id'],
    output: ['Run(completed)', 'Delivery Report'],
    decided: [
      { key: 'run_id', desc: 'string' },
      { key: 'status', desc: 'completed | failed | cancelled' },
      { key: 'completed_at', desc: '时间' },
      { key: 'event_ids', desc: 'string[]' },
    ],
    tbd: [],
    events: ['task.completed'],
    risk: '建议交付后重点复核 Admin 角色权限范围。',
    nextAction: '查看 Delivery Report，完成本次任务闭环。',
  },
];

/** 链路最大列号（末列） */
export const MAX_COLUMN = Math.max(...workflowNodes.map((n) => n.column));

/** 某列在 nodes 数组中的全部下标 */
export function indicesInColumn(nodes: WorkflowNodeData[], col: number): number[] {
  const out: number[] = [];
  nodes.forEach((n, i) => {
    if (n.column === col) out.push(i);
  });
  return out;
}

/** 某列的主节点（首个）下标，用于 activeStepIndex */
export function primaryIndexInColumn(nodes: WorkflowNodeData[], col: number): number {
  return nodes.findIndex((n) => n.column === col);
}

/** 揭示到第 col 列（含）时应显示的节点数（数组按 column 有序，等于前缀长度） */
export function revealedCountThroughColumn(nodes: WorkflowNodeData[], col: number): number {
  return nodes.filter((n) => n.column <= col).length;
}

/** 关键节点索引（供 store / UI 定位特殊交互） */
export const GATE_NODE_INDEX = workflowNodes.findIndex((n) => n.id === 'n13-gate');
export const COUNCIL_NODE_INDEX = workflowNodes.findIndex((n) => n.id === 'n14-council');

/** 节点 id 常量（避免散落的字符串字面量） */
export const NODE_IDS = {
  intake: 'n0-intake',
  gate: 'n13-gate',
  council: 'n14-council',
  complete: 'n18-run-complete',
} as const;

/** 执行段（N4–N9）基础 id；并发子链节点 id = `${base}-${suffix}`，suffix 由派单决定 */
export const EXEC_BASE_IDS = [
  'n4-claim',
  'n5-contextpack',
  'n6-start-driver',
  'n7-executing',
  'n8-driver-result',
  'n9-artifact',
] as const;

/** 剥去执行子链后缀还原基础 id（-be / -te / 任意 agent 后缀均可），非执行段原样返回 */
export function stripExecSuffix(id: string): string {
  return EXEC_BASE_IDS.find((base) => id.startsWith(`${base}-`)) ?? id;
}

/** 一条执行子链的参与者规格：后端派单的一个 agent（lane 即该 agent 的泳道） */
export type ExecAgentSpec = { suffix: string; lane: Lane; owner: string };

/**
 * 按参与执行的 agent 列表组合 N0–N18 工作流。
 *
 * E 的立场：执行子链/泳道的条数是后端 agent 自主决策的既成事实——后端派几个
 * agent，这里就生成几条 N4–N9 子链；前端不预设条数。共享前段（N0–N3）与收敛
 * 后段（N10–N18）取自模板，N10 的 deps 改指所有子链的 N9（fan-in）。
 */
export function composeRunWorkflowNodes(agents: ExecAgentSpec[]): WorkflowNodeData[] {
  const segments = agents.map((a) => makeExecSegment(a.suffix, a.lane, a.owner));
  // 并发子链按 column 交错，保证数组按 (column, agent 顺序) 有序
  const interleaved = segments.length
    ? segments[0].flatMap((_, i) => segments.map((seg) => seg[i]))
    : [];
  const shared = workflowNodes.filter((n) => stripExecSuffix(n.id) === n.id);
  const pre = shared.filter((n) => n.column <= 3);
  const post = shared
    .filter((n) => n.column >= 10)
    .map((n) =>
      n.id === 'n10-task-completed'
        ? { ...n, deps: agents.map((a) => `n9-artifact-${a.suffix}`) }
        : n,
    );
  return [...pre, ...interleaved, ...post];
}
