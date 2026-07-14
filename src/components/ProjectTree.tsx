import { useEffect, useState } from 'react';
import {
  ChevronRight,
  Folder,
  FolderOpen,
  FileCode2,
  FileText,
  FileJson,
  File as FileIcon,
  Users,
  ListTodo,
  FolderGit2,
  Play,
  Plus,
  CircleDot,
  Trash2,
  ScrollText,
} from 'lucide-react';
import { useDemoStore } from '@/store/useDemoStore';
import { getAgentById } from '@/data/agents';
import { NewProjectDialog } from '@/components/NewProjectDialog';
import { NewRequirementDialog } from '@/components/NewRequirementDialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { saveProjectTrace } from '@/lib/projectFile';
import { RUN_STATE_LABEL, RUN_STATE_TONE, runStateOf, type RunState } from '@/lib/runState';
import { writeTargetOf } from '@/store/lib/agentWrites';
import { cn } from '@/lib/utils';
import type { LiveRunState } from '@/store/types';
import type { AgentStatus, DemoTask, FileNode, Project } from '@/types';

const GROUPS = ['files', 'tasks'] as const;

function defaultOpenKeys(projectId: string | null): string[] {
  if (!projectId) return [];
  return [`p:${projectId}`, ...GROUPS.map((g) => `g:${projectId}:${g}`), `d:${projectId}:src`];
}

/** Agent 在线状态的点色：只编码「在动 / 需要注意 / 无」，不新增色相。 */
const agentDotColor: Record<AgentStatus, string> = {
  created: 'text-fg-muted',
  active: 'text-ok',
  idle: 'text-fg-muted',
  draining: 'text-human',
  retired: 'text-fg-faint',
};

/** run 状态的点色。词表与色调都来自 runState.ts —— 这里不允许出现第二份。 */
const TONE_DOT: Record<(typeof RUN_STATE_TONE)[RunState], string> = {
  muted: 'bg-fg-faint',
  command: 'bg-brand-purple',
  human: 'bg-human',
  ok: 'bg-ok',
  danger: 'bg-danger',
};

const TONE_TEXT: Record<(typeof RUN_STATE_TONE)[RunState], string> = {
  muted: 'text-fg-muted',
  command: 'text-brand-purple',
  human: 'text-human-soft',
  ok: 'text-ok-soft',
  danger: 'text-danger-soft',
};

const isPython = (name: string) => /\.py$/i.test(name);

function fileIcon(name: string) {
  if (/\.(ts|tsx|js|jsx|go|py)$/.test(name)) return FileCode2;
  if (/\.json$/.test(name)) return FileJson;
  if (/\.(md|txt)$/.test(name)) return FileText;
  return FileIcon;
}

