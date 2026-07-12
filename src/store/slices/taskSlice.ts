import type { Project } from '@/types';
import { createRequirementTask } from '@/data/tasks';
import { createSampleRunTask, sampleRunProjectMeta, sampleRunSnapshot } from '@/data/sampleRun';

import { createRun as apiCreateRun } from '@/api/client';
import { watchRun } from '@/api/events';
import { toTaskCreateRequest } from '@/api/map';
import { buildLiveProgressReplay, buildLiveRunReplay, liveProducedFiles } from '@/lib/liveReplay';
import { projectLiveBoard } from '@/lib/liveBoard';
import { resetTimelineSeq } from '@/lib/snapshot';
import { isFrontendWorkflowV01 } from '@/api/types/rpc';
import type { PartialExecState, SliceCreator, TaskSlice } from '@/store/types';
import { uid } from '@/store/lib/ids';
import { insertFileNode } from '@/store/lib/fileTree';
import { buildTimelineEvent, getNodeLog } from '@/store/lib/timeline';
import { extractTaskFields, pickProjectTask, syncTasks, taskToState } from '@/store/lib/taskSync';

/** 绝对路径 → 相对项目根的分段（agent 写在工作区根下，取项目名之后的部分）。 */
function relativeParts(absPath: string, project: Project | undefined): string[] {
  const parts = absPath.split('/').filter(Boolean);
  const rootName = project?.rootPath?.split('/').filter(Boolean).pop() ?? project?.name;
  const at = rootName ? parts.lastIndexOf(rootName) : -1;
  return at >= 0 ? parts.slice(at + 1) : parts.slice(-1);
}

