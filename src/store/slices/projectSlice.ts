import type { Project } from '@/types';
import { PROJECT_TRACE_FORMAT, type SliceCreator, type ProjectSlice } from '@/store/types';
import { uid } from '@/store/lib/ids';
import { pickProjectDirectory, readProjectFolder } from '@/lib/agentFs';
import { insertFileNode, removeFileNode } from '@/store/lib/fileTree';
import {
  emptyTaskFields,
  extractTaskFields,
  pickProjectTask,
  syncTasks,
} from '@/store/lib/taskSync';

/**
 * 把 BCD 的 agent 工作区绑到某个项目。
 *
 * 后端只在启动时读一次 ACP_WORKSPACE，所以换项目 = 重启后端子进程。
 * 浏览器里没有桌面桥（mock 模式），静默跳过。
 */
async function bindBackendWorkspace(project: Project): Promise<void> {
  const backend = window.desktop?.backend;
  if (!backend) return;
  try {
    await backend.configure({ projectName: project.name, rootPath: project.rootPath });
  } catch (err) {
    console.warn('[backend] 绑定 agent 工作区失败：', err);
  }
}

/** 项目域：项目生命周期（建/开/关/删/导出/导入）与项目文件树。 */
export const createProjectSlice: SliceCreator<ProjectSlice> = (set, get) => ({
  createProject: (name, description, rootPath) => {
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
      rootPath: rootPath || undefined,
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

  openProjectFromFolder: async () => {
    const picked = await pickProjectDirectory('选择项目文件夹');
    if (!picked) {
      // 非桌面环境给出提示；桌面端用户取消则静默
      return window.desktop ? null : '浏览器环境无法打开本机文件夹（桌面版可用）';
    }
    const scanned = await readProjectFolder(picked.path);
    if ('error' in scanned) return scanned.error;

    const state = get();
    // 同一磁盘目录已打开过：直接切回该项目，不重复创建
    const existing = state.projects.find((p) => p.rootPath === picked.path);
    if (existing) {
      get().openProject(existing.id);
      return null;
    }

    get().stopAutoRun();
    const tasks = state.activeTaskId
      ? syncTasks(state.tasks, state.activeTaskId, extractTaskFields(state))
      : state.tasks;
    const project: Project = {
      id: uid('proj'),
      name: picked.name,
      description: scanned.truncated ? '磁盘项目（文件树超限截断）' : '磁盘项目',
      lastOpened: '刚刚',
      tags: [],
      rootPath: picked.path,
      files: scanned.tree,
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
    return null;
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
    // 把 agent 的工作区绑到这个项目：BCD 只在启动时读 ACP_WORKSPACE，所以要重启后端。
    // 落点解析复用主进程 fsBridge 的那一套 —— agent 写进哪里 = E 观测面板读哪里。
    void bindBackendWorkspace(project);
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

  buildProjectTrace: (projectId) => {
    const state = get();
    const project = state.projects.find((p) => p.id === projectId);
    if (!project) return null;
    // 先回写当前活动任务的实时状态，确保 trace 是最新进度
    const tasks = state.activeTaskId
      ? syncTasks(state.tasks, state.activeTaskId, extractTaskFields(state))
      : state.tasks;
    return {
      format: PROJECT_TRACE_FORMAT,
      version: 1,
      savedAt: new Date().toISOString(),
      project: { id: project.id, name: project.name, rootPath: project.rootPath },
      tasks: tasks
        .filter((t) => t.projectId === projectId)
        .map((t) => ({
          id: t.id,
          contractTaskId: t.contractTaskId,
          title: t.title,
          taskText: t.taskText,
          completionCriteria: t.completionCriteria,
          assignedAgentIds: t.assignedAgentIds,
          stage: t.stage,
          interventionRules: t.interventionRules,
          filePermissionOutcomes: t.filePermissionOutcomes,
          confirmedCouncilOptionId: t.confirmedCouncilOptionId,
          timeline: t.timeline,
        })),
      agentFileWrites: state.agentFileWrites,
      backendEvents: state.backendEvents,
    };
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
      // 删的是查看页正打开的文件：一并关掉，避免展示已删除内容
      ...(state.openedFile?.projectId === projectId && state.openedFile.path === path
        ? {
            openedFile: null,
            currentPage: state.activeTaskId ? ('tasks' as const) : ('agents' as const),
          }
        : {}),
    }));
  },

  openFile: (projectId, path) => {
    const state = get();
    // 点了非聚焦项目的文件：先切过去（沿用 openProject 的任务/团队装载逻辑）
    if (projectId !== state.activeProjectId) get().openProject(projectId);
    set({ openedFile: { projectId, path }, currentPage: 'file' });
  },

  closeFile: () =>
    set((state) => ({
      openedFile: null,
      currentPage: state.activeTaskId ? 'tasks' : 'agents',
    })),
});
