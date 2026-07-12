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
 * IDE 启动页 · Project Launcher
 * 用户进入应用先在此新建 / 打开一个 Project，之后才进入 Agent 团队工作区。
 * 「打开项目」= 已有项目列表 + 从本机文件夹打开（合并为一个入口）。
 */
export function ProjectLauncher() {
  const projects = useDemoStore((s) => s.projects);
  const openProject = useDemoStore((s) => s.openProject);
  const [newOpen, setNewOpen] = useState(false);
  const [openPickerOpen, setOpenPickerOpen] = useState(false);

  const recent = projects.slice(0, 4);

  return (
    // h-full（不是 min-h-screen）：外层 App 已占满视口，顶部可能有认证提示条
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-ink-950 text-slate-200">
      {/* 背景机械感光晕 + 网格 */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(37,99,235,0.12),transparent_70%)]" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(148,163,184,0.6) 1px,transparent 1px),linear-gradient(90deg,rgba(148,163,184,0.6) 1px,transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      <div className="relative z-10 w-full max-w-2xl px-6 py-12">
        {/* Brand */}
        <div className="flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-command shadow-glow">
            <Boxes className="h-8 w-8 text-white" />
          </div>
          <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight text-white">
            Polaris
          </h1>
          <p className="mt-2 max-w-sm text-sm text-slate-500">
            多 Agent 协作开发工作台。先新建或打开一个项目开始。
          </p>
        </div>

        {/* 两张动作卡片 */}
        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            accent="slate"
            onClick={() => setOpenPickerOpen(true)}
          />
        </div>

        {/* 最近打开 */}
        {recent.length > 0 && (
          <div className="mt-10">
            <div className="callsign mb-2 px-1 text-[9px] text-slate-600">最近打开</div>
            <div className="space-y-1.5">
              {recent.map((p) => (
                <RecentRow key={p.id} project={p} onOpen={() => openProject(p.id)} />
              ))}
            </div>
          </div>
        )}
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
  accent: 'command' | 'slate';
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'group flex flex-col items-start gap-3 rounded-xl border p-5 text-left transition-all',
        accent === 'command'
          ? 'border-command/40 bg-command/10 hover:border-command/70 hover:bg-command/15 hover:shadow-glow'
          : 'border-line-bright bg-ink-900/60 hover:border-slate-500 hover:bg-ink-800/60',
      )}
    >
      <div
        className={cn(
          'flex h-10 w-10 items-center justify-center rounded-lg',
          accent === 'command' ? 'bg-command/20 text-command-soft' : 'bg-ink-700 text-slate-300',
        )}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="flex items-center gap-1.5 font-display text-base font-semibold text-white">
          {title}
          <ArrowRight className="h-4 w-4 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
        </div>
        <p className="mt-1.5 text-xs text-slate-500">{desc}</p>
      </div>
    </button>
  );
}

function RecentRow({ project, onOpen }: { project: Project; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:border-line-bright hover:bg-ink-800/60"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-ink-800 text-slate-400">
        <FolderGit2 className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-sm text-slate-100">{project.name}</div>
        {project.rootPath ? (
          <div className="truncate font-mono text-[10px] text-slate-600">{project.rootPath}</div>
        ) : (
          project.description && (
            <div className="truncate text-xs text-slate-500">{project.description}</div>
          )
        )}
      </div>
      {project.tags.length > 0 && (
        <div className="hidden shrink-0 items-center gap-1 sm:flex">
          {project.tags.map((t) => (
            <span
              key={t}
              className="rounded border border-line-bright px-1.5 py-0.5 text-[10px] text-slate-500"
            >
              {t}
            </span>
          ))}
        </div>
      )}
      <div className="flex shrink-0 items-center gap-1 text-[11px] text-slate-600">
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
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-ink-700 text-slate-300">
            <FolderOpen className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-base font-semibold text-white">打开项目</h2>
          </div>
        </div>

        {/* 从本机文件夹打开（桌面版扫描目录为项目文件树） */}
        <button
          onClick={handleOpenFolder}
          className="mt-5 flex w-full items-center gap-3 rounded-lg border border-line-bright bg-ink-900/60 px-3 py-2.5 text-left transition-colors hover:border-slate-500 hover:bg-ink-800/60"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-ink-700 text-slate-300">
            <FolderSearch className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm text-slate-100">从文件夹打开 · Open Folder</div>
            <div className="truncate text-xs text-slate-500">
              选择本机目录，扫描为项目文件树（Agent 产出写回该目录）
            </div>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-slate-600" />
        </button>
        {folderError && <p className="mt-2 text-xs text-rose-300">{folderError}</p>}

        <div className="callsign mb-1.5 mt-4 px-1 text-[9px] text-slate-600">已有项目</div>
        <div className="max-h-64 space-y-1.5 overflow-y-auto">
          {projects.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-600">
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
