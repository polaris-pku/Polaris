import { type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useResizablePane } from '@/lib/useResizablePane';

const COLLAPSED_WIDTH = 36;

type SidePanelProps = {
  /** 面板位于主内容的哪一侧 */
  side: 'left' | 'right';
  /** 折叠后竖排显示的标题 */
  title: string;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  /** 提供则把宽度 / 折叠态持久化到 localStorage */
  storageKey?: string;
  className?: string;
  children: ReactNode;
};

/** 可折叠 + 可拖拽调宽的侧边面板（左右通用） */
export function SidePanel({
  side,
  title,
  defaultWidth = 360,
  minWidth = 260,
  maxWidth = 640,
  storageKey,
  className,
  children,
}: SidePanelProps) {
  const {
    size: width,
    collapsed,
    setCollapsed,
    onResizeStart,
    dragging,
  } = useResizablePane({
    side,
    defaultSize: defaultWidth,
    minSize: minWidth,
    maxSize: maxWidth,
    storageKey,
  });

  // chevron 指向「展开」方向
  const pointRight = (side === 'right') !== collapsed;

  return (
    <aside
      className={cn(
        'relative min-h-0 shrink-0 border-edge bg-surface-deck',
        side === 'right' ? 'border-l' : 'border-r',
        !dragging.current && 'transition-[width] duration-150',
        className,
      )}
      style={{ width: collapsed ? COLLAPSED_WIDTH : width }}
    >
      {/* 折叠 / 展开把手 */}
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        title={collapsed ? '展开面板' : '收起面板'}
        className={cn(
          'absolute top-1/2 z-30 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-edge-strong bg-surface-panel text-fg-muted transition-colors hover:border-edge-strong hover:text-fg-primary',
          side === 'right' ? '-left-3' : '-right-3',
        )}
      >
        {pointRight ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </button>

      {collapsed ? (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="flex h-full w-full items-start justify-center pt-6 text-fg-faint transition-colors hover:text-fg-secondary"
        >
          {/* 竖排标题是中文 —— 不 uppercase、不 tracking（CJK 契约 C3），字号也不低于 13px（C1） */}
          <span className="[writing-mode:vertical-rl] text-body">{title}</span>
        </button>
      ) : (
        <>
          {/* 拖拽调宽手柄（位于朝向主内容的内边缘） */}
          <div
            onMouseDown={onResizeStart}
            title="拖拽调整宽度"
            className={cn(
              'group absolute inset-y-0 z-20 w-1.5 cursor-col-resize',
              side === 'right' ? 'left-0' : 'right-0',
            )}
          >
            <div className="h-full w-full transition-colors group-hover:bg-command/40" />
          </div>
          <div className="h-full overflow-hidden">{children}</div>
        </>
      )}
    </aside>
  );
}
