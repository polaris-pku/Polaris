import { type ReactNode, useState } from 'react';
import { CircleDot, Boxes, ChevronRight, ChevronLeft, LayoutGrid, Settings } from 'lucide-react';
import { useDemoStore } from '@/store/useDemoStore';
import { isMockMode } from '@/api/config';
import type { DemoStage } from '@/types';
import { cn } from '@/lib/utils';
import { useResizablePane } from '@/lib/useResizablePane';
import { ProjectTree } from '@/components/ProjectTree';
import { SettingsDialog } from '@/components/SettingsDialog';
import { APP_VERSION } from '@/lib/version';

const stageLabels: Record<DemoStage, string> = {
  idle: '待组队',
  team_configured: '团队就绪',
  analyzing: '需求分析中',
  workflow_recommended: '已推荐流程',
  executing: '执行中',
  intervention: '用户介入',
  council: '议会裁决中',
  delivery: '已交付',
};

const stageColors: Record<DemoStage, string> = {
  idle: 'text-slate-400',
  team_configured: 'text-command-soft',
  analyzing: 'text-command-soft',
  workflow_recommended: 'text-command-soft',
  executing: 'text-command-soft',
  intervention: 'text-human',
  council: 'text-violet-300',
  delivery: 'text-emerald-300',
};

// stages where the human holds the controls — the LIVE thread glows warm
const humanStages: DemoStage[] = ['intervention', 'council'];

