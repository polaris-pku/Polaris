import type { DemoTask, Project } from '@/types';
import { createRequirementTask } from '@/data/tasks';

import { createRun as apiCreateRun } from '@/api/client';
import { unwatchRun, watchRun } from '@/api/events';
import { toTaskCreateRequest } from '@/api/map';
import { bindBackendWorkspace } from '@/lib/backendWorkspace';
import { readProjectFolder } from '@/lib/agentFs';
import { buildLiveProgressReplay, buildLiveRunReplay, liveProducedFiles } from '@/lib/liveReplay';
import { projectLiveBoard } from '@/lib/liveBoard';
import { resetTimelineSeq } from '@/lib/snapshot';
import { isFrontendWorkflowV01 } from '@/api/types/rpc';
import type { PartialExecState, SliceCreator, TaskSlice } from '@/store/types';
import { uid } from '@/store/lib/ids';
import { canBindWorkspace, dropRun } from '@/store/lib/liveRuns';
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

/**
 * 工作区被**别的项目**的 run 占着时的拒绝理由。
 *
 * createTask 与 retrySubmit 共用同一句话 —— 两处提交走的是同一条后端路径（bindWorkspace →
 * run.create），拒绝的理由当然也只能有一份。
 */
function workspaceBlockedMessage(projects: Project[], blocker: DemoTask): string {
  const blockerProject = projects.find((p) => p.id === blocker.projectId);
  return (
    `「${blockerProject?.name ?? '另一个项目'}」里的需求「${blocker.title}」还在执行中。\n` +
    'agent 的工作区是后端的全局状态，换项目要重启后端 —— 那会把正在跑的 agent 一起杀掉。\n' +
    // 不许写「或先取消它」：驱动没实现中断，全应用没有取消按钮（cancelRun 零调用）。
    // 指一条用户按不到的路，比不指更糟。
    '请等它跑完，或退出应用（会杀掉正在干活的 agent），再在本项目提交。'
  );
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

  createTask: (rawText, title, completionCriteria, mode = 'single_agent') => {
    const text = rawText.trim();
    if (!text) return { ok: false, error: '需求内容不能为空。' };
    const state = get();
    if (!state.activeProjectId) return { ok: false, error: '请先打开一个项目。' };

    // 提交前必然要把后端工作区绑到当前项目，而绑定会重启 BCD、连带杀死正在干活的 agent。
    // 所以别的项目还有 run 在跑时，这次提交必须被拦下 —— 否则就是拿一次静默的数据损坏
    // 去换一次提交。（同项目内并发提交是安全的：工作区没变，后端不会重启。）
    const bindable = canBindWorkspace(state, state.activeProjectId);
    if (!bindable.ok) {
      return { ok: false, error: workspaceBlockedMessage(state.projects, bindable.blockingTask) };
    }

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
    //
    // ⚠️ 提交前必须先把后端工作区对齐到当前项目。
    // 「agent 写到哪」是后端的**全局状态**（BCD 只在启动时读一次 ACP_WORKSPACE），不跟着任务走。
    // 只要期间有任何东西 re-configure 过后端（切项目、外部进程、手动重启），这次需求就会把文件
    // 写进**别的项目目录** —— 而界面上完全看不出来：run 照样 completed，产物却不在你的项目里。
    // 曾实测到：用户在 A 项目提的需求，文件落到了 B 项目下。
    const project = state.projects.find((p) => p.id === state.activeProjectId);
    void bindBackendWorkspace(project)
      .then(() =>
        apiCreateRun(toTaskCreateRequest(text, completionCriteria), {
          mode,
          projectId: state.activeProjectId ?? undefined,
          clientTaskId: newTask.id,
          title: newTask.title,
        }),
      )
      .then((created) => {
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === newTask.id
              ? {
                  ...t,
                  contractTaskId: created.task_id,
                  contractRunId: created.run_id,
                  submitError: undefined,
                }
              : t,
          ),
        }));
        return watchRun(created.run_id);
      })
      .catch((err: unknown) => {
        // 提交失败不回滚本地任务（mock 演示流仍可走），但**必须让用户看见**。
        // 从前这里只有一句 console.warn —— 用户以为自己提交了需求，实际拿到的是一个
        // 没有后端 run 的本地演示任务，界面上没有任何迹象。
        const message = err instanceof Error ? err.message : String(err);
        console.warn('[api] run.create 提交失败，任务仅存在于本地：', err);
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === newTask.id ? { ...t, submitError: message } : t)),
        }));
      });

    return { ok: true };
  },

  /**
   * 把一个**已存在**的本地任务重新提交给后端 —— `未提交到后端 · 点击重试` 的唯一出路。
   *
   * 走的是和 createTask **完全相同**的后端路径（绑工作区 → run.create → watchRun），
   * 只是不再新建本地任务：这次提交失败的那条需求，用户不该被迫重新打一遍字。
   *
   * 拒绝条件也与 createTask 完全一致：别的项目还有 run 在跑时**必须拒绝** ——
   * 绑定工作区会重启 BCD，把正在干活的 agent 一起杀掉。调用方必须把 error 显示出来。
   *
   * 失败的 run 重试时会拿到一个新的 run_id：老的那次 run 已经是历史，退订它并丢掉它的
   * 实时状态，否则 liveRuns 里会堆着一堆再也不会有事件的死条目。
   */
  retrySubmit: async (taskId) => {
    const state = get();
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return { ok: false, error: '任务不存在。' };

    const text = task.taskText.trim();
    if (!text) return { ok: false, error: '需求内容不能为空。' };

    const bindable = canBindWorkspace(state, task.projectId);
    if (!bindable.ok) {
      return { ok: false, error: workspaceBlockedMessage(state.projects, bindable.blockingTask) };
    }

    const staleRunId = task.contractRunId;
    const project = state.projects.find((p) => p.id === task.projectId);

    try {
      await bindBackendWorkspace(project);
      const created = await apiCreateRun(toTaskCreateRequest(text, task.completionCriteria), {
        projectId: task.projectId,
        clientTaskId: task.id,
        title: task.title,
      });

      if (staleRunId && staleRunId !== created.run_id) {
        void unwatchRun(staleRunId);
        set((s) => ({ liveRuns: dropRun(s.liveRuns, staleRunId) }));
      }

      set((s) => ({
        tasks: s.tasks.map((t) =>
          t.id === task.id
            ? {
                ...t,
                contractTaskId: created.task_id,
                contractRunId: created.run_id,
                submitError: undefined,
              }
            : t,
        ),
      }));

      await watchRun(created.run_id);
      return { ok: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[api] run.create 重试仍失败，任务仍只存在于本地：', err);
      set((s) => ({
        tasks: s.tasks.map((t) => (t.id === task.id ? { ...t, submitError: message } : t)),
      }));
      return { ok: false, error: message };
    }
  },

  /**
   * 后端进程没了 → 把所有还挂着 running 的 run 如实标成失败。
   *
   * BCD 的 run registry 只活在它自己的进程内存里。进程一死（崩溃、被杀、切工作区重启），
   * 那些 run 就再也不会有任何事件到达了 —— 而且新起的 BCD 对它们一无所知，重新订阅只会得到
   * RUN_NOT_FOUND。此时界面若还显示「执行中」，就是在撒谎：它会一直转圈到用户放弃。
   *
   * 所以：宁可如实说「后端中断了，这次 run 没了」，也不要让一个永远不会到来的事件吊着用户。
   */
  failLiveRuns: (reason) => {
    const state = get();
    const stalled = Object.values(state.liveRuns).filter((r) => r.status === 'running');
    if (stalled.length === 0) return;

    const liveRuns = { ...state.liveRuns };
    for (const run of stalled) {
      liveRuns[run.runId] = { ...run, status: 'failed', error: reason };
      void unwatchRun(run.runId);
    }
    set({ liveRuns });

    // 把每个受影响的任务推到终态 —— 走的是和 run.failed 事件完全相同的投影路径，
    // 所以泳道图/时间线/交付页的表现与「后端明确报失败」一致，没有第二套特例逻辑。
    for (const run of stalled) {
      get().applyLiveProgress(run.runId, run.timeline, 'failed');
    }
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

    // 聚焦：选中节点跟着 agent 走 —— 右侧 Inspector 显示的就是它此刻正在做的那个节点。
    // 后端推进到哪，视线就跟到哪；run 结束后落在最后完成的节点上。
    const focusNode =
      projection.nodes.find((n) => n.status === 'active') ??
      [...projection.nodes].reverse().find((n) => n.status === 'done' || n.status === 'blocked');
    const selectedNodeId = focusNode?.id ?? state.selectedNodeId;

    // 时间线：已点亮的节点各一条，取后端事件原文（顺序 = 泳道图列序）
    resetTimelineSeq();
    const exec: PartialExecState = {
      stage: projection.stage,
      currentPage: state.currentPage,
      nodes: projection.nodes,
      revealedNodeCount: projection.revealedNodeCount,
      activeStepIndex: projection.activeStepIndex,
      selectedNodeId,
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
      assignedAgentIds: projection.agents,
      stage: projection.stage,
      analysisReady: true,
      nodes: projection.nodes,
      revealedNodeCount: projection.revealedNodeCount,
      activeStepIndex: projection.activeStepIndex,
      selectedNodeId,
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
      assignedAgentIds: projection.agents,
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

    // 真实磁盘是项目文件树的权威来源。ACP 的 artifact 事件可能只覆盖部分写操作，
    // run 终态后重新扫描一次，确保多文件产物全部立刻出现在侧栏。
    if (project?.rootPath) {
      void readProjectFolder(project.rootPath).then((scanned) => {
        if ('error' in scanned) return;
        set((latest) => ({
          projects: latest.projects.map((candidate) =>
            candidate.id === project.id ? { ...candidate, files: scanned.tree } : candidate,
          ),
        }));
      });
    }
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

  deleteTask: (taskId) => {
    const state = get();
    const target = state.tasks.find((t) => t.id === taskId);
    if (!target) return;
    // 先回写当前活动任务的实时状态，避免误删非活动任务时丢活动任务进度
    const synced = state.activeTaskId
      ? syncTasks(state.tasks, state.activeTaskId, extractTaskFields(state))
      : state.tasks;
    const remaining = synced.filter((t) => t.id !== taskId);

    // 任务没了，它那次 run 的订阅与实时状态也要一并撤掉 —— 否则后端订阅和 liveRuns 条目
    // 会随着建了又删的任务一直堆积。（run 本身仍在后端跑；这里只是不再关注它。）
    const dropped = target.contractRunId;
    const liveRuns = dropRun(state.liveRuns, dropped);
    if (dropped) void unwatchRun(dropped);

    if (taskId === state.activeTaskId) {
      // 删掉的是当前任务：切到同项目下另一个任务，或空态。
      get().stopAutoRun();
      const { activeTaskId, taskState } = pickProjectTask(remaining, target.projectId);
      set({
        tasks: remaining,
        liveRuns,
        activeTaskId,
        currentPage: 'tasks',
        isAutoRunning: false,
        ...taskState,
      });
    } else {
      set({ tasks: remaining, liveRuns });
    }
  },
});
