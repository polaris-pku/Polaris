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
import type { RunEvent, RunSnapshot } from '@/api/types/rpc';
import type { TaskSnapshot } from '@/api/types/task';
import type { AgentFileWriteResult } from '@/lib/agentFs';
import type { DockChannel } from '@/lib/glossary';

/**
 * 真实后端 run 的实时观测态。
 *
 * 与 mock 剧本并存：mock 剧本仍驱动泳道图的演示推进，`liveRun` 是**后端事实**——
 * 两者不互相覆盖，UI 上分开呈现，避免把「后端真发生了什么」和「演示脚本演到哪」混为一谈。
 */
export type LiveTaskState = {
  snapshot: TaskSnapshot;
  events: RunEvent[];
  cursor?: string;
  status: 'subscribing' | 'live' | 'error';
  error?: string;
};

export type LiveRunState = {
  runId: string;
  taskId: string;
  /** 后端权威状态。running → 终态由 run.completed / run.failed / run.cancelled 事件带出 */
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  /** 按 sequence 升序的事件时间线（已在 events.ts 去重） */
  timeline: RunEvent[];
  /** 终态后拉取的完整快照（含 flow.node_statuses / delivery_report / errors） */
  snapshot: RunSnapshot | null;
  /** 拉快照或提交失败时的错误消息 */
  error: string | null;
};

