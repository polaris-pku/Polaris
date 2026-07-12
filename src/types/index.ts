// 与后端契约镜像对齐：UI 直接复用契约里"完全一致"的枚举，
// 让后端契约漂移在编译期咬住前端。刻意换了词表的状态机（TaskStatusCore /
// CouncilVerdict）不在此直接替换，改由 src/api/map.ts 的 Record 桥接映射兜住。
import type {
  AgentLifecycle,
  AgentMetrics,
  Event as ContractEvent,
  ExperienceView,
  FileOpObservation,
  FilePermissionOutcome,
  FrontendRunSnapshot,
  GateDecision as ContractGateDecision,
  PersonaDef,
  SkillView,
} from '@/api/types';
// 仅类型引用（编译期擦除），不构成运行时循环依赖
import type { Scenario } from '@/data/scenario';

export type PageKey = 'agents' | 'tasks' | 'council' | 'file';

/** 文件树节点：有 children 即目录，无则为文件 */
export type FileNode = {
  name: string;
  children?: FileNode[];
};

/** 一个工作项目（IDE 启动页选择/新建的单位） */
export type Project = {
  id: string;
  name: string;
  description?: string;
  /** 最近打开时间的人读展示串（mock） */
  lastOpened: string;
  /** 技术栈 / 标签，用于列表展示 */
  tags: string[];
  /**
   * 项目在本机磁盘上的根目录（用户自选，agent 生成的文件写到这里）。
   * 缺省写入默认工作区 文档/polaris-workspace/<项目名>/。仅桌面版有意义。
   */
  rootPath?: string;
  /** 项目文件树（mock；从文件夹打开时为磁盘扫描结果） */
  files: FileNode[];
  /** 项目 Agent 团队（引用全局 Agent 池的 id 子集） */
  agentIds: string[];
};

/**
 * 回放节点的一条后端事实：字段名 = 快照原文值。
 * `time` 仅在后端对该数据给了时间戳时存在（E 不插值、不编造时刻）。
 */
export type RunNodeFact = { key: string; value: string; time?: string };

/**
 * 真实后端 run 的回放数据源（样例任务用），全部内容由 `buildRunReplay(snapshot)`
 * 从后端快照程序化派生——后端给什么展示什么，E 不补写、不预设。
 * 挂在任务上后，泳道图推进的各内容查找点（时间线日志 / 节点执行日志 /
 * 后端事实 / 场景 / 文件操作流 / 事件通道）只取这里的数据，缺失即为
 * 「本次 run 未提供」。key 一律用去掉执行子链后缀的节点 id。
 */
export type RunReplay = {
  /** 后端落盘的快照原件（frontend-snapshot.json），审计与展示的真相源 */
  snapshot: FrontendRunSnapshot;
  /** 节点 id → 执行时间轴日志（替换 data/logs.ts 的 mock 文案） */
  nodeLogs: Record<string, LogEntry & { checkpoint?: TimelineCheckpoint }>;
  /** 节点 id → Node Inspector 执行日志明细 */
  nodeExecLogs: Record<string, NodeExecutionLogDetail>;
  /** 节点 id → 后端给出的事实字段（Node Inspector「本次 Run · 后端数据」区块） */
  nodeFacts: Record<string, RunNodeFact[]>;
  /** 节点 id → 点亮该列时喂入事件通道的契约事件（按主节点 id 取，整列只喂一次） */
  nodeEvents: Record<string, ContractEvent[]>;
  /** 节点 id → 文件操作观测流（替换 data/fileops.ts 的 mock 剧本；含后缀 id） */
  nodeFileOps: Record<string, FileOpObservation[]>;
  /** 场景内容（需求分析/议会/交付报告），替代按需求文本推导的 deriveScenario */
  scenario: Scenario;
  /** 本次 run 的 Gate 实际走向；allow = 未升级 Council，推进时直通 N14 */
  gateDecision: GateDecision;
};

