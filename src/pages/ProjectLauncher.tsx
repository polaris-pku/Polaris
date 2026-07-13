import { useState } from 'react';
import {
  Boxes,
  FolderPlus,
  FolderOpen,
  FolderGit2,
  FolderSearch,
  Clock,
  ArrowRight,
} from 'lucide-react';
import { useDemoStore } from '@/store/useDemoStore';
import { Dialog } from '@/components/ui/Dialog';
import { NewProjectDialog } from '@/components/NewProjectDialog';
import { cn } from '@/lib/utils';
import type { Project } from '@/types';

/**
 * 启动页。
 *
 * 用户进入应用先在此新建 / 打开一个项目，之后才进入工作区。
 * 页脚那个「帮助」是**首次运行的用户唯一能看到的入口** —— 他还没进工作区，
 * 侧栏和状态栏都不存在，所以帮助抽屉必须挂在 App 级（它在每一屏都能开）。
 *
 * 背景的网格 + 背光由 body 提供（index.css），这里不再叠第二层：
 * 死的是元素级辉光，不是房间的背光。
 */
export function ProjectLauncher() {
  const projects = useDemoStore((s) => s.projects);
  const openProject = useDemoStore((s) => s.openProject);
  const openHelp = useDemoStore((s) => s.openHelp);
  const [newOpen, setNewOpen] = useState(false);
  const [openPickerOpen, setOpenPickerOpen] = useState(false);

  const recent = projects.slice(0, 4);

  return (
    // h-full（不是 min-h-screen）：外层 App 已占满视口，顶部可能有认证提示条
    <div className="relative flex h-full w-full items-center justify-center overflow-y-auto text-fg-secondary">
      <div className="relative z-10 w-full max-w-2xl px-6 py-12">
        {/* 品牌 */}
        <div className="flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-panel bg-command">
            <Boxes className="h-8 w-8 text-white" />
          </div>
          <h1 className="mt-4 text-title text-fg-primary">Polaris</h1>
          <p className="mt-2 max-w-sm text-body text-fg-muted">
            多 Agent 协作开发工作台。先新建或打开一个项目开始。
          </p>
        </div>

        {/* 两张动作卡片 */}
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <LauncherCard
            icon={FolderPlus}
            title="新建项目"
            desc="创建一个新的协作项目"
            accent="command"
            onClick={() => setNewOpen(true)}
          />
          <LauncherCard
            icon={FolderOpen}
            title="打开项目"
            desc="从已有项目或本机文件夹进入"
            accent="neutral"
            onClick={() => setOpenPickerOpen(true)}
          />
        </div>

        {/* 最近打开 */}
        {recent.length > 0 && (
          <div className="mt-8">
            <div className="mb-2 px-1 text-body text-fg-muted">最近打开</div>
            <div className="space-y-1.5">
              {recent.map((p) => (
                <RecentRow key={p.id} project={p} onOpen={() => openProject(p.id)} />
              ))}
            </div>
          </div>
        )}

        {/* 页脚：安静的帮助入口 —— 首次运行的用户就停在这一屏 */}
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={() => openHelp()}
            className="rounded-chip px-2 py-1 text-body text-fg-muted transition-colors hover:text-fg-secondary"
          >
            帮助
          </button>
        </div>
      </div>

      <NewProjectDialog open={newOpen} onClose={() => setNewOpen(false)} />
      <OpenProjectDialog open={openPickerOpen} onClose={() => setOpenPickerOpen(false)} />
    </div>
  );
}