/** 单个任务的执行 trace（agent 执行过程的审计快照，只读；不支持导回应用）。 */
export type TaskTrace = Pick<
  DemoTask,
  | 'id'
  | 'contractTaskId'
  | 'title'
  | 'taskText'
  | 'completionCriteria'
  | 'mode'
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
  /**
   * 新建需求。
   *
   * 返回受理结果：提交会被**拒绝**的唯一情形是「别的项目还有 run 在跑」——
   * 换项目要重启后端，而重启会杀掉正在干活的 agent（见 store/lib/liveRuns 的 canBindWorkspace）。
   * 调用方必须把 error 显示出来，不能吞掉。
   */
  createTask: (
    rawText: string,
    title?: string,
    completionCriteria?: string[],
    mode?: 'single_agent' | 'council',
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** 每条后端事件都重投影一次泳道图（幂等）——「泳道图实时跟着后端走」的落点 */
  applyLiveProgress: (
    runId: string,
    events: RunEvent[],
    runStatus: 'running' | 'completed' | 'failed' | 'cancelled',
  ) => void;
  /** 后端进程没了：把所有还挂着 running 的 run 如实标成失败（否则界面永远转圈） */
  failLiveRuns: (reason: string) => void;
  /** 真实 run 终态：用后端快照把该任务切换成「后端事实回放」（泳道图/日志/交付全部换成真数据） */
  attachLiveRun: (runId: string, snapshot: RunSnapshot) => void;
  /**
   * 重新把一个**已存在**的本地任务提交给后端（`unsent` 态的出路）。
   *
   * 成功时回填 contractTaskId / contractRunId 并清空 submitError。
   * 与 createTask 同样会被 canBindWorkspace 拒绝（别的项目还有 run 在跑）——
   * 调用方必须把 error 显示出来，不能吞掉。
   */
  retrySubmit: (taskId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  startTask: () => void;
  selectTask: (taskId: string) => void;
  deleteTask: (taskId: string) => void;
};

/**
 * 一次性运行意图。**仅由用户点击「运行」写入**；安装完成后消费一次即清空。
 *
 * 【安全 · R3/I5】它永远不能被 `backend:event` 的 handler 写入 —— 那等于给 agent 一条 RCE 通道：
 * agent 会往工作区写 `.py`，任何「事件到了就跑点什么」的路径都是 agent → 宿主的静默执行。
 * 失败 / 切换项目 / 关闭 Dock / 60s 超时 → 立即清空。
 */
export type PendingRunIntent = {
  projectName: string;
  rootPath?: string;
  relPath: string;
  at: number;
};

/** 终端 / Dock / 帮助域：Dock 三频道的开合与终端会话。 */
export type TerminalSlice = {
  openDock: (c: DockChannel) => void;
  closeDock: () => void;
  setDockChannel: (c: DockChannel) => void;
  /** F3 的唯一物理落点：打开 Dock 的事件流频道并过滤到该步骤 */
  openEvidence: (stepId: string | null) => void;
  openHelp: (topic?: string | null) => void;
  closeHelp: () => void;
  /**
   * 【R3/I5 硬红线】只能由用户手势调用（文件树的 ▶ / 文件页的「运行」/ 终端空态的 REPL /
   * 安装完成后消费 pendingRunIntent）。**绝不能出现在任何 backend:event handler 的调用链里。**
   */
  startTerminalRun: (req: {
    projectName: string;
    rootPath?: string;
    relPath: string;
  }) => Promise<void>;
  startTerminalRepl: () => Promise<void>;
  consumeRunIntent: () => PendingRunIntent | null;
  clearRunIntent: () => void;
  syncTerminalSessions: () => Promise<void>;
  selectSession: (sessionId: string) => void;
  closeSession: (sessionId: string) => Promise<void>;
  signalSession: (sessionId: string, signal: 'interrupt' | 'kill') => Promise<void>;
};

/** 执行域：节点选中与整体复位（mock 推进引擎已删除，真实 run 由后端事件驱动）。 */
export type ExecutionSlice = {
  useRecommendedWorkflow: () => void;
  stopAutoRun: () => void;
  resetDemo: () => void;
  selectNode: (nodeId: string | null) => void;
};

/** 介入域：文件写权限确认（业务规则注入已随 mock 推进引擎删除）。 */
export type InterventionSlice = {
  /** 文件写入权限确认（N7 · lifecycle.human_gate 的文件层落点）：记录人选结果，获准则落盘 */
  resolveFilePermission: (toolEventId: string, outcome: FilePermissionOutcome) => void;
  /** 回写一次落盘结果（keyed by tool_event_id）；写成功时同步把文件挂进项目文件树 */
  recordAgentFileWrite: (toolEventId: string, result: AgentFileWriteResult) => void;
};

/** 全量 store 形状 = 数据字段 + 各领域切片的动作。 */
export type DemoState = PartialExecState &
  TaskFields & {
    selectedAgentId: string | null;
    assignedAgentIds: string[];
    teamCustomizationEnabled: boolean;
    isAutoRunning: boolean;
    tasks: DemoTask[];
    /** 后端 TaskSnapshot 权威表；旧展示模型迁移期间仅作为投影缓存存在。 */
    liveTasks: Record<string, LiveTaskState>;
    activeTaskId: string | null;
    projects: Project[];
    /** null = 停留在启动页；有值 = 已进入工作区 */
    activeProjectId: string | null;
    /** 后端事件通道推来的流程事件（新在前，封顶保留 EVENT_LOG_CAP 条） */
    backendEvents: ContractEvent[];
    /** 后端通道连接态（mock 模式恒为 disconnected，事件走本地喂入） */
    eventChannelStatus: EventChannelStatus;
    /**
     * 所有真实后端 run 的实时状态，**按 run_id 键控**。空对象 = 没有在跑真实 run。
     *
     * 必须是表而不是单槽：用户可以并发提交多个需求，后端会并发跑多个独立 run，
     * 它们的事件是交错到达的。曾经这里是 `liveRun: LiveRunState | null`，
     * 后到的 run 会把前一个的事件时间线整个顶掉（`timeline` 归零重建），
     * 导致先提交的任务永远停在半路。取用请走 `selectLiveRun(runId)`。
     */
    liveRuns: Record<string, LiveRunState>;
    /** Agent 生成文件的落盘结果（keyed by tool_event_id；会话级观测，不随任务持久化） */
    agentFileWrites: Record<string, AgentFileWriteResult>;
    /** 文件查看页当前打开的文件（会话级导航态） */
    openedFile: { projectId: string; path: string } | null;

    // ── Dock / 终端 / 帮助：全部是**会话级 UI 态** ──
    // resetDemo() 直接 set(blankState())，所以这里只放丢了也无害的东西。
    // 已安装的 Python 运行时清单与选中的解释器**不在这里** —— 它们活在 src/lib/pythonRuntime.ts
    // 的模块级缓存里（真值源是主进程 + settings.json），否则「重来一次」会把它们一起抹掉。
    /** Dock 是否展开。L3（原始事件 / 终端 / 运行时）的唯一物理出口 */
    dockOpen: boolean;
    dockChannel: DockChannel;
    /** 事件流频道当前过滤到的步骤（null = 不过滤）。F3 的落点 */
    evidenceStepId: string | null;
    /** 终端会话清单。子进程活在主进程里，重挂载时由 term:list 重新水合 */
    termSessions: TermSession[];
    activeSessionId: string | null;
    helpOpen: boolean;
    helpTopic: string | null;
    pendingRunIntent: PendingRunIntent | null;
  } & ProjectSlice &
  TeamSlice &
  TaskSlice &
  ExecutionSlice &
  InterventionSlice &
  TerminalSlice;

/** 各 slice 的统一签名：可读写全量 state，返回自己负责的那部分动作。 */
export type SliceCreator<T> = StateCreator<DemoState, [], [], T>;
