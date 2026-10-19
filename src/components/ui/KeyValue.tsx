import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * 结构化事实的唯一排版：`key` 灰、`value` 亮、一行一条。
 *
 * 全仓此前只有一处 KV 实现（NodeInspector 里），这正是 19 行 payload 被原样平铺到主层的直接原因：
 * 没有一个「能截断、能复制、能承认自己是 L2」的容器，所有人就直接 `Object.entries().map()`。
 *
 * 默认 `truncate` 截断成单行：状态/计数/ID 这种「瞄一眼就行」的事实用截断是合适的。
 * 但有些事实本身就是一句人话（事件图里挑出来的那一行 `summary`） —— 截断成 `…` 反而把它
 * 「人类可读」这一层最重要的特性给毁掉了。对这种行要显式开 `wrap` 让它换行。
 */
export function KeyValue({
  k,
  v,
  mono,
  copyable,
  wrap,
}: {
  k: string;
  v: string;
  mono?: boolean;
  copyable?: boolean;
  /**
   * 允许 value 换行（`whitespace-pre-wrap`）。只对承载**人话句子**的事实开启
   * （如「关键事实」），其它仍然走单行 `truncate` —— 默认 false。
   */
  wrap?: boolean;
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
        // wrap 行不要 truncate：截断对一句人话来说没意义，宁可让它换行也不要丢字。
        // 非 wrap 行 min-w-0 + truncate 保持现状 —— 这是「瞄一眼」的事实的正确行为。
        'min-w-0 text-body',
        wrap ? 'whitespace-pre-wrap break-words' : 'truncate',
        mono && 'tabular font-mono text-code',
        copied ? 'text-ok' : 'text-fg-secondary',
      )}
    >
      {copied ? '已复制' : v}
    </span>
  );

  return (
    <div className={cn('flex gap-3 py-1', wrap ? 'items-start' : 'items-baseline')}>
      <span
        className={cn(
          // 换行时 key 跟着行首对齐（不再 baseline），与多行 value 顶部齐平
          'w-20 shrink-0 text-body text-fg-muted',
          wrap && 'pt-0.5',
        )}
      >
        {k}
      </span>
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
