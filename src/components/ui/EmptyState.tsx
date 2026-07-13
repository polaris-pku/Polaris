import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * 空状态的唯一形状：一个图标、一句话、（可选）一句解释、（可选）一个动作。
 *
 * R2：**后端没给的字段，删掉分区本身，不给空状态。** 所以这个组件只用来说明
 * 「这里现在确实什么都没有，你可以做点什么」——**绝不用来给一个永远填不满的分区当占位**。
 */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-8 text-center">
      <Icon className="h-5 w-5 text-fg-faint" aria-hidden />
      <p className="text-title text-fg-secondary">{title}</p>
      {hint && <p className="max-w-xs text-body text-fg-muted">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
