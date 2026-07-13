import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * 结构化事实的唯一排版：`key` 灰、`value` 亮、一行一条。
 *
 * 全仓此前只有一处 KV 实现（NodeInspector 里），这正是 19 行 payload 被原样平铺到主层的直接原因：
 * 没有一个「能截断、能复制、能承认自己是 L2」的容器，所有人就直接 `Object.entries().map()`。
 */
export function KeyValue({
  k,
  v,
  mono,
  copyable,
}: {
  k: string;
  v: string;
  mono?: boolean;
  copyable?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(() => {
    if (!copyable) return;
    void navigator.clipboard?.writeText(v).then(() => {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setCopied(false);
      }, 1200);
    });
  }, [copyable, v]);

  const value = (
    <span
      className={cn(
        'min-w-0 truncate text-body',
        mono && 'tabular font-mono text-code',
        copied ? 'text-ok' : 'text-fg-secondary',
      )}
    >
      {copied ? '已复制' : v}
    </span>
  );

  return (
    <div className="flex items-baseline gap-3 py-1">
      <span className="w-20 shrink-0 text-body text-fg-muted">{k}</span>
      {copyable ? (
        <button
          type="button"
          onClick={copy}
          title={copied ? '已复制' : v}
          className="flex min-w-0 flex-1 text-left transition-colors hover:text-fg-primary"
        >
          {value}
        </button>
      ) : (
        <span className="flex min-w-0 flex-1" title={v}>
          {value}
        </span>
      )}
    </div>
  );
}

/** 一组 KV。给了 `onCopyAll` 就在末尾挂一行「整块复制」—— 报 bug 时用户需要的是整块，不是一条一条抠。 */
export function KeyValueList({
  children,
  onCopyAll,
}: {
  children: ReactNode;
  onCopyAll?: () => void;
}) {
  return (
    <div className="flex flex-col">
      {children}
      {onCopyAll && (
        <button
          type="button"
          onClick={onCopyAll}
          className="mt-1 self-start text-body text-fg-muted transition-colors hover:text-command"
        >
          ⧉ 复制为 JSON
        </button>
      )}
    </div>
  );
}
