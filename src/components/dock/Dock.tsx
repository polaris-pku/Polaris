/**
 * Dock —— **L3 的唯一物理出口**。
 *
 * 三个频道：终端 / 事件流 / 运行时。它同时消掉了两个悬而未决的结构句：
 * 「证据台是底部升起的面板还是终端 dock 的一个 tab」（是 Dock 的一个频道），
 * 「运行时管理器是 modal 还是一个页面」（也是 Dock 的一个频道 —— 下载 250MB 时用户
 * 必须能切走干别的，modal 做不到；而加一个页面要动 `PageKey`，那是另一个项目）。
 *
 * **全应用只有事件流频道会渲染原始文本。** 三处事件转储（LiveRunPanel / NodeInspector /
 * 节点卡浮层）在物理上无法复活 —— 它们没有地方可去。
 *
 * 高度不进 store：`useResizablePane` 已经把它持久化到 localStorage，而 `resetDemo()`
 * 抹不掉那里 —— 两个真相源必然漂移，所以只留一个。
 */
import { ChevronDown } from 'lucide-react';
import { EventStreamChannel } from '@/components/dock/EventStreamChannel';
import { RuntimeChannel } from '@/components/dock/RuntimeChannel';
import { TerminalChannel } from '@/components/dock/TerminalChannel';
import { DOCK_CHANNEL_LABEL, type DockChannel } from '@/lib/glossary';
import { useResizablePane } from '@/lib/useResizablePane';
import { cn } from '@/lib/utils';
import { useDemoStore } from '@/store/useDemoStore';

/** 频道顺序固定：用户按位置记东西，不按名字。 */
const CHANNELS: readonly DockChannel[] = ['terminal', 'events', 'runtimes'];

export function Dock() {
  const dockOpen = useDemoStore((s) => s.dockOpen);
  const dockChannel = useDemoStore((s) => s.dockChannel);
  const setDockChannel = useDemoStore((s) => s.setDockChannel);
  const closeDock = useDemoStore((s) => s.closeDock);
  /** 终端 tab 上那枚点：有进程真的在跑。它是收起 Dock 之后唯一还在说话的信号。 */
  const running = useDemoStore((s) => s.termSessions.some((x) => x.status === 'running'));

  const { size, onResizeStart } = useResizablePane({
    side: 'bottom',
    defaultSize: 280,
    minSize: 120,
    maxSize: 600,
    storageKey: 'dock',
  });

  if (!dockOpen) return null;

  return (
    <section
      aria-label="Dock"
      style={{ height: size }}
      className="relative flex shrink-0 flex-col border-t border-edge bg-surface-void"
    >
      {/* 拖拽把手（上内边缘）：120–600 */}
      <div
        role="presentation"
        onMouseDown={onResizeStart}
        title="拖拽调整高度"
        className="absolute inset-x-0 top-0 z-10 h-1 cursor-row-resize transition-colors hover:bg-edge-strong"
      />

      <div
        role="tablist"
        aria-label="Dock 频道"
        className="flex h-8 shrink-0 items-center gap-1 border-b border-edge bg-surface-deck px-2"
      >
        {CHANNELS.map((channel) => (
          <button
            key={channel}
            type="button"
            role="tab"
            aria-selected={channel === dockChannel}
            onClick={() => {
              setDockChannel(channel);
            }}
            className={cn(
              'flex items-center gap-1.5 rounded-chip px-2 py-0.5 text-body transition-colors',
              channel === dockChannel
                ? 'bg-surface-raised text-fg-primary'
                : 'text-fg-muted hover:text-fg-secondary',
            )}
          >
            {DOCK_CHANNEL_LABEL[channel]}
            {channel === 'terminal' && running && (
              <span
                aria-label="有终端会话在运行"
                title="有终端会话在运行"
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-command"
              />
            )}
          </button>
        ))}

        <span className="flex-1" />

        <button
          type="button"
          onClick={closeDock}
          aria-label="收起 Dock"
          title="收起（状态栏左端的「终端」可以再打开）"
          className="rounded-chip p-1 text-fg-faint transition-colors hover:bg-surface-raised hover:text-fg-primary"
        >
          <ChevronDown className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {/* 频道各自无 props、各自读 store —— Dock 只做 tab 与拖拽 */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {dockChannel === 'terminal' && <TerminalChannel />}
        {dockChannel === 'events' && <EventStreamChannel />}
        {dockChannel === 'runtimes' && <RuntimeChannel />}
      </div>
    </section>
  );
}
