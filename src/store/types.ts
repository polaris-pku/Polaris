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

/** 项目存盘文件格式（导出/导入 .json 的载荷）。 */
export type ProjectExport = {
  format: 'hci-ide-project';
  version: number;
  savedAt: string;
  project: Project;
  tasks: DemoTask[];
};

export const PROJECT_EXPORT_FORMAT = 'hci-ide-project' as const;

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
  createProject: (name: string, description?: string) => void;
  openProject: (projectId: string) => void;
  closeProject: () => void;
  deleteProject: (projectId: string) => void;
  exportProject: (projectId: string) => ProjectExport | null;
  importProject: (data: ProjectExport) => void;
  addFile: (projectId: string, rawName: string) => void;
  deleteFile: (projectId: string, path: string) => void;
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
  /** 文件写入权限确认（N7 · lifecycle.human_gate 的文件层落点）：记录人选结果 */
  resolveFilePermission: (toolEventId: string, outcome: FilePermissionOutcome) => void;
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
  } & ProjectSlice &
  TeamSlice &
  TaskSlice &
  ExecutionSlice &
  InterventionSlice &
  CouncilSlice;

/** 各 slice 的统一签名：可读写全量 state，返回自己负责的那部分动作。 */
export type SliceCreator<T> = StateCreator<DemoState, [], [], T>;
