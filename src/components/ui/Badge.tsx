import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * 徽章。
 *
 * base class 里曾焊死 `uppercase tracking-wider` —— 对汉字 uppercase 是 no-op（纯浪费），
 * tracking 却会真的把「执行中」拉成「执 行 中」（CJK 契约 C3）。两个都删了。
 * 色相收敛为 4 个强调色 + 中性：**颜色只编码状态**。
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-chip border px-2 py-0.5 text-body',
  {
    variants: {
      variant: {
        default: 'border-edge-strong bg-surface-raised text-fg-secondary',
        command: 'border-command/30 bg-command/10 text-command-soft',
        human: 'border-human/30 bg-human/10 text-human-soft',
        ok: 'border-ok/30 bg-ok/10 text-ok-soft',
        danger: 'border-danger/30 bg-danger/10 text-danger-soft',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
