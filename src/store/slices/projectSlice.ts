import type { Project } from '@/types';
import { PROJECT_TRACE_FORMAT, type SliceCreator, type ProjectSlice } from '@/store/types';
import { unwatchRun } from '@/api/events';
import { uid } from '@/store/lib/ids';
import { pickProjectDirectory, readProjectFolder } from '@/lib/agentFs';
import { bindBackendWorkspace } from '@/lib/backendWorkspace';
import { canBindWorkspace, dropRun } from '@/store/lib/liveRuns';
import { insertFileNode, removeFileNode } from '@/store/lib/fileTree';
import {
  emptyTaskFields,
  extractTaskFields,
  pickProjectTask,
  syncTasks,
} from '@/store/lib/taskSync';

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
    // 工作区跟着新项目走 —— 但**只在没有别的项目的 run 在跑时**才敢绑：
    // 绑定会重启 BCD，而重启会连带杀掉正在干活的 agent（见 canBindWorkspace）。
    // 跳过也无妨：提交需求时 createTask 一定会再对齐一次，那才是权威的绑定时机。
    if (canBindWorkspace(get(), project.id).ok) void bindBackendWorkspace(project);
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
    //
    // ⚠️ 只在没有别的项目的 run 在跑时才绑。重启 BCD = 杀掉整个进程组，**包括正在写文件的 agent**。
    // 从前这里是无条件绑定的 —— 于是「点一下侧栏切到另一个项目」就足以静默杀死一次正在跑的需求，
    // 而那个任务会永远停在「执行中」。浏览项目不该有这种副作用。
    // 跳过绑定不会写错目录：提交需求时 createTask 会再对齐一次，那才是权威时机。
    if (canBindWorkspace(get(), project.id).ok) void bindBackendWorkspace(project);
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
    const removed = state.tasks.filter((t) => t.projectId === projectId);
    const tasks = state.tasks.filter((t) => t.projectId !== projectId);

    // 项目下所有任务的 run 一并退订并清出 liveRuns —— 否则订阅与实时状态会随删掉的项目泄漏。
    const removedRunIds = removed.map((t) => t.contractRunId);
    const liveRuns = dropRun(state.liveRuns, ...removedRunIds);
    for (const runId of removedRunIds) {
      if (runId) void unwatchRun(runId);
    }

    if (projectId === state.activeProjectId) {
      // 删除的是当前项目：回到空白启动页（其余项目仍在）。
      get().stopAutoRun();
      set({
        projects,
        tasks,
        liveRuns,
        activeProjectId: null,
        activeTaskId: null,
        selectedAgentId: null,
        teamCustomizationEnabled: false,
        isAutoRunning: false,
        ...emptyTaskFields(),
      });
    } else {
      set({ projects, tasks, liveRuns });
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
    // 本项目各任务对应的 run —— 用来把全局事件窗口过滤成「只属于本项目」的证据。
    const projectRunIds = new Set(
      tasks
        .filter((t) => t.projectId === projectId)
        .map((t) => t.contractRunId)
        .filter((id): id is string => !!id),
    );
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
      // 事件观测窗口是**全局**的（所有 run 的事件混在一起）。项目级 trace 是审计材料，
      // 塞进别的项目的 run 事件就是在污染证据 —— 按本项目任务的 run_id 过一遍。
      backendEvents: state.backendEvents.filter((e) => !!e.run_id && projectRunIds.has(e.run_id)),
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
