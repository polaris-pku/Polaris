import { create } from 'zustand';
import type {
  DemoStage,
  DemoTask,
  FileNode,
  InterventionRule,
  LogEntry,
  PageKey,
  Project,
  TimelineCheckpoint,
  TimelineEvent,
  WorkflowNodeData,
} from '@/types';
import { councilConfirmCheckpoint, interventionCheckpoint, nodeLogs } from '@/data/logs';
import { createRequirementTask, freshWorkflowNodes } from '@/data/tasks';
import { recommendAgents } from '@/data/scenario';
import {
  MAX_COLUMN,
  NODE_IDS,
  indicesInColumn,
  primaryIndexInColumn,
  revealedCountThroughColumn,
} from '@/data/workflow';
import { captureSnapshot, nextTimelineId, resetTimelineSeq } from '@/lib/snapshot';
import { createTask as apiCreateTask } from '@/api/client';
import { onEvent, onEventChannelStatus, type EventChannelStatus } from '@/api/events';
import { toTaskCreateRequest } from '@/api/map';
import type { Event as ContractEvent, FilePermissionOutcome } from '@/api/types';

const DOWNSTREAM_UPDATED_IDS = [NODE_IDS.gate, 'n15-merge-auth', NODE_IDS.complete];

/** 项目存盘文件格式（导出/导入 .json 的载荷）。 */
export type ProjectExport = {
  format: 'hci-ide-project';
  version: number;
  savedAt: string;
  project: Project;
  tasks: DemoTask[];
};

export const PROJECT_EXPORT_FORMAT = 'hci-ide-project' as const;

