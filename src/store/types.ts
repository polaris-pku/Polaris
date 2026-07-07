import type { StateCreator } from 'zustand';
import type {
  DemoStage,
  DemoTask,
  InterventionRule,
  PageKey,
  Project,
  WorkflowNodeData,
} from '@/types';
import type { EventChannelStatus } from '@/api/events';
import type { Event as ContractEvent, FilePermissionOutcome } from '@/api/types';
import type { AgentFileWriteResult } from '@/lib/agentFs';

/** 单个任务的执行 trace（agent 执行过程的审计快照，只读；不支持导回应用）。 */
export type TaskTrace = Pick<
  DemoTask,
  | 'id'
  | 'contractTaskId'
  | 'title'
  | 'taskText'
  | 'completionCriteria'
  | 'assignedAgentIds'
  | 'stage'
  | 'interventionRules'
  | 'filePermissionOutcomes'
  | 'confirmedCouncilOptionId'
  | 'timeline'
>;

/** 项目级执行 trace 存盘载荷：任务时间线 + 人机确认 + 落盘回执 + 事件观测窗口。 */
export type ProjectTrace = {
  format: 'polaris-agent-trace';
  version: number;
  savedAt: string;
  project: Pick<Project, 'id' | 'name' | 'rootPath'>;
  tasks: TaskTrace[];
  /** Agent 生成文件的落盘回执（tool_event_id → 结果，会话级观测） */
  agentFileWrites: Record<string, AgentFileWriteResult>;
  /** 事件通道观测窗口（新在前，封顶 EVENT_LOG_CAP 条） */
  backendEvents: ContractEvent[];
};

export const PROJECT_TRACE_FORMAT = 'polaris-agent-trace' as const;

/** 一次流程推进落盘的执行态切片（快照/时间线用同一形状）。 */
export type PartialExecState = {
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

/** 随活动任务持久化的实时字段（任务切换/回写的最小集合）。 */
export type TaskFields = Pick<
  DemoTask,
  | 'taskText'
  | 'assignedAgentIds'
  | 'stage'
  | 'analysisReady'
  | 'nodes'
  | 'revealedNodeCount'
  | 'activeStepIndex'
  | 'selectedNodeId'
  | 'interventionRules'
  | 'confirmedCouncilOptionId'
  | 'interventionFeedback'
  | 'filePermissionOutcomes'
  | 'timeline'
>;

/** 项目域：项目生命周期与项目文件树。 */
export type ProjectSlice = {
  /** rootPath：用户自选的保存目录（经原生选择器授权）；缺省用 文档/polaris-workspace/<项目名> */
  createProject: (name: string, description?: string, rootPath?: string) => void;
  /**
   * 从本机文件夹打开项目（仅桌面版）：弹原生目录选择器 → 扫描文件树 → 建项目并进入。
   * 返回 null 表示成功或用户取消；返回字符串为需要展示的错误消息。
   */
  openProjectFromFolder: () => Promise<string | null>;
  openProject: (projectId: string) => void;
  closeProject: () => void;
  deleteProject: (projectId: string) => void;
  /** 汇出项目的 agent 执行 trace（含活动任务的最新实时状态）；项目不存在返回 null */
  buildProjectTrace: (projectId: string) => ProjectTrace | null;
  addFile: (projectId: string, rawName: string) => void;
  deleteFile: (projectId: string, path: string) => void;
  /** 在文件查看页打开一个项目文件（必要时先切换聚焦项目） */
  openFile: (projectId: string, path: string) => void;
  /** 关闭文件查看页，回到任务/团队视图 */
  closeFile: () => void;
};

/** 团队域：Agent 选择与组队定制。 */
export type TeamSlice = {
  selectAgent: (agentId: string) => void;
  assignAgent: (agentId: string) => void;
  enableTeamCustomization: () => void;
  disableTeamCustomization: () => void;
  resetTeamToRecommended: () => void;
};

/** 任务域：任务生命周期与页面导航。 */
export type TaskSlice = {
  setPage: (page: PageKey) => void;
  setTaskText: (text: string) => void;
  createTask: (rawText: string, title?: string, completionCriteria?: string[]) => void;
  startTask: () => void;
  selectTask: (taskId: string) => void;
  deleteTask: (taskId: string) => void;
  /** 加载后端真实 run 的样例回放（建样例项目 + 回放任务；已加载过则直接切换过去） */
  loadSampleRun: () => void;
};

/** 执行域：工作流推进引擎（单步/自动/回退/交付）。 */
export type ExecutionSlice = {
  useRecommendedWorkflow: () => void;
  nextStep: () => void;
  autoRun: () => void;
  stopAutoRun: () => void;
  resetDemo: () => void;
  selectNode: (nodeId: string | null) => void;
  showDelivery: () => void;
  restoreCheckpoint: (eventId: string) => void;
};

/** 介入域：人对流程的干预（业务规则注入、文件写权限确认）。 */
export type InterventionSlice = {
  addInterventionRule: (rule: InterventionRule) => void;
  /** 文件写入权限确认（N7 · lifecycle.human_gate 的文件层落点）：记录人选结果，获准则落盘 */
  resolveFilePermission: (toolEventId: string, outcome: FilePermissionOutcome) => void;
  /** 回写一次落盘结果（keyed by tool_event_id）；写成功时同步把文件挂进项目文件树 */
  recordAgentFileWrite: (toolEventId: string, result: AgentFileWriteResult) => void;
};

/** 议会域：进入议会与裁决收束。 */
export type CouncilSlice = {
  goToCouncil: () => void;
  confirmCouncilOption: (optionId: string) => void;
};

/** 全量 store 形状 = 数据字段 + 各领域切片的动作。 */
export type DemoState = PartialExecState &
  TaskFields & {
    selectedAgentId: string | null;
    assignedAgentIds: string[];
    teamCustomizationEnabled: boolean;
    isAutoRunning: boolean;
    tasks: DemoTask[];
    activeTaskId: string | null;
    projects: Project[];
    /** null = 停留在启动页；有值 = 已进入工作区 */
    activeProjectId: string | null;
    /** 后端事件通道推来的流程事件（新在前，封顶保留 EVENT_LOG_CAP 条） */
    backendEvents: ContractEvent[];
    /** WS 事件通道连接态（mock 模式恒为 disconnected，事件走本地喂入） */
    eventChannelStatus: EventChannelStatus;
    /** Agent 生成文件的落盘结果（keyed by tool_event_id；会话级观测，不随任务持久化） */
    agentFileWrites: Record<string, AgentFileWriteResult>;
    /** 文件查看页当前打开的文件（会话级导航态） */
    openedFile: { projectId: string; path: string } | null;
  } & ProjectSlice &
  TeamSlice &
  TaskSlice &
  ExecutionSlice &
  InterventionSlice &
  CouncilSlice;

/** 各 slice 的统一签名：可读写全量 state，返回自己负责的那部分动作。 */
export type SliceCreator<T> = StateCreator<DemoState, [], [], T>;
