import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export type FoldStatus = 'idle' | 'running' | 'ok' | 'danger' | 'human';
export type FoldTier = 'human' | 'milestone' | 'machine';

/**
 * 渐进披露的唯一容器：**D1 说人话，D2 说结构。**
 *
 * F4「折叠不吃布局」：D1 行恒 32px（text-title 的 24px 行盒 + py-1），展开只向下推 ——
 * 不浮层、不抽屉套抽屉。
 *
 * F3「L3 永远不能从 D1 直接打开」的**物理保证**：传了 `evidence`，本组件就自己在 D2 的
 * **最后一行**渲染那一行 `原始事件 · {n} 条 ↗`。措辞 / 形状 / 位置由组件保证，不靠自律 ——
 * 这个字符串全仓只允许出现在本文件里（design-guard 规则 13 会守住）。
 */
export function Fold({
  id,
  title,
  status = 'idle',
  fact,
  meta,
  tier,
  defaultOpen,
  evidence,
  children,
}: {
  id: string;
  title: string;
  status?: FoldStatus;
  fact?: string;
  meta?: string;
  tier?: FoldTier;
  defaultOpen?: boolean;
  evidence?: { count: number; onOpen: () => void };
  children: ReactNode;
}) {
  // 默认纵深由已存在的 `tier` 字段驱动：人要看的那一步（human）默认就展到 D2。
  const [open, setOpen] = useState(defaultOpen ?? tier === 'human');
  const bodyId = `${id}-d2`;

  return (
    <div
      className={cn(
        'border-b border-edge bg-surface-panel',
        // human = 需要你。全屏最多一处，所以它值得一条左缘。
        status === 'human' && 'border-l-2 border-l-human',
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => {
          setOpen((v) => !v);
        }}
        className="fold-row flex w-full items-center gap-2 px-3 py-1 text-left transition-colors hover:bg-surface-raised"
      >
        <StatusDot status={status} />
        <span className="shrink-0 text-title text-fg-primary">{title}</span>
        {fact && (
          <span className="min-w-0 flex-1 truncate text-body text-fg-secondary">{fact}</span>
        )}
        {!fact && <span className="flex-1" />}
        {/* meta 是 11px：按 CJK 契约 C1，这一档只承载数字 / ASCII（计数、时长、版本号） */}
        {meta && <span className="tabular shrink-0 text-meta text-fg-muted">{meta}</span>}
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-fg-faint transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div id={bodyId} className="border-t border-edge bg-surface-raised px-3 py-2">
          {children}
          {evidence && (
            <button
              type="button"
              onClick={evidence.onOpen}
              className="mt-2 flex w-full items-center gap-1 border-t border-edge pt-2 text-left text-body text-fg-muted transition-colors hover:text-command"
            >
              原始事件 · <span className="tabular">{evidence.count}</span> 条 ↗
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const DOT_TONE: Record<FoldStatus, string> = {
  idle: 'border border-fg-faint',
  running: 'bg-command',
  ok: 'bg-ok',
  danger: 'bg-danger',
  human: 'bg-human',
};

/**
 * 只有 `running` 那枚会呼吸、会发光 —— 它是这一列里唯一真的在传达「活着」的东西。
 * 其余状态是静态圆点：不给死掉的事实加辉光。
 */
function StatusDot({ status }: { status: FoldStatus }) {
  return (
    <span
      aria-hidden
      className={cn(
        'h-1.5 w-1.5 shrink-0 rounded-full',
        DOT_TONE[status],
        status === 'running' && 'led animate-pulse-ring',
      )}
    />
  );
}