/** 任务域：任务生命周期（新建/开始/切换/删除）与页面导航。 */
export const createTaskSlice: SliceCreator<TaskSlice> = (set, get) => ({
  setPage: (page) => set({ currentPage: page }),

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
    // N2/N3：本地乐观创建后异步提交协调器（C）。后端没有「只建 Task 不建 Run」的入口——
    // run.create 一次性建 Task + Run 并立刻开跑，所以受理成功即回填 task_id + run_id，
    // 并把事件通道切到这个 run（订阅后后端会重放它已发生的全部事件，去重在 events.ts 里做）。
    // 提交失败不回滚本地任务（mock 演示流仍可走），仅留日志。
    void apiCreateRun(toTaskCreateRequest(text, completionCriteria), {
      projectId: state.activeProjectId,
      clientTaskId: newTask.id,
      title: newTask.title,
    })
      .then((created) => {
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === newTask.id
              ? { ...t, contractTaskId: created.task_id, contractRunId: created.run_id }
              : t,
          ),
        }));
        return watchRun(created.run_id);
      })
      .catch((err: unknown) => {
        console.warn('[api] run.create 提交失败，任务仅存在于本地：', err);
      });
  },

  /**
   * 每来一条后端事件就把泳道图重投影一次 —— 这是「实时」的落点。
   *
   * 幂等：用**全部已收到的事件**重算，不做增量累积，所以丢事件/乱序/重订阅重放都不会漂移。
   * 后端尚未派单（还没有 mailbox `task.assigned`）时 projectLiveBoard 返回 null ——
   * 执行泳道有几条由后端决定，前端不预设、不先画假的。这通常只持续到第 4 个事件。
   *
   * 真实 run 由后端驱动，人不需要点 Next Step；手动控制在 TaskBoard 上对 live 任务隐藏。
   */
  applyLiveProgress: (runId, events, runStatus) => {
    const state = get();
    const task = state.tasks.find((t) => t.contractRunId === runId);
    if (!task || events.length === 0) return;

    const projection = projectLiveBoard(events, runStatus);
    if (!projection) return;

    const first = events[0];
    const replay = buildLiveProgressReplay(events, {
      runId,
      taskId: first.task_id,
      mode: task.replay?.meta.mode ?? 'single_agent',
      status: runStatus,
    });

    // 时间线：已点亮的节点各一条，取后端事件原文（顺序 = 泳道图列序）
    resetTimelineSeq();
    const exec: PartialExecState = {
      stage: projection.stage,
      currentPage: state.currentPage,
      nodes: projection.nodes,
      revealedNodeCount: projection.revealedNodeCount,
      activeStepIndex: projection.activeStepIndex,
      selectedNodeId: state.selectedNodeId,
      interventionRules: task.interventionRules,
      confirmedCouncilOptionId: task.confirmedCouncilOptionId,
      interventionFeedback: task.interventionFeedback,
    };
    const timeline = projection.nodes
      .filter((n) => n.status === 'done' || n.status === 'blocked')
      .map((n) => {
        const log = getNodeLog(n.id, replay);
        if (!log) return null;
        const { checkpoint, ...entry } = log;
        return buildTimelineEvent(entry, exec, checkpoint);
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    const nextTask = {
      ...task,
      taskText: replay.scenario.subject,
      assignedAgentIds: projection.agents.map((a) => a.suffix),
      stage: projection.stage,
      analysisReady: true,
      nodes: projection.nodes,
      revealedNodeCount: projection.revealedNodeCount,
      activeStepIndex: projection.activeStepIndex,
      timeline,
      replay,
    };

    set({
      tasks: state.tasks.map((t) => (t.id === task.id ? nextTask : t)),
      ...(state.activeTaskId === task.id ? taskToState(nextTask) : {}),
    });
  },

  /**
   * 真实 run 走到终态：把整个任务切换成「后端事实回放」。
   *
   * 这是「界面不再是 mock」的关键一步 —— 在此之前，泳道图/节点日志/Inspector/交付报告
   * 全部来自 data/*.ts 的演示剧本；挂上 replay 之后，它们的内容一律改由后端快照派生
   * （消费方本就是「replay 优先、mock 回退」）。
   *
   * 泳道图按后端实际派单的 agent 正向组图：后端派几个，图上就长几条执行泳道。
   * agent 真写到工作区的文件（artifacts[].source_path）同时挂进项目文件树，标 origin='live'。
   */
  attachLiveRun: (runId, snapshot) => {
    const replay = buildLiveRunReplay(snapshot);
    // 瘦快照（run 早早被取消，缺 task/run/flow）派生不出可展示内容 → 保持原状，不硬切
    if (!replay || !isFrontendWorkflowV01(snapshot)) return;

    const state = get();
    const task = state.tasks.find((t) => t.contractRunId === runId);
    if (!task) return;

    // 终态节点状态仍由事件投影决定（与实时阶段同一套逻辑），只是内容换成更全的快照版 replay。
    // 不能在这里重新 compose 一张全 pending 的图 —— 那会把已经点亮的进度抹掉。
    const projection = projectLiveBoard(snapshot.timeline, snapshot.status);
    if (!projection) return;

    const project = state.projects.find((p) => p.id === task.projectId);
    const producedParts = liveProducedFiles(snapshot)
      .map((abs) => relativeParts(abs, project))
      .filter((parts) => parts.length > 0);

    // 时间线：已点亮的节点各一条，内容换成快照版 replay 的原文
    resetTimelineSeq();
    const exec: PartialExecState = {
      stage: projection.stage,
      currentPage: state.currentPage,
      nodes: projection.nodes,
      revealedNodeCount: projection.revealedNodeCount,
      activeStepIndex: projection.activeStepIndex,
      selectedNodeId: state.selectedNodeId,
      interventionRules: task.interventionRules,
      confirmedCouncilOptionId: task.confirmedCouncilOptionId,
      interventionFeedback: task.interventionFeedback,
    };
    const timeline = projection.nodes
      .filter((n) => n.status === 'done' || n.status === 'blocked')
      .map((n) => {
        const log = getNodeLog(n.id, replay);
        if (!log) return null;
        const { checkpoint, ...entry } = log;
        return buildTimelineEvent(entry, exec, checkpoint);
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    const nextTask = {
      ...task,
      // 需求原文以后端 task.spec 为准（后端是权威）
      taskText: snapshot.task.spec,
      assignedAgentIds: projection.agents.map((a) => a.suffix),
      stage: projection.stage,
      analysisReady: true,
      nodes: projection.nodes,
      revealedNodeCount: projection.revealedNodeCount,
      activeStepIndex: projection.activeStepIndex,
      timeline,
      replay,
    };

    set({
      tasks: state.tasks.map((t) => (t.id === task.id ? nextTask : t)),
      projects: state.projects.map((p) =>
        p.id === task.projectId
          ? {
              ...p,
              files: producedParts.reduce(
                (files, parts) => insertFileNode(files, parts, false, 'live'),
                p.files,
              ),
            }
          : p,
      ),
      // 切的是当前任务 → 同步把实时态也换过去，界面立刻变成真实 run
      ...(state.activeTaskId === task.id ? taskToState(nextTask) : {}),
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

  loadSampleRun: () => {
    const state = get();
    // 已加载过同一 run 的回放任务 → 直接切换过去（selectTask 会带出项目与任务态）
    const existing = state.tasks.find((t) => t.replay?.meta.runId === sampleRunSnapshot.run_id);
    if (existing) {
      get().selectTask(existing.id);
      return;
    }
    get().stopAutoRun();
    const persisted = state.activeTaskId
      ? syncTasks(state.tasks, state.activeTaskId, extractTaskFields(state))
      : state.tasks;
    const project: Project = {
      id: uid('proj'),
      name: sampleRunProjectMeta.name,
      description: sampleRunProjectMeta.description,
      lastOpened: '刚刚',
      tags: [...sampleRunProjectMeta.tags],
      // runs 目录结构随样例快照给出（structuredClone 防止跨次加载共享引用）
      files: structuredClone(sampleRunProjectMeta.files),
      agentIds: [],
    };
    const task = createSampleRunTask(uid('task'), project.id);
    // 回放任务不上送 TaskCreateRequest：任务在后端世界已存在（contractTaskId 即真实 task_id）
    set({
      projects: [project, ...state.projects],
      tasks: [...persisted, task],
      activeProjectId: project.id,
      activeTaskId: task.id,
      currentPage: 'tasks',
      teamCustomizationEnabled: false,
      selectedAgentId: null,
      ...taskToState(task),
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
});