/** 唯一 id：Date.now 叠加自增序号，避免同一毫秒内连续创建导致 id 冲突。 */
let idSeq = 0;
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(idSeq++).toString(36)}`;

/** 并行节点 id 形如 `<原id>-be|-te`，剥去后缀以复用同 code 的日志/资源 */
const stripParallelSuffix = (id: string) => id.replace(/-(be|te)$/, '');
const getNodeLog = (id: string) => nodeLogs[id] ?? nodeLogs[stripParallelSuffix(id)];

/**
 * 按路径把一个节点插入文件树（不可变）。
 * parts 为路径分段；isFolder 决定叶子是文件还是文件夹；中间层缺失会自动建文件夹。
 * 同名节点已存在则原样返回。
 */
function insertFileNode(nodes: FileNode[], parts: string[], isFolder: boolean): FileNode[] {
  const [head, ...rest] = parts;
  if (rest.length === 0) {
    if (nodes.some((n) => n.name === head)) return nodes;
    const leaf: FileNode = isFolder ? { name: head, children: [] } : { name: head };
    return [...nodes, leaf];
  }
  const idx = nodes.findIndex((n) => n.name === head && n.children);
  if (idx >= 0) {
    const copy = [...nodes];
    copy[idx] = {
      ...copy[idx],
      children: insertFileNode(copy[idx].children ?? [], rest, isFolder),
    };
    return copy;
  }
  return [...nodes, { name: head, children: insertFileNode([], rest, isFolder) }];
}

/** 按路径从文件树移除一个节点（不可变）。 */
function removeFileNode(nodes: FileNode[], parts: string[]): FileNode[] {
  const [head, ...rest] = parts;
  if (rest.length === 0) return nodes.filter((n) => n.name !== head);
  return nodes.map((n) =>
    n.name === head && n.children ? { ...n, children: removeFileNode(n.children, rest) } : n,
  );
}

type PartialExecState = {
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

type TaskFields = Pick<
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

function cloneTask(task: DemoTask): DemoTask {
  return {
    ...task,
    assignedAgentIds: [...(task.assignedAgentIds ?? [])],
    nodes: task.nodes.map((n) => ({
      ...n,
      input: [...n.input],
      output: [...n.output],
    })),
    interventionRules: task.interventionRules.map((r) => ({
      ...r,
      affectedAgents: [...r.affectedAgents],
    })),
    filePermissionOutcomes: { ...(task.filePermissionOutcomes ?? {}) },
    timeline: [...task.timeline],
  };
}

function extractTaskFields(state: TaskFields): TaskFields {
  return {
    taskText: state.taskText,
    assignedAgentIds: state.assignedAgentIds,
    stage: state.stage,
    analysisReady: state.analysisReady,
    nodes: state.nodes,
    revealedNodeCount: state.revealedNodeCount,
    activeStepIndex: state.activeStepIndex,
    selectedNodeId: state.selectedNodeId,
    interventionRules: state.interventionRules,
    confirmedCouncilOptionId: state.confirmedCouncilOptionId,
    interventionFeedback: state.interventionFeedback,
    filePermissionOutcomes: state.filePermissionOutcomes,
    timeline: state.timeline,
  };
}

function syncTasks(tasks: DemoTask[], activeTaskId: string | null, fields: TaskFields): DemoTask[] {
  return tasks.map((t) => (t.id === activeTaskId ? { ...t, ...fields } : t));
}

function taskToState(task: DemoTask): TaskFields {
  return cloneTask(task);
}

/** 空项目/无任务时的占位任务态（idle） */
function emptyTaskFields(): TaskFields {
  return {
    taskText: '',
    assignedAgentIds: [],
    stage: 'idle',
    analysisReady: false,
    nodes: freshWorkflowNodes(),
    revealedNodeCount: 0,
    activeStepIndex: -1,
    selectedNodeId: null,
    interventionRules: [],
    confirmedCouncilOptionId: null,
    interventionFeedback: null,
    filePermissionOutcomes: {},
    timeline: [],
  };
}

/** 选出某项目的当前任务（首个任务，或无任务时的空态） */
function pickProjectTask(
  tasks: DemoTask[],
  projectId: string,
): { activeTaskId: string | null; taskState: TaskFields } {
  const first = tasks.find((t) => t.projectId === projectId);
  return first
    ? { activeTaskId: first.id, taskState: taskToState(first) }
    : { activeTaskId: null, taskState: emptyTaskFields() };
}

function buildTimelineEvent(
  entry: LogEntry,
  exec: PartialExecState,
  checkpoint?: TimelineCheckpoint,
): TimelineEvent {
  return {
    id: nextTimelineId(),
    ...entry,
    checkpoint,
    snapshot: captureSnapshot(exec),
  };
}

type DemoState = PartialExecState &
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

    createProject: (name: string, description?: string) => void;
    openProject: (projectId: string) => void;
    closeProject: () => void;
    deleteProject: (projectId: string) => void;
    exportProject: (projectId: string) => ProjectExport | null;
    importProject: (data: ProjectExport) => void;
    setPage: (page: PageKey) => void;
    selectTask: (taskId: string) => void;
    deleteTask: (taskId: string) => void;
    addFile: (projectId: string, rawName: string) => void;
    deleteFile: (projectId: string, path: string) => void;
    selectAgent: (agentId: string) => void;
    assignAgent: (agentId: string) => void;
    enableTeamCustomization: () => void;
    disableTeamCustomization: () => void;
    resetTeamToRecommended: () => void;
    setTaskText: (text: string) => void;
    createTask: (rawText: string, title?: string, completionCriteria?: string[]) => void;
    startTask: () => void;
    useRecommendedWorkflow: () => void;
    nextStep: () => void;
    autoRun: () => void;
    stopAutoRun: () => void;
    resetDemo: () => void;
    selectNode: (nodeId: string | null) => void;
    addInterventionRule: (rule: InterventionRule) => void;
    goToCouncil: () => void;
    confirmCouncilOption: (optionId: string) => void;
    /** 文件写入权限确认（N7 · lifecycle.human_gate 的文件层落点）：记录人选结果 */
    resolveFilePermission: (toolEventId: string, outcome: FilePermissionOutcome) => void;
    showDelivery: () => void;
    restoreCheckpoint: (eventId: string) => void;
  };

/** 事件日志封顶条数：只做近期观测窗口，完整审计流由 C 持久化（E 不重放）。 */
const EVENT_LOG_CAP = 200;

/** 空白启动态：无项目、无任务，停在启动页由用户新建。 */
const blankState = () => ({
  currentPage: 'agents' as PageKey,
  selectedAgentId: null as string | null,
  teamCustomizationEnabled: false,
  isAutoRunning: false,
  tasks: [] as DemoTask[],
  activeTaskId: null as string | null,
  projects: [] as Project[],
  activeProjectId: null as string | null,
  backendEvents: [] as ContractEvent[],
  eventChannelStatus: 'disconnected' as EventChannelStatus,
  ...emptyTaskFields(),
});

const initialState = blankState();

let autoRunTimer: ReturnType<typeof setTimeout> | null = null;

export const useDemoStore = create<DemoState>((set, get) => ({
  ...initialState,

  createProject: (name, description) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const state = get();
    get().stopAutoRun();
    // 切走前，回写当前任务的实时状态（团队随任务保存在 task 里）
    const tasks = state.activeTaskId
      ? syncTasks(state.tasks, state.activeTaskId, extractTaskFields(state))
      : state.tasks;
    const project: Project = {
      id: uid('proj'),
      name: trimmed,
      description: description?.trim() || undefined,
      lastOpened: '刚刚',
      tags: [],
      // 新建项目从空白开始：没有文件、没有任务（团队随任务产生）。
      files: [],
      agentIds: [],
    };
    set({
      projects: [project, ...state.projects],
      tasks,
      activeProjectId: project.id,
      currentPage: 'agents',
      teamCustomizationEnabled: false,
      selectedAgentId: null,
      isAutoRunning: false,
      activeTaskId: null,
      ...emptyTaskFields(),
    });
  },

  openProject: (projectId) => {
    const state = get();
    const project = state.projects.find((p) => p.id === projectId);
    if (!project) return;
    get().stopAutoRun();
    const tasks = state.activeTaskId
      ? syncTasks(state.tasks, state.activeTaskId, extractTaskFields(state))
      : state.tasks;
    const projects = state.projects.map((p) =>
      p.id === projectId ? { ...p, lastOpened: '刚刚' } : p,
    );
    // 团队随任务：加载该项目当前任务，其 taskState 已含 assignedAgentIds。
    const { activeTaskId, taskState } = pickProjectTask(tasks, projectId);
    set({
      projects,
      tasks,
      activeProjectId: projectId,
      currentPage: 'agents',
      teamCustomizationEnabled: false,
      selectedAgentId: null,
      isAutoRunning: false,
      activeTaskId,
      ...taskState,
    });
  },

  closeProject: () => {
    const state = get();
    get().stopAutoRun();
    const tasks = state.activeTaskId
      ? syncTasks(state.tasks, state.activeTaskId, extractTaskFields(state))
      : state.tasks;
    set({ tasks, activeProjectId: null });
  },

  deleteProject: (projectId) => {
    const state = get();
    const projects = state.projects.filter((p) => p.id !== projectId);
    const tasks = state.tasks.filter((t) => t.projectId !== projectId);
    if (projectId === state.activeProjectId) {
      // 删除的是当前项目：回到空白启动页（其余项目仍在）。
      get().stopAutoRun();
      set({
        projects,
        tasks,
        activeProjectId: null,
        activeTaskId: null,
        selectedAgentId: null,
        teamCustomizationEnabled: false,
        isAutoRunning: false,
        ...emptyTaskFields(),
      });
    } else {
      set({ projects, tasks });
    }
  },

  exportProject: (projectId) => {
    const state = get();
    const project = state.projects.find((p) => p.id === projectId);
    if (!project) return null;
    // 先回写当前活动任务的实时状态，确保导出的是最新进度
    const tasks = state.activeTaskId
      ? syncTasks(state.tasks, state.activeTaskId, extractTaskFields(state))
      : state.tasks;
    return {
      format: PROJECT_EXPORT_FORMAT,
      version: 1,
      savedAt: new Date().toISOString(),
      project,
      tasks: tasks.filter((t) => t.projectId === projectId),
    };
  },

  importProject: (data) => {
    if (!data || data.format !== PROJECT_EXPORT_FORMAT || !data.project) return;
    const state = get();
    get().stopAutoRun();
    const existingTasks = state.activeTaskId
      ? syncTasks(state.tasks, state.activeTaskId, extractTaskFields(state))
      : state.tasks;
    // 重映射 id，避免与现有项目/任务冲突
    const newProjectId = uid('proj');
    const importedTasks: DemoTask[] = (data.tasks ?? []).map((t) => ({
      ...cloneTask(t),
      id: uid('task'),
      projectId: newProjectId,
    }));
    const newProject: Project = { ...data.project, id: newProjectId, lastOpened: '刚刚' };
    const allTasks = [...existingTasks, ...importedTasks];
    const { activeTaskId, taskState } = pickProjectTask(allTasks, newProjectId);
    set({
      projects: [newProject, ...state.projects],
      tasks: allTasks,
      activeProjectId: newProjectId,
      activeTaskId,
      currentPage: 'agents',
      teamCustomizationEnabled: false,
      selectedAgentId: null,
      isAutoRunning: false,
      ...taskState,
    });
  },

  setPage: (page) => set({ currentPage: page }),

  enableTeamCustomization: () => set({ teamCustomizationEnabled: true }),
  disableTeamCustomization: () => set({ teamCustomizationEnabled: false }),
  resetTeamToRecommended: () =>
    set((state) => {
      // 恢复到"按当前需求推荐"的团队（不再是写死的固定四人）。
      const recommended = recommendAgents(state.taskText).ids;
      let stage = state.stage;
      if (stage === 'idle' || stage === 'team_configured') {
        stage = recommended.length >= 3 ? 'team_configured' : 'idle';
      }
      const patch = {
        assignedAgentIds: [...recommended],
        teamCustomizationEnabled: false,
        stage,
      };
      const taskFields = extractTaskFields({ ...state, ...patch });
      return {
        ...patch,
        tasks: syncTasks(state.tasks, state.activeTaskId, taskFields),
      };
    }),

  selectTask: (taskId) => {
    const state = get();
    if (taskId === state.activeTaskId) {
      set({ currentPage: 'tasks' });
      return;
    }
    get().stopAutoRun();
    const synced = state.activeTaskId
      ? syncTasks(state.tasks, state.activeTaskId, extractTaskFields(state))
      : state.tasks;
    const next = synced.find((t) => t.id === taskId);
    if (!next) return;

    // 跨项目选择任务时，一并切换聚焦项目（团队随任务，由 taskToState 带出）。
    let activeProjectId = state.activeProjectId;
    let teamCustomizationEnabled = state.teamCustomizationEnabled;
    if (next.projectId !== state.activeProjectId) {
      teamCustomizationEnabled = false;
      activeProjectId = next.projectId;
    }

    set({
      tasks: synced,
      activeProjectId,
      teamCustomizationEnabled,
      activeTaskId: taskId,
      currentPage: 'tasks',
      ...taskToState(next),
      isAutoRunning: false,
    });
  },

  deleteTask: (taskId) => {
    const state = get();
    const target = state.tasks.find((t) => t.id === taskId);
    if (!target) return;
    // 先回写当前活动任务的实时状态，避免误删非活动任务时丢活动任务进度
    const synced = state.activeTaskId
      ? syncTasks(state.tasks, state.activeTaskId, extractTaskFields(state))
      : state.tasks;
    const remaining = synced.filter((t) => t.id !== taskId);
    if (taskId === state.activeTaskId) {
      // 删掉的是当前任务：切到同项目下另一个任务，或空态。
      get().stopAutoRun();
      const { activeTaskId, taskState } = pickProjectTask(remaining, target.projectId);
      set({
        tasks: remaining,
        activeTaskId,
        currentPage: 'tasks',
        isAutoRunning: false,
        ...taskState,
      });
    } else {
      set({ tasks: remaining });
    }
  },

  addFile: (projectId, rawName) => {
    const name = rawName.trim().replace(/^\/+/, '');
    if (!name) return;
    const isFolder = name.endsWith('/');
    const parts = name.replace(/\/+$/, '').split('/').filter(Boolean);
    if (parts.length === 0) return;
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, files: insertFileNode(p.files, parts, isFolder) } : p,
      ),
    }));
  },

  deleteFile: (projectId, path) => {
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 0) return;
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, files: removeFileNode(p.files, parts) } : p,
      ),
    }));
  },

  selectAgent: (agentId) => set({ selectedAgentId: agentId }),

  assignAgent: (agentId) =>
    set((state) => {
      const already = state.assignedAgentIds.includes(agentId);
      const assignedAgentIds = already
        ? state.assignedAgentIds.filter((id) => id !== agentId)
        : [...state.assignedAgentIds, agentId];
      let stage = state.stage;
      if (state.stage === 'idle' || state.stage === 'team_configured') {
        stage = assignedAgentIds.length >= 3 ? 'team_configured' : 'idle';
      }
      const taskFields = extractTaskFields({ ...state, stage });
      return {
        assignedAgentIds,
        stage,
        tasks: syncTasks(state.tasks, state.activeTaskId, taskFields),
      };
    }),

  setTaskText: (text) =>
    set((state) => {
      const taskFields = extractTaskFields({ ...state, taskText: text });
      return {
        taskText: text,
        tasks: syncTasks(state.tasks, state.activeTaskId, taskFields),
      };
    }),

  createTask: (rawText, title, completionCriteria) => {
    const text = rawText.trim();
    if (!text) return;
    const state = get();
    if (!state.activeProjectId) return;
    get().stopAutoRun();
    // 先把当前活动任务的实时状态回写，避免切走时丢进度
    const persisted = state.activeTaskId
      ? syncTasks(state.tasks, state.activeTaskId, extractTaskFields(state))
      : state.tasks;
    // N1 Triage：读需求 → 建议角色/组队（C 的职责）。团队随任务创建（createRequirementTask
    // 内部按需求推荐），由 taskToState 带入实时状态；输入需求后直接进 Task Board 看分析。
    const newTask = createRequirementTask(
      uid('task'),
      state.activeProjectId,
      text,
      title,
      completionCriteria,
    );
    set({
      tasks: [...persisted, newTask],
      activeTaskId: newTask.id,
      currentPage: 'tasks',
      teamCustomizationEnabled: false,
      ...taskToState(newTask),
      isAutoRunning: false,
    });
    // N2 创建 Task：本地乐观创建后异步提交协调器（C），受理成功回填权威 task_id。
    // 提交失败不回滚本地任务（E 侧演示流仍可走），仅留日志待重试机制补上。
    void apiCreateTask(toTaskCreateRequest(text, completionCriteria))
      .then((contractTask) => {
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === newTask.id ? { ...t, contractTaskId: contractTask.task_id } : t,
          ),
        }));
      })
      .catch((err: unknown) => {
        console.warn('[api] createTask 提交失败，任务仅存在于本地：', err);
      });
  },

  startTask: () =>
    set((state) => {
      const taskFields = extractTaskFields({
        ...state,
        stage: 'analyzing',
        analysisReady: true,
      });
      return {
        currentPage: 'tasks',
        stage: 'analyzing',
        analysisReady: true,
        tasks: syncTasks(state.tasks, state.activeTaskId, taskFields),
      };
    }),

  useRecommendedWorkflow: () =>
    set((state) => {
      const nodes = state.nodes.map((n, i) => (i === 0 ? { ...n, status: 'active' as const } : n));
      const nodeLog = nodeLogs[nodes[0].id];
      const exec: PartialExecState = {
        stage: 'executing',
        currentPage: state.currentPage,
        nodes,
        revealedNodeCount: 1,
        activeStepIndex: 0,
        selectedNodeId: nodes[0].id,
        interventionRules: state.interventionRules,
        confirmedCouncilOptionId: state.confirmedCouncilOptionId,
        interventionFeedback: state.interventionFeedback,
      };
      const { checkpoint, ...entry } = nodeLog ?? {
        time: '00:01',
        source: 'Orchestrator',
        text: 'Workflow 已启动。',
        level: 'info' as const,
      };
      const timeline = nodeLog ? [buildTimelineEvent(entry, exec, checkpoint)] : [];
      const taskFields = extractTaskFields({
        ...state,
        ...exec,
        timeline,
      });
      return {
        ...exec,
        timeline,
        tasks: syncTasks(state.tasks, state.activeTaskId, taskFields),
      };
    }),

  nextStep: () => {
    const state = get();
    if (state.stage !== 'executing') return;
    const cur = state.activeStepIndex;
    if (cur < 0) return;
    const curCol = state.nodes[cur].column;

    // 活跃列为 Council 且尚未裁决 → 进入议会
    if (state.nodes[cur].id === NODE_IDS.council && !state.confirmedCouncilOptionId) {
      get().goToCouncil();
      return;
    }

    const nodes = state.nodes.map((n) => ({ ...n }));
    // 当前列整列置 done（并行列两节点一起完成）
    indicesInColumn(nodes, curCol).forEach((i) => {
      nodes[i] = { ...nodes[i], status: 'done' };
    });

    // 末列：进入交付
    if (curCol >= MAX_COLUMN) {
      const exec: PartialExecState = {
        stage: 'delivery',
        currentPage: state.currentPage,
        nodes,
        revealedNodeCount: nodes.length,
        activeStepIndex: cur,
        selectedNodeId: nodes[cur].id,
        interventionRules: state.interventionRules,
        confirmedCouncilOptionId: state.confirmedCouncilOptionId,
        interventionFeedback: state.interventionFeedback,
      };
      const taskFields = extractTaskFields({ ...state, ...exec });
      set({
        ...exec,
        tasks: syncTasks(state.tasks, state.activeTaskId, taskFields),
      });
      get().stopAutoRun();
      return;
    }

    // 推进到下一列：整列置 active（并行列两节点一起点亮）
    const nextCol = curCol + 1;
    indicesInColumn(nodes, nextCol).forEach((i) => {
      nodes[i] = { ...nodes[i], status: 'active' };
    });
    const primaryIndex = primaryIndexInColumn(nodes, nextCol);
    const primaryNode = nodes[primaryIndex];
    const nodeLog = getNodeLog(primaryNode.id);

    let stage: DemoStage = 'executing';
    let currentPage = state.currentPage;
    if (primaryNode.id === NODE_IDS.council) {
      stage = 'council';
      currentPage = 'council';
      get().stopAutoRun();
    }

    const exec: PartialExecState = {
      stage,
      currentPage,
      nodes,
      revealedNodeCount: revealedCountThroughColumn(nodes, nextCol),
      activeStepIndex: primaryIndex,
      selectedNodeId: primaryNode.id,
      interventionRules: state.interventionRules,
      confirmedCouncilOptionId: state.confirmedCouncilOptionId,
      interventionFeedback: state.interventionFeedback,
    };

    const timeline = nodeLog
      ? [
          ...state.timeline,
          buildTimelineEvent(
            {
              time: nodeLog.time,
              source: nodeLog.source,
              text: nodeLog.text,
              level: nodeLog.level,
            },
            exec,
            nodeLog.checkpoint,
          ),
        ]
      : state.timeline;

    const taskFields = extractTaskFields({ ...state, ...exec, timeline });
    set({
      ...exec,
      timeline,
      tasks: syncTasks(state.tasks, state.activeTaskId, taskFields),
    });
  },

  autoRun: () => {
    const tick = () => {
      const state = get();
      if (state.stage !== 'executing') {
        set({ isAutoRunning: false });
        autoRunTimer = null;
        return;
      }
      state.nextStep();
      const after = get();
      if (after.stage === 'executing' && after.isAutoRunning) {
        autoRunTimer = setTimeout(tick, 950);
      } else {
        set({ isAutoRunning: false });
        autoRunTimer = null;
      }
    };
    set({ isAutoRunning: true });
    autoRunTimer = setTimeout(tick, 400);
  },

  stopAutoRun: () => {
    if (autoRunTimer) {
      clearTimeout(autoRunTimer);
      autoRunTimer = null;
    }
    set({ isAutoRunning: false });
  },

  resetDemo: () => {
    if (autoRunTimer) {
      clearTimeout(autoRunTimer);
      autoRunTimer = null;
    }
    resetTimelineSeq();
    // 回到空白启动态：清空项目与任务，返回启动页。
    set(blankState());
  },

  selectNode: (nodeId) =>
    set((state) => {
      const taskFields = extractTaskFields({ ...state, selectedNodeId: nodeId });
      return {
        selectedNodeId: nodeId,
        tasks: syncTasks(state.tasks, state.activeTaskId, taskFields),
      };
    }),

  addInterventionRule: (rule) =>
    set((state) => {
      const nodes = state.nodes.map((n) => {
        if (DOWNSTREAM_UPDATED_IDS.includes(n.id) && n.status === 'pending') {
          return { ...n, status: 'updated' as const };
        }
        return n;
      });
      const feedback =
        '已识别为业务规则。该规则将同步给 Coding Agent、Test Agent 和 Security Audit Agent。';
      const log: LogEntry = {
        time: '00:15',
        source: '用户介入',
        text: `注入业务规则：${rule.text}`,
        level: 'warning',
      };
      const exec: PartialExecState = {
        stage: state.stage,
        currentPage: state.currentPage,
        nodes,
        revealedNodeCount: state.revealedNodeCount,
        activeStepIndex: state.activeStepIndex,
        selectedNodeId: state.selectedNodeId,
        interventionRules: [...state.interventionRules, rule],
        confirmedCouncilOptionId: state.confirmedCouncilOptionId,
        interventionFeedback: feedback,
      };
      const timeline = [...state.timeline, buildTimelineEvent(log, exec, interventionCheckpoint)];
      const taskFields = extractTaskFields({
        ...state,
        ...exec,
        timeline,
      });
      return {
        ...exec,
        timeline,
        tasks: syncTasks(state.tasks, state.activeTaskId, taskFields),
      };
    }),

  goToCouncil: () => {
    const state = get();
    const councilIdx = state.nodes.findIndex((n) => n.id === NODE_IDS.council);
    if (councilIdx < 0) return;
    const councilCol = state.nodes[councilIdx].column;
    const nodes = state.nodes.map((n) => {
      if (n.column < councilCol) {
        return n.status === 'done' ? n : { ...n, status: 'done' as const };
      }
      if (n.id === NODE_IDS.council) return { ...n, status: 'active' as const };
      return n;
    });
    const nodeLog = nodeLogs[NODE_IDS.council];
    const alreadyHasCouncil = state.timeline.some(
      (e) => e.source === 'Council' && e.text.includes('已就绪'),
    );
    const exec: PartialExecState = {
      stage: 'council',
      currentPage: 'council',
      nodes,
      activeStepIndex: councilIdx,
      selectedNodeId: NODE_IDS.council,
      revealedNodeCount: Math.max(
        state.revealedNodeCount,
        revealedCountThroughColumn(nodes, councilCol),
      ),
      interventionRules: state.interventionRules,
      confirmedCouncilOptionId: state.confirmedCouncilOptionId,
      interventionFeedback: state.interventionFeedback,
    };
    const timeline =
      alreadyHasCouncil || !nodeLog
        ? state.timeline
        : [
            ...state.timeline,
            buildTimelineEvent(
              {
                time: nodeLog.time,
                source: nodeLog.source,
                text: nodeLog.text,
                level: nodeLog.level,
              },
              exec,
              nodeLog.checkpoint,
            ),
          ];
    const taskFields = extractTaskFields({ ...state, ...exec, timeline });
    set({
      ...exec,
      timeline,
      tasks: syncTasks(state.tasks, state.activeTaskId, taskFields),
    });
    get().stopAutoRun();
  },

  confirmCouncilOption: (optionId) => {
    const state = get();
    const completeIdx = state.nodes.findIndex((n) => n.id === NODE_IDS.complete);
    // 裁决后：议会与中间合并节点(N15–N17)收束为 done，直达 N18 complete
    const nodes = state.nodes.map((n) =>
      n.column < MAX_COLUMN
        ? { ...n, status: 'done' as const }
        : { ...n, status: 'active' as const },
    );
    const log: LogEntry = {
      time: '00:28',
      source: 'Council',
      text: '用户已裁决：采用 Option A · RBAC 策略，回到主流程。',
      level: 'council',
    };
    const exec: PartialExecState = {
      stage: 'executing',
      currentPage: 'tasks',
      nodes,
      activeStepIndex: completeIdx,
      selectedNodeId: nodes[completeIdx].id,
      revealedNodeCount: state.nodes.length,
      interventionRules: state.interventionRules,
      confirmedCouncilOptionId: optionId,
      interventionFeedback: state.interventionFeedback,
    };
    const timeline = [...state.timeline, buildTimelineEvent(log, exec, councilConfirmCheckpoint)];
    const taskFields = extractTaskFields({ ...state, ...exec, timeline });
    set({
      ...exec,
      timeline,
      tasks: syncTasks(state.tasks, state.activeTaskId, taskFields),
    });
  },

  resolveFilePermission: (toolEventId, outcome) =>
    set((state) => {
      const filePermissionOutcomes = {
        ...(state.filePermissionOutcomes ?? {}),
        [toolEventId]: outcome,
      };
      const taskFields = extractTaskFields({ ...state, filePermissionOutcomes });
      return {
        filePermissionOutcomes,
        tasks: syncTasks(state.tasks, state.activeTaskId, taskFields),
      };
    }),

  showDelivery: () =>
    set((state) => {
      const completeIdx = state.nodes.findIndex((n) => n.id === NODE_IDS.complete);
      const nodes = state.nodes.map((n) =>
        n.column === MAX_COLUMN ? { ...n, status: 'done' as const } : n,
      );
      const nodeLog = nodeLogs[NODE_IDS.complete];
      const alreadyHasComplete = state.timeline.some(
        (e) => e.source === 'Orchestrator' && e.text.includes('Delivery Report'),
      );
      const exec: PartialExecState = {
        stage: 'delivery',
        currentPage: 'tasks',
        nodes,
        activeStepIndex: completeIdx,
        selectedNodeId: nodes[completeIdx].id,
        revealedNodeCount: nodes.length,
        interventionRules: state.interventionRules,
        confirmedCouncilOptionId: state.confirmedCouncilOptionId,
        interventionFeedback: state.interventionFeedback,
      };
      const timeline =
        alreadyHasComplete || !nodeLog
          ? state.timeline
          : [
              ...state.timeline,
              buildTimelineEvent(
                {
                  time: nodeLog.time,
                  source: nodeLog.source,
                  text: nodeLog.text,
                  level: nodeLog.level,
                },
                exec,
                nodeLog.checkpoint,
              ),
            ];
      const taskFields = extractTaskFields({ ...state, ...exec, timeline });
      return {
        ...exec,
        timeline,
        tasks: syncTasks(state.tasks, state.activeTaskId, taskFields),
      };
    }),

  restoreCheckpoint: (eventId) => {
    const state = get();
    const idx = state.timeline.findIndex((e) => e.id === eventId);
    if (idx < 0) return;
    const event = state.timeline[idx];
    if (!event.checkpoint) return;

    get().stopAutoRun();
    const snap = event.snapshot;
    const taskFields = extractTaskFields({
      ...state,
      stage: snap.stage,
      nodes: snap.nodes.map((n) => ({
        ...n,
        input: [...n.input],
        output: [...n.output],
      })),
      revealedNodeCount: snap.revealedNodeCount,
      activeStepIndex: snap.activeStepIndex,
      selectedNodeId: snap.selectedNodeId,
      interventionRules: snap.interventionRules.map((r) => ({
        ...r,
        affectedAgents: [...r.affectedAgents],
      })),
      confirmedCouncilOptionId: snap.confirmedCouncilOptionId,
      interventionFeedback: snap.interventionFeedback,
      timeline: state.timeline.slice(0, idx + 1),
    });
    set({
      stage: snap.stage,
      currentPage: snap.currentPage,
      nodes: taskFields.nodes,
      revealedNodeCount: taskFields.revealedNodeCount,
      activeStepIndex: taskFields.activeStepIndex,
      selectedNodeId: taskFields.selectedNodeId,
      interventionRules: taskFields.interventionRules,
      confirmedCouncilOptionId: taskFields.confirmedCouncilOptionId,
      interventionFeedback: taskFields.interventionFeedback,
      timeline: taskFields.timeline,
      tasks: syncTasks(state.tasks, state.activeTaskId, taskFields),
      isAutoRunning: false,
    });
  },
}));

// ── 事件通道接线（模块级，应用生命周期内常驻订阅） ──
// mock 模式下 onEvent 不建 WS 连接，事件由 client.ts mock 路径本地喂入，
// 消费链路（追加到 backendEvents 观测窗口）与真连接完全一致。
onEvent((event) => {
  useDemoStore.setState((s) => ({
    backendEvents: [event, ...s.backendEvents].slice(0, EVENT_LOG_CAP),
  }));
});
onEventChannelStatus((eventChannelStatus) => {
  useDemoStore.setState({ eventChannelStatus });
});
