/**
 * 应用外壳：侧栏 + 主区 + Dock + 状态栏。
 *
 * ── 这次重设计在这里删掉的东西 ──
 * 整条底部遥测条（6 格）。`STAGE` / `TASK` / `NODE` / `OWNER` 是同一批事实的第 2–3 次重复
 * （主句、面包屑、步骤轨各说过一遍），而 `SYSTEM NOMINAL` / `HUMAN IN COMMAND` 是**写死的
 * 常量字符串** —— 军事仪表盘的皮，零信息内核。六格里只有 `EVENTS` 换血活了下来：它是唯一
 * 回答了「界面不动，是没事发生，还是断了」的那一格，现在是状态栏右段的通道 LED。
 * 连带死掉的还有第 3 套 stage 词表（`stageLabels` / `stageColors`）—— 状态词表全应用只剩
 * `RUN_STATE_LABEL` 一套（由 StatusBar 消费）。
 *
 * ── 新增的两件东西 ──
 * `<Dock/>`：终端 / 事件流 / 运行时。**L3 的唯一物理出口。**
 * `<StatusBar/>`：28px，跨页恒在 —— 它是「我打开了 snake.py，agent 还在跑吗」这个问题
 * 在全屏唯一还活着的答案。
 */
import { type ReactNode, useState } from 'react';
import { ChevronLeft, ChevronRight, CircleHelp, LayoutGrid, Settings } from 'lucide-react';
import { Dock } from '@/components/dock/Dock';
import { Logo } from '@/components/Logo';
import { ProjectTree } from '@/components/ProjectTree';
import { SettingsDialog } from '@/components/SettingsDialog';
import { StatusBar } from '@/components/StatusBar';
import { cn } from '@/lib/utils';
import { useResizablePane } from '@/lib/useResizablePane';
import { APP_VERSION } from '@/lib/version';
import { useDemoStore } from '@/store/useDemoStore';

export function AppShell({ children }: { children: ReactNode }) {
  const assignedAgentIds = useDemoStore((s) => s.assignedAgentIds);
  const closeProject = useDemoStore((s) => s.closeProject);
  const openHelp = useDemoStore((s) => s.openHelp);

  const {
    size: navWidth,
    collapsed: navCollapsed,
    setCollapsed: setNavCollapsed,
    onResizeStart: onNavResizeStart,
    dragging: navDragging,
  } = useResizablePane({
    side: 'left',
    defaultSize: 248,
    minSize: 184,
    maxSize: 360,
    storageKey: 'nav',
  });

  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    // h-full（不是 h-screen）：外层 App 已经占满视口，且顶部可能有认证提示条
    <div className="flex h-full w-full flex-col overflow-hidden bg-brand-void text-fg-secondary">
      <div className="flex min-h-0 flex-1">
        {/* 侧栏 */}
        <aside
          className={cn(
            'relative flex shrink-0 flex-col border-r border-edge bg-brand-deep',
            !navDragging.current && 'transition-[width] duration-150',
          )}
          style={{ width: navCollapsed ? 56 : navWidth }}
        >
          {/* 折叠 / 展开把手 */}
          <button
            type="button"
            onClick={() => {
              setNavCollapsed((v) => !v);
            }}
            title={navCollapsed ? '展开工作台' : '收起工作台'}
            className="absolute -right-3 top-7 z-30 flex h-6 w-6 items-center justify-center rounded-full border border-brand-border bg-brand-panel text-fg-muted transition-colors hover:border-brand-purple hover:text-brand-silver"
          >
            {navCollapsed ? (
              <ChevronRight className="h-3 w-3" aria-hidden />
            ) : (
              <ChevronLeft className="h-3 w-3" aria-hidden />
            )}
          </button>

          <div
            className={cn(
              'flex items-center gap-3 border-b border-edge py-4',
              navCollapsed ? 'justify-center px-0' : 'px-4',
            )}
          >
            <div className="flex shrink-0 items-center justify-center">
              <Logo className="h-8 w-8" />
            </div>
            {!navCollapsed && <div className="text-title text-brand-silver">Polaris</div>}
          </div>

          <nav
            className={cn('flex-1 space-y-1 overflow-y-auto py-4', navCollapsed ? 'px-2' : 'px-3')}
          >
            <ProjectTree collapsed={navCollapsed} />
          </nav>

          <div className="border-t border-edge p-3">
            {!navCollapsed && (
              <div className="mb-2 px-3 text-body text-fg-muted">
                {/* 分母没了：原来那个写死的 `/ 04` 在 single_agent 的真实 run 里是句假话 */}
                团队 · {assignedAgentIds.length} 人
              </div>
            )}

            {/* 帮助的**主入口** —— Windows 上原生菜单不可见，这是唯一一个每屏都在的锚点 */}
            <SideAction
              icon={CircleHelp}
              label="帮助"
              collapsed={navCollapsed}
              onClick={() => {
                openHelp();
              }}
            />

            <SideAction
              icon={Settings}
              label="设置"
              collapsed={navCollapsed}
              title={navCollapsed ? `设置 · v${APP_VERSION}` : undefined}
              onClick={() => {
                setSettingsOpen(true);
              }}
              trailing={<span className="tabular text-meta text-fg-faint">v{APP_VERSION}</span>}
            />

            <SideAction
              icon={LayoutGrid}
              label="返回启动页"
              collapsed={navCollapsed}
              onClick={closeProject}
            />
          </div>

          {/* 拖拽调宽手柄（右内边缘，仅展开时） */}
          {!navCollapsed && (
            <div
              role="presentation"
              onMouseDown={onNavResizeStart}
              title="拖拽调整宽度"
              className="group absolute inset-y-0 right-0 z-20 w-1 cursor-col-resize"
            >
              <div className="h-full w-full transition-colors group-hover:bg-brand-purple/40" />
            </div>
          )}
        </aside>

        {/* 主区：页面在上，Dock 在下 */}
        <div className="flex min-w-0 flex-1 flex-col">
          <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
          <Dock />
        </div>
      </div>

      <StatusBar />

      <SettingsDialog
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
        }}
      />
    </div>
  );
}

/** 侧栏页脚的一行：图标 + 文字（收起态只剩图标）。 */
function SideAction({
  icon: Icon,
  label,
  collapsed,
  title,
  trailing,
  onClick,
}: {
  icon: typeof Settings;
  label: string;
  collapsed: boolean;
  title?: string;
  trailing?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? (collapsed ? label : undefined)}
      className={cn(
        'flex w-full items-center gap-3 rounded-panel py-2 text-body text-fg-secondary transition-colors hover:bg-brand-raised hover:text-brand-silver',
        collapsed ? 'justify-center px-0' : 'px-3',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {!collapsed && (
        <span className="flex flex-1 items-center justify-between">
          {label}
          {trailing}
        </span>
      )}
    </button>
  );
}