/** 单个任务及其泳道图执行状态 */
export type DemoTask = {
  id: string;
  /** 所属项目 id */
  projectId: string;
  title: string;
  taskText: string;
  /** 该任务绑定的 Agent 团队（按需求推荐，随任务走，可自定义） */
  assignedAgentIds: string[];
  /** 后端（C）受理后回填的权威 task_id；缺失表示尚未受理或提交失败 */
  contractTaskId?: string;
  /** 后端受理后回填的 run_id（run.create 一次性建 Task + Run 并立刻开跑）；
   *  缺失 = 未接后端或提交失败。真实 run 的事件/快照都按它索引。 */
  contractRunId?: string;
  /** 用户在 N0 自报的验收标准（随 TaskCreateRequest.completion_criteria 上送） */
  completionCriteria?: string[];
  /** 文件写入权限确认结果（tool_event_id → 人选的 outcome），随任务持久化。
   *  可选：兼容旧版存盘文件（缺失按空记录处理） */
  filePermissionOutcomes?: Record<string, FilePermissionOutcome>;
  /** 真实后端 run 的回放数据源；缺失 = 普通 mock 剧本任务 */
  replay?: RunReplay;
  stage: DemoStage;
  analysisReady: boolean;
  nodes: WorkflowNodeData[];
  revealedNodeCount: number;
  activeStepIndex: number;
  selectedNodeId: string | null;
  interventionRules: InterventionRule[];
  confirmedCouncilOptionId: string | null;
  interventionFeedback: string | null;
  timeline: TimelineEvent[];
};

export type DemoStage =
  | 'idle'
  | 'team_configured'
  | 'analyzing'
  | 'workflow_recommended'
  | 'executing'
  | 'intervention'
  | 'council'
  | 'delivery';

/** Agent 生命周期状态（方向 B `AgentStatusSchema`）。 */
export type AgentStatus = AgentLifecycle;

/**
 * Agent Board 的一名 AI 员工 —— 只承载方向 B 刻画的画像/记忆。
 * 形状对齐 BCD `agent-board-query.ts` 的 `AgentBoardAgentView`（+ 懒加载的技能/经验列表）。
 * 运行态 session/worktree/lease 属 A/C，不在 Agent Board 展示。
 *
 * `id` 是 E 侧稳定句柄（store/scenario 用）；`role_id` 是 B 契约身份键。
 */
export type Agent = {
  id: string;
  role_id: string;
  name: string;
  status: AgentStatus;
  /** B `tags` —— 取代旧的 capabilityTags + 技能墙 */
  tags: string[];
  created_at: string;
  /** B 角色画像 */
  persona: PersonaDef;
  /** B 原始指标（比率类由 calculateDerivedMetrics 派生） */
  metrics: AgentMetrics;
  /** 懒加载技能列表（SkillView 精简投影） */
  skills: SkillView[];
  /** 懒加载经验列表（ExperienceView 精简投影） */
  experiences: ExperienceView[];
};

export type WorkflowNodeStatus = 'pending' | 'active' | 'done' | 'blocked' | 'updated';

/**
 * 泳道 = 执行角色分区。固定泳道（User / 调度 / 安全 / 议会）之外，
 * 执行泳道由后端派单决定：每个参与执行的 agent 一条泳道（泳道名即 agent 身份），
 * 故保持开放——后端派几个 agent 就画几条，E 只投影不预设。
 */
export type Lane = 'User' | 'System' | 'Backend' | 'Test' | 'Security' | 'Council' | (string & {});

/** 协调器 Task 主状态机的 11 个核心态（见 需求到处理状态机 §3） */
export type TaskStatusCore =
  | 'created'
  | 'claimed'
  | 'running'
  | 'waiting_input'
  | 'pending_gate'
  | 'pending_council'
  | 'reviewing'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Gate 四种决策（见 字段清单 N13）—— 直接复用契约镜像的 `GateDecision`（方向 D）。 */
export type GateDecision = ContractGateDecision;

/** 节点责任方：A=Driver执行 B=角色记忆 C=主链路编排 D=Hook/Gate */
export type NodeDirection = 'User' | 'A' | 'B' | 'C' | 'D' | 'Merger';

/** 冻结度：frozen=可直接对接 partial=部分待定 tbd=尚未冻结 reserved=后置 */
export type FrozenLevel = 'frozen' | 'partial' | 'tbd' | 'reserved';

