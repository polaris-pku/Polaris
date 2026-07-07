import type { Project } from '@/types';
import type { DemoTask } from '@/types';
import { PROJECT_EXPORT_FORMAT, type SliceCreator, type ProjectSlice } from '@/store/types';
import { uid } from '@/store/lib/ids';
import { insertFileNode, removeFileNode } from '@/store/lib/fileTree';
import {
  cloneTask,
  emptyTaskFields,
  extractTaskFields,
  pickProjectTask,
  syncTasks,
} from '@/store/lib/taskSync';

/** 项目域：项目生命周期（建/开/关/删/导出/导入）与项目文件树。 */
export const createProjectSlice: SliceCreator<ProjectSlice> = (set, get) => ({
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
});