function LauncherCard({
  icon: Icon,
  title,
  desc,
  accent,
  onClick,
}: {
  icon: typeof FolderPlus;
  title: string;
  desc: string;
  accent: 'command' | 'neutral';
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'group flex flex-col items-start gap-3 rounded-panel border p-4 text-left transition-colors',
        accent === 'command'
          ? 'border-command/40 bg-command/10 hover:border-command/70 hover:bg-command/15'
          : 'border-edge-strong bg-surface-panel hover:border-command/40 hover:bg-surface-raised',
      )}
    >
      <div
        className={cn(
          'flex h-10 w-10 items-center justify-center rounded-panel',
          accent === 'command'
            ? 'bg-command/20 text-command-soft'
            : 'bg-surface-raised text-fg-secondary',
        )}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="flex items-center gap-1.5 text-title text-fg-primary">
          {title}
          <ArrowRight className="h-4 w-4 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
        </div>
        <p className="mt-1 text-body text-fg-muted">{desc}</p>
      </div>
    </button>
  );
}

function RecentRow({ project, onOpen }: { project: Project; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-panel border border-transparent px-3 py-2 text-left transition-colors hover:border-edge-strong hover:bg-surface-raised"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-chip bg-surface-raised text-fg-secondary">
        <FolderGit2 className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-body text-fg-primary">{project.name}</div>
        {project.rootPath ? (
          <div className="truncate font-mono text-code text-fg-muted">{project.rootPath}</div>
        ) : (
          project.description && (
            <div className="truncate text-body text-fg-muted">{project.description}</div>
          )
        )}
      </div>
      {project.tags.length > 0 && (
        <div className="hidden shrink-0 items-center gap-1 sm:flex">
          {project.tags.map((t) => (
            <span
              key={t}
              className="rounded-chip border border-edge px-1.5 text-body text-fg-muted"
            >
              {t}
            </span>
          ))}
        </div>
      )}
      <div className="flex shrink-0 items-center gap-1 text-body text-fg-muted">
        <Clock className="h-3 w-3" />
        {project.lastOpened}
      </div>
    </button>
  );
}

function OpenProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const projects = useDemoStore((s) => s.projects);
  const openProject = useDemoStore((s) => s.openProject);
  const openProjectFromFolder = useDemoStore((s) => s.openProjectFromFolder);
  const [folderError, setFolderError] = useState<string | null>(null);

  const handleOpen = (id: string) => {
    openProject(id);
    onClose();
  };

  // 打开成功后 activeProjectId 变化，启动页整体卸载；用户取消选择则停留在本对话框
  const handleOpenFolder = async () => {
    setFolderError(null);
    const error = await openProjectFromFolder();
    if (error) setFolderError(error);
  };

  return (
    <Dialog open={open} onClose={onClose} className="max-w-md">
      <div className="p-6">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-panel bg-surface-raised text-fg-secondary">
            <FolderOpen className="h-5 w-5" />
          </div>
          <h2 className="text-title text-fg-primary">打开项目</h2>
        </div>

        {/* 从本机文件夹打开：原生选择动作 = 授权动作（与解释器的手动指定完全同构） */}
        <button
          onClick={() => void handleOpenFolder()}
          className="mt-4 flex w-full items-center gap-3 rounded-panel border border-edge-strong bg-surface-void px-3 py-2 text-left transition-colors hover:border-command/40 hover:bg-surface-raised"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-chip bg-surface-raised text-fg-secondary">
            <FolderSearch className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-body text-fg-primary">从文件夹打开</div>
            <div className="truncate text-body text-fg-muted">
              选择本机目录，扫描为项目文件树（Agent 产出写回该目录）
            </div>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-fg-faint" />
        </button>
        {folderError && <p className="mt-2 text-body text-danger">{folderError}</p>}

        <div className="mb-1.5 mt-4 px-1 text-body text-fg-muted">已有项目</div>
        <div className="max-h-64 space-y-1.5 overflow-y-auto">
          {projects.length === 0 ? (
            <p className="py-6 text-center text-body text-fg-muted">
              暂无项目 · 新建一个，或从文件夹打开
            </p>
          ) : (
            projects.map((p) => (
              <RecentRow key={p.id} project={p} onOpen={() => handleOpen(p.id)} />
            ))
          )}
        </div>
      </div>
    </Dialog>
  );
}
