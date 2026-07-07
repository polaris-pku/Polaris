import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * 统一样式的折叠抽屉（渐进披露）——Agent 详情 / 节点详情 / 文件操作 / 执行日志同一视觉语言。
 */
export function Collapsible({
  icon: Icon,
  title,
  gloss,
  meta,
  accent,
  defaultOpen = false,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  gloss?: string;
  meta?: string;
  accent?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-slate-800 bg-ink-900/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-2.5 text-left transition-colors hover:bg-ink-800/50"
      >
        {Icon && <Icon className={cn('h-3.5 w-3.5', accent ?? 'text-slate-500')} />}
        <span className={cn('text-[11px] font-semibold', accent ?? 'text-slate-300')}>{title}</span>
        {gloss && <span className="text-[10px] text-slate-600">{gloss}</span>}
        <span className="flex-1" />
        {meta && (
          <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
            {meta}
          </span>
        )}
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-slate-500 transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && <div className="border-t border-slate-800/80 px-3 py-2.5">{children}</div>}
    </div>
  );
}