export function AppShell({ children }: { children: ReactNode }) {
  const stage = useDemoStore((s) => s.stage);
  const nodes = useDemoStore((s) => s.nodes);
  const activeStepIndex = useDemoStore((s) => s.activeStepIndex);
  const assignedAgentIds = useDemoStore((s) => s.assignedAgentIds);
  const tasks = useDemoStore((s) => s.tasks);
  const activeTaskId = useDemoStore((s) => s.activeTaskId);
  const closeProject = useDemoStore((s) => s.closeProject);
  const backendEvents = useDemoStore((s) => s.backendEvents);
  const eventChannelStatus = useDemoStore((s) => s.eventChannelStatus);

  // 事件链路遥测：mock 走本地喂入（LOCAL），真后端显示 BCD 进程通道状态
  const eventLink = isMockMode()
    ? { label: 'LOCAL', className: 'text-slate-400', dot: 'bg-slate-500' }
    : eventChannelStatus === 'connected'
      ? { label: 'LIVE', className: 'text-emerald-300', dot: 'bg-emerald-400' }
      : eventChannelStatus === 'connecting'
        ? { label: 'SYNC…', className: 'text-command-soft', dot: 'bg-command animate-blink' }
        : { label: 'OFFLINE', className: 'text-slate-500', dot: 'bg-slate-600' };
  const latestEvent = backendEvents[0];

  const {
    size: navWidth,
    collapsed: navCollapsed,
    setCollapsed: setNavCollapsed,
    onResizeStart: onNavResizeStart,
    dragging: navDragging,
  } = useResizablePane({
    side: 'left',
    defaultSize: 240,
    minSize: 184,
    maxSize: 360,
    storageKey: 'nav',
  });

  const activeNode = activeStepIndex >= 0 ? nodes[activeStepIndex] : null;
  const humanLive = humanStages.includes(stage);
  const activeTask = tasks.find((t) => t.id === activeTaskId);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    // h-full（不是 h-screen）：外层 App 已经占满视口，且顶部可能有认证提示条
    <div className="flex h-full w-full overflow-hidden bg-ink-950 text-slate-200">
      {/* Command deck */}
      <aside
        className={cn(
          'relative flex shrink-0 flex-col border-r border-line bg-ink-900/70',
          !navDragging.current && 'transition-[width] duration-150',
        )}
        style={{ width: navCollapsed ? 64 : navWidth }}
      >
        {/* 折叠 / 展开把手 */}
        <button
          type="button"
          onClick={() => setNavCollapsed((v) => !v)}
          title={navCollapsed ? '展开工作台' : '收起工作台'}
          className="absolute -right-3 top-7 z-30 flex h-7 w-7 items-center justify-center rounded-full border border-slate-700 bg-ink-850 text-slate-400 shadow-md transition-colors hover:border-slate-500 hover:text-slate-200"
        >
          {navCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>

        <div
          className={cn(
            'flex items-center gap-3 border-b border-line py-[18px]',
            navCollapsed ? 'justify-center px-0' : 'px-5',
          )}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-command shadow-glow">
            <Boxes className="h-5 w-5 text-white" />
          </div>
          {!navCollapsed && (
            <div className="leading-tight">
              <div className="font-display text-sm font-semibold tracking-tight text-white">
                Polaris
              </div>
            </div>
          )}
        </div>

        <nav
          className={cn('flex-1 space-y-1 overflow-y-auto py-4', navCollapsed ? 'px-2' : 'px-3')}
        >
          <ProjectTree collapsed={navCollapsed} />
        </nav>

        <div className="border-t border-line p-3">
          {!navCollapsed && (
            <div className="mb-2 flex items-center justify-between px-2">
              <span className="callsign text-[9px] text-slate-600">团队</span>
              <span className="font-mono text-[11px] text-slate-400 tabular">
                {String(assignedAgentIds.length).padStart(2, '0')} / 04
              </span>
            </div>
          )}
          <button
            onClick={() => setSettingsOpen(true)}
            title={navCollapsed ? `设置 · v${APP_VERSION}` : undefined}
            className={cn(
              'flex w-full items-center gap-3 rounded-md py-2 text-sm text-slate-400 transition-colors hover:bg-ink-700 hover:text-command-soft',
              navCollapsed ? 'justify-center px-0' : 'px-3',
            )}
          >
            <Settings className="h-4 w-4 shrink-0" />
            {!navCollapsed && (
              <span className="flex flex-1 items-center justify-between">
                设置
                <span className="font-mono text-[10px] text-slate-600">v{APP_VERSION}</span>
              </span>
            )}
          </button>
          <button
            onClick={closeProject}
            title={navCollapsed ? '返回启动页' : undefined}
            className={cn(
              'flex w-full items-center gap-3 rounded-md py-2 text-sm text-slate-400 transition-colors hover:bg-ink-700 hover:text-command-soft',
              navCollapsed ? 'justify-center px-0' : 'px-3',
            )}
          >
            <LayoutGrid className="h-4 w-4 shrink-0" />
            {!navCollapsed && '返回启动页'}
          </button>
        </div>

        {/* 拖拽调宽手柄（右内边缘，仅展开时） */}
        {!navCollapsed && (
          <div
            onMouseDown={onNavResizeStart}
            title="拖拽调整宽度"
            className="group absolute inset-y-0 right-0 z-20 w-1.5 cursor-col-resize"
          >
            <div className="h-full w-full transition-colors group-hover:bg-command/40" />
          </div>
        )}
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>

        {/* Telemetry strip */}
        <footer className="flex h-8 shrink-0 items-center gap-0 border-t border-line bg-ink-900/90 px-3 font-mono text-[11px] text-slate-400">
          <span className="flex items-center gap-2 pr-4">
            <CircleDot className={cn('h-3 w-3', stageColors[stage])} />
            <span className="callsign text-[9px] text-slate-600">STAGE</span>
            <span className={cn('font-medium', stageColors[stage])}>{stageLabels[stage]}</span>
          </span>
          <span className="h-3.5 w-px bg-line-bright" />
          <span className="flex items-center gap-2 px-4">
            <span className="callsign text-[9px] text-slate-600">TASK</span>
            <span className="text-slate-300">{activeTask?.title ?? '—'}</span>
          </span>
          <span className="h-3.5 w-px bg-line-bright" />
          <span className="flex items-center gap-2 px-4">
            <span className="callsign text-[9px] text-slate-600">NODE</span>
            <span className="font-medium text-slate-200">
              {activeNode ? `${activeNode.code} ${activeNode.label}` : '—'}
            </span>
          </span>
          <span className="h-3.5 w-px bg-line-bright" />
          <span className="flex items-center gap-2 px-4">
            <span className="callsign text-[9px] text-slate-600">OWNER</span>
            <span className="text-slate-300">{activeNode ? activeNode.owner : '—'}</span>
          </span>
          <span className="h-3.5 w-px bg-line-bright" />
          <span className="flex items-center gap-2 px-4">
            <span className={cn('led h-2 w-2', eventLink.dot)} />
            <span className="callsign text-[9px] text-slate-600">EVENTS</span>
            <span className={cn('callsign text-[10px]', eventLink.className)}>
              {eventLink.label}
            </span>
            {latestEvent && <span className="text-slate-500">{latestEvent.event_type}</span>}
          </span>
          <span className="ml-auto flex items-center gap-2 pl-4">
            <span
              className={cn('led h-2 w-2', humanLive ? 'animate-blink bg-human' : 'bg-emerald-400')}
            />
            <span
              className={cn('callsign text-[10px]', humanLive ? 'text-human' : 'text-emerald-300')}
            >
              {humanLive ? 'HUMAN IN COMMAND' : 'SYSTEM NOMINAL'}
            </span>
          </span>
        </footer>
      </div>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
