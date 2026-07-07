import { createRequirementTask } from '@/data/tasks';
import { createTask as apiCreateTask } from '@/api/client';
import { toTaskCreateRequest } from '@/api/map';
import type { SliceCreator, TaskSlice } from '@/store/types';
import { uid } from '@/store/lib/ids';
import { extractTaskFields, pickProjectTask, syncTasks, taskToState } from '@/store/lib/taskSync';

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
});