export function ProjectTree({ collapsed }: { collapsed: boolean }) {
  const projects = useDemoStore((s) => s.projects);
  const activeProjectId = useDemoStore((s) => s.activeProjectId);
  const activeTaskId = useDemoStore((s) => s.activeTaskId);
  const tasks = useDemoStore((s) => s.tasks);
  const liveRuns = useDemoStore((s) => s.liveRuns);
  const openProject = useDemoStore((s) => s.openProject);
  const selectTask = useDemoStore((s) => s.selectTask);
  const selectAgent = useDemoStore((s) => s.selectAgent);
  const setPage = useDemoStore((s) => s.setPage);
  const deleteProject = useDemoStore((s) => s.deleteProject);
  const deleteTask = useDemoStore((s) => s.deleteTask);
  const addFile = useDemoStore((s) => s.addFile);
  const deleteFile = useDemoStore((s) => s.deleteFile);
  const openFile = useDemoStore((s) => s.openFile);
  const openedFile = useDemoStore((s) => s.openedFile);
  const buildProjectTrace = useDemoStore((s) => s.buildProjectTrace);
  const startTerminalRun = useDemoStore((s) => s.startTerminalRun);

  const [open, setOpen] = useState<Set<string>>(() => new Set(defaultOpenKeys(activeProjectId)));
  // 选中态派生自查看页正打开的文件（点文件 = 打开文件查看页）
  const selectedFile = openedFile ? `${openedFile.projectId}:${openedFile.path}` : null;
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newReqOpen, setNewReqOpen] = useState(false);
  const [addingFileFor, setAddingFileFor] = useState<string | null>(null);
  const [newFileName, setNewFileName] = useState('');
  const [confirm, setConfirm] = useState<{
    title: string;
    description?: string;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);

  /**
   * 每一行任务只看**自己那次 run**：按该任务的 contractRunId 直接键控取数。
   * 绝不能退化成「取某个当前 run 的状态，安到所有任务头上」—— 并发跑多个需求时，
   * 那会让第二个 run 的状态覆盖第一个（liveRuns 从单槽改成表，就是为了修这个）。
   */
  const liveOf = (task: DemoTask): LiveRunState | undefined =>
    task.contractRunId ? liveRuns[task.contractRunId] : undefined;

  // 切换聚焦项目时，自动展开该项目的分组
  useEffect(() => {
    if (!activeProjectId) return;
    setOpen((prev) => {
      const next = new Set(prev);
      defaultOpenKeys(activeProjectId).forEach((k) => next.add(k));
      return next;
    });
  }, [activeProjectId]);

  // 切换当前任务时，自动展开该任务，露出它绑定的 Agent 团队
  useEffect(() => {
    if (!activeTaskId) return;
    setOpen((prev) => new Set(prev).add(`t:${activeTaskId}`));
  }, [activeTaskId]);

  const isOpen = (key: string) => open.has(key);
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (collapsed) {
    return (
      <div className="space-y-1">
        {projects.map((p) => (
          <button
            key={p.id}
            onClick={() => openProject(p.id)}
            title={p.name}
            className={cn(
              'flex w-full items-center justify-center rounded-panel py-2 transition-colors',
              p.id === activeProjectId
                ? 'bg-command/10 text-command-soft ring-1 ring-command/30'
                : 'text-fg-secondary hover:bg-surface-raised hover:text-fg-primary',
            )}
          >
            <FolderGit2 className="h-4 w-4" />
          </button>
        ))}
      </div>
    );
  }

  const requestNewRequirement = (projectId: string) => {
    if (projectId !== activeProjectId) openProject(projectId);
    setNewReqOpen(true);
  };

  const requestAddFile = (projectId: string) => {
    setOpen((prev) => new Set(prev).add(`g:${projectId}:files`));
    setNewFileName('');
    setAddingFileFor(projectId);
  };

  const submitAddFile = (projectId: string) => {
    if (newFileName.trim()) addFile(projectId, newFileName);
    setNewFileName('');
    setAddingFileFor(null);
  };

  // 导出运行记录：桌面版写入项目根目录 .polaris/，浏览器回退为下载
  const exportTrace = async (project: Project) => {
    const trace = buildProjectTrace(project.id);
    if (!trace) return;
    const result = await saveProjectTrace(trace);
    setConfirm({
      title: result.ok ? '运行记录已导出' : '导出失败',
      description: result.ok
        ? result.where === 'disk'
          ? result.absPath
          : `已下载：${result.filename}`
        : result.error,
      confirmLabel: '知道了',
      danger: !result.ok,
      onConfirm: () => {},
    });
  };

  /**
   * 【R3 / I5 —— 用户手势】点击文件行尾的 ▶ 才会走到这里。
   * 运行目标恒为「项目根 + 相对路径」，与 agent 的写入根（writeTargetOf）同源：
   * agent 写哪 = 面板读哪 = 终端跑哪，三者必须同根，否则相对路径的读写会落到两个地方。
   */
  const runPythonFile = (project: Project, relPath: string) => {
    void startTerminalRun({ ...writeTargetOf(project), relPath });
  };

  // Agent Board 已从侧栏收起：通过点任务的团队跳转过去（并切到该任务，展示其团队）。
  const openTaskTeam = (taskId: string) => {
    selectTask(taskId);
    setPage('agents');
  };

  const openTaskAgent = (taskId: string, agentId: string) => {
    selectTask(taskId);
    selectAgent(agentId);
    setPage('agents');
  };

  return (
    <div>
      {/* 工作台标题 + 新建项目 */}
      <div className="mb-1 flex items-center justify-between px-2">
        <span className="text-meta text-fg-faint">工作台</span>
        <button
          onClick={() => setNewProjectOpen(true)}
          title="新建项目"
          className="rounded-chip p-1 text-fg-muted transition-colors hover:bg-command/10 hover:text-command-soft"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-0.5">
        {projects.map((project) => {
          const projectOpen = isOpen(`p:${project.id}`);
          const isActive = project.id === activeProjectId;
          const projTasks = tasks.filter((t) => t.projectId === project.id);

          return (
            <div key={project.id}>
              {/* 项目行 */}
              <div
                className={cn(
                  'group/proj flex items-center rounded-chip pr-1 transition-colors',
                  isActive ? 'bg-command/10 ring-1 ring-command/20' : 'hover:bg-[#182238]/75',
                )}
              >
                <button
                  onClick={() => toggle(`p:${project.id}`)}
                  className="p-1 text-fg-muted hover:text-fg-secondary"
                  aria-label={projectOpen ? '收起' : '展开'}
                >
                  <ChevronRight
                    className={cn('h-3.5 w-3.5 transition-transform', projectOpen && 'rotate-90')}
                  />
                </button>
                <button
                  onClick={() => openProject(project.id)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left"
                >
                  <FolderGit2
                    className={cn(
                      'h-4 w-4 shrink-0',
                      isActive ? 'text-command-soft' : 'text-fg-secondary',
                    )}
                  />
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate font-mono text-body',
                      isActive ? 'text-command-soft' : 'text-fg-primary',
                    )}
                  >
                    {project.name}
                  </span>
                  {isActive && <CircleDot className="h-3 w-3 shrink-0 text-command-soft" />}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void exportTrace(project);
                  }}
                  title="导出运行记录"
                  className="p-1 text-fg-faint opacity-0 transition-opacity hover:text-command-soft group-hover/proj:opacity-100"
                >
                  <ScrollText className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirm({
                      title: `删除项目「${project.name}」？`,
                      description: '该项目及其全部任务、文件都会被删除，且无法恢复。',
                      onConfirm: () => deleteProject(project.id),
                    });
                  }}
                  title="删除项目"
                  className="p-1 text-fg-faint opacity-0 transition-opacity hover:text-danger group-hover/proj:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* 项目子树 */}
              {projectOpen && (
                <div className="ml-3 border-l border-edge pl-1.5">
                  {/* 文件 */}
                  <TreeGroup
                    icon={Folder}
                    label="文件"
                    count={countFiles(project.files)}
                    open={isOpen(`g:${project.id}:files`)}
                    onToggle={() => toggle(`g:${project.id}:files`)}
                    action={
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          requestAddFile(project.id);
                        }}
                        title="添加文件"
                        className="rounded-chip p-0.5 text-fg-muted hover:bg-command/10 hover:text-command-soft"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    }
                  >
                    {addingFileFor === project.id && (
                      <div className="flex items-center gap-1 px-1 py-1">
                        <FileCode2 className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
                        <input
                          autoFocus
                          value={newFileName}
                          onChange={(e) => setNewFileName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') submitAddFile(project.id);
                            if (e.key === 'Escape') {
                              setNewFileName('');
                              setAddingFileFor(null);
                            }
                          }}
                          onBlur={() => {
                            setNewFileName('');
                            setAddingFileFor(null);
                          }}
                          placeholder="如 index.ts、src/util.ts；结尾加 / 建文件夹"
                          className="min-w-0 flex-1 rounded-chip border border-edge-strong bg-surface-deck px-1.5 py-0.5 font-mono text-meta text-fg-primary placeholder:text-fg-faint focus:border-command focus:outline-none"
                        />
                      </div>
                    )}
                    <FileTree
                      nodes={project.files}
                      projectId={project.id}
                      path=""
                      depth={0}
                      isOpen={isOpen}
                      toggle={toggle}
                      selectedFile={selectedFile}
                      onSelectFile={(path) => openFile(project.id, path)}
                      onRunFile={(path) => runPythonFile(project, path)}
                      onDelete={(path) => deleteFile(project.id, path)}
                    />
                    {project.files.length === 0 && addingFileFor !== project.id && (
                      <EmptyHint text="暂无文件 · 点 ＋ 添加" />
                    )}
                  </TreeGroup>

                  {/* 任务（每个任务展开显示它绑定的 Agent 团队） */}
                  <TreeGroup
                    icon={ListTodo}
                    label="任务"
                    count={projTasks.length}
                    open={isOpen(`g:${project.id}:tasks`)}
                    onToggle={() => toggle(`g:${project.id}:tasks`)}
                    action={
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          requestNewRequirement(project.id);
                        }}
                        title="新建需求"
                        className="rounded-chip p-0.5 text-fg-muted hover:bg-command/10 hover:text-command-soft"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    }
                  >
                    {projTasks.map((t) => {
                      const runState = runStateOf(t, liveOf(t));
                      const tone = RUN_STATE_TONE[runState];
                      const selected = t.id === activeTaskId;
                      const taskKey = `t:${t.id}`;
                      const taskOpen = isOpen(taskKey);
                      const taskAgents = t.assignedAgentIds;
                      return (
                        <div key={t.id}>
                          {/* 任务行：左箭头展开团队，标题点击选中任务 */}
                          <div
                            className={cn(
                              'group/task flex items-center rounded-chip pr-1 transition-colors',
                              selected
                                ? 'bg-command/10 ring-1 ring-command/20'
                                : 'hover:bg-[#182238]',
                            )}
                          >
                            <button
                              onClick={() => toggle(taskKey)}
                              className="p-0.5 text-fg-muted hover:text-fg-secondary"
                              aria-label={taskOpen ? '收起' : '展开'}
                            >
                              <ChevronRight
                                className={cn(
                                  'h-3 w-3 transition-transform',
                                  taskOpen && 'rotate-90',
                                )}
                              />
                            </button>
                            <button
                              onClick={() => selectTask(t.id)}
                              className={cn(
                                'flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-1 text-left text-body transition-colors',
                                selected
                                  ? 'text-command-soft'
                                  : 'text-fg-secondary hover:text-fg-primary',
                              )}
                            >
                              <span
                                className={cn(
                                  'h-1.5 w-1.5 shrink-0 rounded-full',
                                  TONE_DOT[tone],
                                  runState === 'running' && 'animate-pulse-ring',
                                )}
                              />
                              <span className="min-w-0 flex-1 truncate">{t.title}</span>
                              <span className={cn('shrink-0 text-meta', TONE_TEXT[tone])}>
                                {RUN_STATE_LABEL[runState]}
                              </span>
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirm({
                                  title: `删除任务「${t.title}」？`,
                                  description: '该任务及其执行进度、绑定团队都会被删除。',
                                  onConfirm: () => deleteTask(t.id),
                                });
                              }}
                              title="删除任务"
                              className="p-0.5 text-fg-faint opacity-0 transition-opacity hover:text-danger group-hover/task:opacity-100"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>

                          {/* 该任务绑定的 Agent 团队（点标题跳团队页查看 / 自定义） */}
                          {taskOpen && (
                            <div className="ml-4 border-l border-edge pl-1.5">
                              <button
                                onClick={() => openTaskTeam(t.id)}
                                title="打开团队页 · 查看 / 自定义该任务团队"
                                className="group/at flex w-full items-center gap-1 rounded-chip px-1 py-0.5 text-left transition-colors hover:bg-surface-raised/60"
                              >
                                <Users className="h-3 w-3 shrink-0 text-fg-muted" />
                                {/* 纯 ASCII，合法的 callsign 眉标（CJK 契约 C2） */}
                                <span className="callsign text-micro text-fg-muted">Agents</span>
                                <span className="text-meta text-fg-faint">{taskAgents.length}</span>
                                <ChevronRight className="ml-auto h-3 w-3 text-fg-faint opacity-0 transition-opacity group-hover/at:opacity-100" />
                              </button>
                              {taskAgents.map((id) => {
                                const a = getAgentById(id);
                                if (!a) return null;
                                return (
                                  <button
                                    key={id}
                                    onClick={() => openTaskAgent(t.id, id)}
                                    className="flex w-full items-center gap-1.5 rounded-chip px-1.5 py-1 text-left text-body text-fg-secondary transition-colors hover:bg-surface-raised hover:text-fg-primary"
                                  >
                                    <CircleDot
                                      className={cn('h-3 w-3 shrink-0', agentDotColor[a.status])}
                                    />
                                    <span className="min-w-0 flex-1 truncate">{a.name}</span>
                                  </button>
                                );
                              })}
                              {taskAgents.length === 0 && <EmptyHint text="团队为空" />}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {projTasks.length === 0 && <EmptyHint text="暂无任务 · 点 ＋ 新建需求" />}
                  </TreeGroup>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <NewProjectDialog open={newProjectOpen} onClose={() => setNewProjectOpen(false)} />
      <NewRequirementDialog open={newReqOpen} onClose={() => setNewReqOpen(false)} />
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title ?? ''}
        description={confirm?.description}
        confirmLabel={confirm?.confirmLabel ?? '删除'}
        danger={confirm?.danger ?? true}
        onConfirm={() => confirm?.onConfirm()}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}

function TreeGroup({
  icon: Icon,
  label,
  count,
  open,
  onToggle,
  action,
  children,
}: {
  icon: typeof Folder;
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="group/g flex items-center rounded-chip pr-1 hover:bg-[#182238]/55">
        <button
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1 py-1 pl-0.5 text-left"
        >
          <ChevronRight
            className={cn(
              'h-3 w-3 shrink-0 text-fg-faint transition-transform',
              open && 'rotate-90',
            )}
          />
          <Icon className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
          <span className="text-meta text-fg-muted">{label}</span>
          <span className="text-meta text-fg-faint tabular">{count}</span>
        </button>
        {action && (
          <span className="opacity-0 transition-opacity group-hover/g:opacity-100">{action}</span>
        )}
      </div>
      {open && <div className="ml-1">{children}</div>}
    </div>
  );
}

function FileTree({
  nodes,
  projectId,
  path,
  depth,
  isOpen,
  toggle,
  selectedFile,
  onSelectFile,
  onRunFile,
  onDelete,
}: {
  nodes: FileNode[];
  projectId: string;
  path: string;
  depth: number;
  isOpen: (key: string) => boolean;
  toggle: (key: string) => void;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  onRunFile: (path: string) => void;
  onDelete: (path: string) => void;
}) {
  return (
    <div>
      {nodes.map((node) => {
        const nodePath = path ? `${path}/${node.name}` : node.name;
        const isDir = !!node.children;
        const dirKey = `d:${projectId}:${nodePath}`;
        const dirOpen = isOpen(dirKey);
        const Icon = isDir ? (dirOpen ? FolderOpen : Folder) : fileIcon(node.name);
        const selected = !isDir && selectedFile === `${projectId}:${nodePath}`;
        const runnable = !isDir && isPython(node.name);
        return (
          <div key={nodePath}>
            <div
              className={cn(
                'group/file flex items-center rounded-chip pr-1 transition-colors',
                selected ? 'bg-command/10 ring-1 ring-command/20' : 'hover:bg-[#182238]/60',
              )}
            >
              <button
                onClick={() => (isDir ? toggle(dirKey) : onSelectFile(nodePath))}
                title={isDir ? undefined : '打开文件'}
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-1 py-0.5 text-left text-body transition-colors',
                  selected ? 'text-command-soft' : 'text-fg-secondary hover:text-fg-primary',
                )}
                style={{ paddingLeft: `${depth * 12 + 4}px` }}
              >
                {isDir ? (
                  <ChevronRight
                    className={cn(
                      'h-3 w-3 shrink-0 text-fg-faint transition-transform',
                      dirOpen && 'rotate-90',
                    )}
                  />
                ) : (
                  <span className="w-3 shrink-0" />
                )}
                <Icon
                  className={cn(
                    'h-3.5 w-3.5 shrink-0',
                    isDir ? 'text-command-soft/70' : 'text-fg-muted',
                  )}
                />
                <span className="min-w-0 flex-1 truncate font-mono">{node.name}</span>
              </button>
              {/* 【R3 / I5】运行只由这一次点击触发 —— 没有任何事件驱动的自动执行。 */}
              {runnable && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRunFile(nodePath);
                  }}
                  title="在终端里运行"
                  className="p-0.5 text-fg-faint opacity-0 transition-opacity hover:text-command-soft group-hover/file:opacity-100"
                >
                  <Play className="h-3 w-3" />
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(nodePath);
                }}
                title={isDir ? '删除文件夹（含内容）' : '删除文件'}
                className="p-0.5 text-fg-faint opacity-0 transition-opacity hover:text-danger group-hover/file:opacity-100"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
            {isDir && dirOpen && (
              <FileTree
                nodes={node.children!}
                projectId={projectId}
                path={nodePath}
                depth={depth + 1}
                isOpen={isOpen}
                toggle={toggle}
                selectedFile={selectedFile}
                onSelectFile={onSelectFile}
                onRunFile={onRunFile}
                onDelete={onDelete}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <div className="px-2 py-1 text-meta text-fg-faint">{text}</div>;
}

function countFiles(nodes: FileNode[]): number {
  return nodes.reduce((acc, n) => acc + (n.children ? countFiles(n.children) : 1), 0);
}
