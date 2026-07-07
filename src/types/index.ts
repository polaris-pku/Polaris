// 与后端契约镜像对齐：UI 直接复用契约里"完全一致"的枚举，
// 让后端契约漂移在编译期咬住前端。刻意换了词表的状态机（TaskStatusCore /
// CouncilVerdict）不在此直接替换，改由 src/api/map.ts 的 Record 桥接映射兜住。
import type {
  AgentRuntimeStatus,
  FilePermissionOutcome,
  GateDecision as ContractGateDecision,
  LeaseScope,
  LeaseStatus,
} from '@/api/types';

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
   * 缺省写入默认工作区 文档/hci-ide-workspace/<项目名>/。仅桌面版有意义。
   */
  rootPath?: string;
  /** 项目文件树（mock；从文件夹打开时为磁盘扫描结果） */
  files: FileNode[];
  /** 项目 Agent 团队（引用全局 Agent 池的 id 子集） */
  agentIds: string[];
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
  /** 用户在 N0 自报的验收标准（随 TaskCreateRequest.completion_criteria 上送） */
  completionCriteria?: string[];
  /** 文件写入权限确认结果（tool_event_id → 人选的 outcome），随任务持久化。
   *  可选：兼容旧版存盘文件（缺失按空记录处理） */
  filePermissionOutcomes?: Record<string, FilePermissionOutcome>;
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

/** 与契约镜像 `AgentRuntimeState.status` 同源（方向 B）。 */
export type AgentStatus = AgentRuntimeStatus;

/**
 * N4 认领时签发的文件租约 FileLease（字段清单 N4.file_lease）。
 * scope/status 直接采用契约镜像的 `LeaseScope`/`LeaseStatus`（对齐 BCD core/lease.ts）。
 */
export type FileLease = {
  lease_id: string;
  path_glob: string;
  scope: LeaseScope;
  expires_at: string;
  status: LeaseStatus;
};

/** N4 AgentRecord + N6 Driver Session 的运行态身份（字段清单 N4.agent / N6） */
export type AgentRuntime = {
  agent_id: string;
  role_id: string;
  driver_id: string;
  /** Driver 展示名（字段清单外，便于人读） */
  driver_name: string;
  session_id?: string;
  worktree_id?: string;
  last_heartbeat?: string;
};

export type Agent = {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  successRate: number;
  acceptedRate: number;
  avgCompletionTime: string;
  tokenCost: string;
  skills: string[];
  historicalTasks: number;
  failureCount: number;
  collaboration: '优秀' | '良好' | '一般';
  recentTask: string;
  description: string;
  /** N4/N6 运行态身份 */
  runtime: AgentRuntime;
  /** N5 ContextPack.capability_tags */
  capabilityTags: string[];
  /** 当前持有的文件租约（未认领时为空） */
  fileLease?: FileLease;
};

export type WorkflowNodeStatus = 'pending' | 'active' | 'done' | 'blocked' | 'updated';

/** 泳道 = 执行角色分区（User / 调度 / 后端 / 测试 / 安全 / 议会） */
export type Lane = 'User' | 'System' | 'Backend' | 'Test' | 'Security' | 'Council';

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
