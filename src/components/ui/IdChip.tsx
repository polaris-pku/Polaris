import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/** 头 9 字 + 尾 4 字。UUID 对操作者的信息量精确为 0 —— 它只在报 bug 时需要被完整复制出来。 */
function truncate(value: string): string {
  return value.length <= 16 ? value : `${value.slice(0, 9)}…${value.slice(-4)}`;
}

/**
 * 机器 ID 的唯一呈现方式：截断 + hover 全文 + 点击复制。
 *
 * 它只允许出现在「运行信息」Fold 的 D2 里（全应用唯一的机器 ID 宿主）。
 */
export function IdChip({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(() => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setCopied(false);
      }, 1200);
    });
  }, [value]);

  return (
    <span className="inline-flex items-center gap-1.5">
      {label && <span className="text-body text-fg-muted">{label}</span>}
      <button
        type="button"
        onClick={copy}
        title={copied ? '已复制' : value}
        className={cn(
          'tabular rounded-chip border border-edge bg-surface-panel px-1.5 font-mono text-code transition-colors',
          copied ? 'text-ok' : 'text-fg-secondary hover:border-edge-strong hover:text-fg-primary',
        )}
      >
        {copied ? '已复制' : truncate(value)}
      </button>
    </span>
  );
}