/** 字段清单中的一条字段（key + 中文释义/类型说明） */
export type FieldSpec = { key: string; desc: string };

/**
 * 节点信息分层（泳道图渐进披露的依据）：
 * - human：人的时刻（需求输入 / 可介入 / Gate ask / Council）——始终大卡片、琥珀前置
 * - milestone：人关心结果的里程碑（分诊结论 / 产物 / 授权 / 交付）——大卡片
 * - machine：A/B/C/D 内部握手（建 Run / ContextPack / Hook 匹配…）——默认折叠成小胶囊，
 *   活动中 / 被选中 / 全局展开时还原为大卡片
 */
export type NodeTier = 'human' | 'milestone' | 'machine';

export type WorkflowNodeData = {
  id: string;
  /** 流程图节点编号，如 N0 / N13 */
  code: string;
  label: string;
  /** 节点中文名 */
  labelCn: string;
  lane: Lane;
  /** 责任方 A/B/C/D/User/Merger（Spec 归属，与泳道角色解耦） */
  direction: NodeDirection;
  /** 网格列号（x 轴）；并行兄弟节点共用同一 column */
  column: number;
  /** 信息分层（必填，保证每个节点都被显式归类） */
  tier: NodeTier;
  /** 前驱节点 id 列表，作为连线与揭示门控的真相源 */
  deps: string[];
  owner: string;
  status: WorkflowNodeStatus;
  /** 该节点对应的协调器主状态（N0/N1/N16/N17 无核心态时为 null） */
  taskStatus: TaskStatusCore | null;
  /** 状态补充说明（如 N13 的分支落点、N17 的 reserved 提示） */
  statusNote?: string;
  frozen: FrozenLevel;
  summary: string;
  input: string[];
  output: string[];
  /** 字段清单中该节点 decided（已定）字段 */
  decided: FieldSpec[];
  /** 字段清单中该节点 tbd（待定）字段 */
  tbd: FieldSpec[];
  /** 该节点 emit 的标准事件类型 */
  events: string[];
  /** 仅 N13 Gate：本次 demo 走的决策分支 */
  gateDecision?: GateDecision;
  risk: string;
  nextAction: string;
};

/** N14 CouncilDecision.verdict（字段清单 N14） */
export type CouncilVerdict = 'select' | 'needs_human' | 'request_revision' | 'reject';

export type CouncilOption = {
  id: string;
  title: string;
  proposedBy: string;
  summary: string;
  pros: string[];
  risks: string[];
  impactedFiles: string[];
  scores: Record<string, number>;
  recommended?: boolean;
};

export type InterventionScope =
  | 'current_step'
  | 'current_agent'
  | 'whole_workflow'
  | 'project_rule';

export type InterventionRule = {
  text: string;
  scope: InterventionScope;
  affectedAgents: string[];
};

export type DiscussionMessage = {
  agent: string;
  role: string;
  message: string;
  accent: 'backend' | 'test' | 'security' | 'system';
};

export type LogLevel = 'info' | 'success' | 'warning' | 'council';

export type LogEntry = {
  time: string;
  source: string;
  text: string;
  level: LogLevel;
};

export type TimelineCheckpoint = {
  label: string;
  description: string;
};

/** 可回溯的 Demo 执行快照 */
export type DemoSnapshot = {
  stage: DemoStage;
  currentPage: PageKey;
  nodes: WorkflowNodeData[];
  revealedNodeCount: number;
  activeStepIndex: number;
  selectedNodeId: string | null;
  interventionRules: InterventionRule[];
  confirmedCouncilOptionId: string | null;
  interventionFeedback: string | null;
};

export type TimelineEvent = LogEntry & {
  id: string;
  checkpoint?: TimelineCheckpoint;
  snapshot: DemoSnapshot;
};

export type NodeExecLogLevel = LogLevel | 'debug';

/** 单条节点内部执行日志 */
export type NodeExecLogLine = {
  time: string;
  tag: string;
  message: string;
  level: NodeExecLogLevel;
};

/** 某节点的完整执行日志（mock） */
export type NodeExecutionLogDetail = {
  duration?: string;
  tokenUsage?: string;
  lines: NodeExecLogLine[];
};
