import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * 全应用唯一的卡片容器 —— 取代 31 处手搓的 `rounded-* border-* bg-ink-*`。
 *
 * R5：一个容器只用一种方式与背景区分。Panel 选的是**描边 + 唯一的面板底色**，
 * **没有阴影**（纵深只由表面色阶 + 边框表达；元素级 box-shadow 全灭）。
 */
export function Panel({
  density = 'comfortable',
  className,
  children,
  ...props
}: {
  density?: 'compact' | 'comfortable';
  className?: string;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, 'children'>) {
  return (
    <div
      data-density={density}
      className={cn(
        'rounded-panel border border-edge bg-surface-panel',
        density === 'compact' ? 'p-2' : 'p-4',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** 面板抬头：15px 标题一行。层级靠字号 + 文本色，不靠字重（雅黑没有真 500/600）。 */
export function PanelHeader({
  className,
  children,
  ...props
}: { className?: string; children: ReactNode } & Omit<HTMLAttributes<HTMLDivElement>, 'children'>) {
  return (
    <div className={cn('flex items-center gap-2 text-title text-fg-primary', className)} {...props}>
      {children}
    </div>
  );
}

export function PanelBody({
  className,
  children,
  ...props
}: { className?: string; children: ReactNode } & Omit<HTMLAttributes<HTMLDivElement>, 'children'>) {
  return (
    <div className={cn('text-body text-fg-secondary', className)} {...props}>
      {children}
    </div>
  );
}
