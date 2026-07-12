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
import { cn } from '@/lib/utils';
import type { AgentStatus, DemoStage, FileNode, Project } from '@/types';

const GROUPS = ['files', 'tasks'] as const;

function defaultOpenKeys(projectId: string | null): string[] {
  if (!projectId) return [];
  return [`p:${projectId}`, ...GROUPS.map((g) => `g:${projectId}:${g}`), `d:${projectId}:src`];
}

const agentDotColor: Record<AgentStatus, string> = {
  created: 'text-slate-500',
  active: 'text-emerald-400',
  idle: 'text-slate-500',
  draining: 'text-amber-300',
  retired: 'text-violet-300',
};

const stageDotColor: Record<DemoStage, string> = {
  idle: 'bg-slate-600',
  team_configured: 'bg-command-soft',
  analyzing: 'bg-command-soft',
  workflow_recommended: 'bg-command-soft',
  executing: 'bg-blue-400',
  intervention: 'bg-human',
  council: 'bg-violet-400',
  delivery: 'bg-emerald-400',
};

const stageShort: Record<DemoStage, string> = {
  idle: '待开始',
  team_configured: '就绪',
  analyzing: '分析中',
  workflow_recommended: '已推荐',
  executing: '执行中',
  intervention: '介入',
  council: '议会',
  delivery: '已交付',
};

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
  const stage = useDemoStore((s) => s.stage);
  const tasks = useDemoStore((s) => s.tasks);
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
              'flex w-full items-center justify-center rounded-lg py-2 transition-colors',
              p.id === activeProjectId
                ? 'bg-command/15 text-command-soft ring-1 ring-command/30'
                : 'text-slate-400 hover:bg-ink-700 hover:text-slate-100',
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

  // 保存 agent 执行 trace：桌面版写入项目根目录 .polaris/，浏览器回退为下载
  const exportTrace = async (project: Project) => {
    const trace = buildProjectTrace(project.id);
    if (!trace) return;
    const result = await saveProjectTrace(trace);
    setConfirm({
      title: result.ok ? '执行 Trace 已保存' : 'Trace 保存失败',
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
        <span className="callsign text-[9px] text-slate-600">工作台</span>
        <button
          onClick={() => setNewProjectOpen(true)}
          title="新建项目"
          className="rounded-md p-1 text-slate-500 transition-colors hover:bg-command/10 hover:text-command-soft"
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
                  'group/proj flex items-center rounded-md pr-1 transition-colors',
                  isActive ? 'bg-command/10' : 'hover:bg-ink-700/70',
                )}
              >
                <button
                  onClick={() => toggle(`p:${project.id}`)}
                  className="p-1 text-slate-500 hover:text-slate-300"
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
                      isActive ? 'text-command-soft' : 'text-slate-400',
                    )}
                  />
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate font-mono text-[13px]',
                      isActive ? 'text-command-soft' : 'text-slate-200',
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
                  title="保存执行 Trace（agent 执行审计流水）"
                  className="p-1 text-slate-600 opacity-0 transition-opacity hover:text-command-soft group-hover/proj:opacity-100"
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
                  className="p-1 text-slate-600 opacity-0 transition-opacity hover:text-rose-400 group-hover/proj:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* 项目子树 */}
              {projectOpen && (
                <div className="ml-3 border-l border-line pl-1.5">
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
                        className="rounded p-0.5 text-slate-500 hover:bg-command/10 hover:text-command-soft"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    }
                  >
                    {addingFileFor === project.id && (
                      <div className="flex items-center gap-1 px-1 py-1">
                        <FileCode2 className="h-3.5 w-3.5 shrink-0 text-slate-500" />
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
                          className="min-w-0 flex-1 rounded border border-line-bright bg-ink-900 px-1.5 py-0.5 font-mono text-[11px] text-slate-100 placeholder:text-slate-600 focus:border-command focus:outline-none"
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
                        className="rounded p-0.5 text-slate-500 hover:bg-command/10 hover:text-command-soft"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    }
                  >
                    {projTasks.map((t) => {
                      const liveStage = t.id === activeTaskId ? stage : t.stage;
                      const selected = t.id === activeTaskId;
                      const taskKey = `t:${t.id}`;
                      const taskOpen = isOpen(taskKey);
                      const taskAgents = t.assignedAgentIds;
                      return (
                        <div key={t.id}>
                          {/* 任务行：左箭头展开团队，标题点击选中任务 */}
                          <div
                            className={cn(
                              'group/task flex items-center rounded pr-1 transition-colors',
                              selected ? 'bg-blue-600/20' : 'hover:bg-ink-700',
                            )}
                          >
                            <button
                              onClick={() => toggle(taskKey)}
                              className="p-0.5 text-slate-500 hover:text-slate-300"
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
                                'flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-1 text-left text-xs transition-colors',
                                selected ? 'text-blue-100' : 'text-slate-400 hover:text-slate-200',
                              )}
                            >
                              <span
                                className={cn(
                                  'h-1.5 w-1.5 shrink-0 rounded-full',
                                  stageDotColor[liveStage],
                                )}
                              />
                              <span className="min-w-0 flex-1 truncate">{t.title}</span>
                              <span className="shrink-0 text-[10px] text-slate-500">
                                {stageShort[liveStage]}
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
                              className="p-0.5 text-slate-600 opacity-0 transition-opacity hover:text-rose-400 group-hover/task:opacity-100"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>

                          {/* 该任务绑定的 Agent 团队（点标题跳 Agent Board 查看/自定义） */}
                          {taskOpen && (
                            <div className="ml-4 border-l border-line pl-1.5">
                              <button
                                onClick={() => openTaskTeam(t.id)}
                                title="打开 Agent Board · 查看 / 自定义该任务团队"
                                className="group/at flex w-full items-center gap-1 rounded px-1 py-0.5 text-left transition-colors hover:bg-ink-700/60"
                              >
                                <Users className="h-3 w-3 shrink-0 text-slate-500" />
                                <span className="callsign text-[9px] text-slate-500">Agents</span>
                                <span className="text-[9px] text-slate-600">
                                  {taskAgents.length}
                                </span>
                                <ChevronRight className="ml-auto h-2.5 w-2.5 text-slate-600 opacity-0 transition-opacity group-hover/at:opacity-100" />
                              </button>
                              {taskAgents.map((id) => {
                                const a = getAgentById(id);
                                if (!a) return null;
                                return (
                                  <button
                                    key={id}
                                    onClick={() => openTaskAgent(t.id, id)}
                                    className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs text-slate-400 transition-colors hover:bg-ink-700 hover:text-slate-200"
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
      <div className="group/g flex items-center rounded pr-1 hover:bg-ink-700/50">
        <button
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1 py-1 pl-0.5 text-left"
        >
          <ChevronRight
            className={cn(
              'h-3 w-3 shrink-0 text-slate-600 transition-transform',
              open && 'rotate-90',
            )}
          />
          <Icon className="h-3.5 w-3.5 shrink-0 text-slate-500" />
          <span className="callsign text-[9px] text-slate-500">{label}</span>
          <span className="text-[9px] text-slate-600">{count}</span>
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
        return (
          <div key={nodePath}>
            <div
              className={cn(
                'group/file flex items-center rounded pr-1 transition-colors',
                selected ? 'bg-blue-600/20' : 'hover:bg-ink-700/50',
              )}
            >
              <button
                onClick={() => (isDir ? toggle(dirKey) : onSelectFile(nodePath))}
                title={isDir ? undefined : '打开文件'}
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-1 py-0.5 text-left text-xs transition-colors',
                  selected ? 'text-blue-100' : 'text-slate-400 hover:text-slate-200',
                )}
                style={{ paddingLeft: `${depth * 12 + 4}px` }}
              >
                {isDir ? (
                  <ChevronRight
                    className={cn(
                      'h-3 w-3 shrink-0 text-slate-600 transition-transform',
                      dirOpen && 'rotate-90',
                    )}
                  />
                ) : (
                  <span className="w-3 shrink-0" />
                )}
                <Icon
                  className={cn(
                    'h-3.5 w-3.5 shrink-0',
                    isDir ? 'text-command-soft/70' : 'text-slate-500',
                  )}
                />
                <span className="min-w-0 flex-1 truncate font-mono">{node.name}</span>
                {/* 演示剧本写出的文件 —— 与后端真实 run 的产物落在同一个工作区，
                    不标就分不清是谁写的。真实产物不标（后端未给出工作区内的路径，不猜）。 */}
                {node.origin === 'demo' && (
                  <span
                    title="由演示剧本写入（非后端真实 agent 产出）"
                    className="callsign shrink-0 rounded border border-line-bright bg-ink-800 px-1 text-[8px] text-slate-500"
                  >
                    DEMO
                  </span>
                )}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(nodePath);
                }}
                title={isDir ? '删除文件夹（含内容）' : '删除文件'}
                className="p-0.5 text-slate-600 opacity-0 transition-opacity hover:text-rose-400 group-hover/file:opacity-100"
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
  return <div className="px-2 py-1 text-[11px] text-slate-600">{text}</div>;
}

function countFiles(nodes: FileNode[]): number {
  return nodes.reduce((acc, n) => acc + (n.children ? countFiles(n.children) : 1), 0);
}
