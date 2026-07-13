import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * 按钮：**4 个 variant，没有第 5 个。**
 *
 * 删掉的 `council` / `success` / `warning` / `outline` 各自带着一个色相和一次性阴影 ——
 * `council`(violet) 已并入 `human`（议会本质上就是「轮到人裁决」）；元素级 box-shadow 全灭
 * （纵深只由表面色阶 + 边框表达）。字重只有 400 / 700：base 里的 `font-medium` 删除。
 */
const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-panel transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-command/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-void disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        /** 机器在动：此刻唯一的主行动 */
        primary: 'bg-command text-white hover:bg-command-soft',
        secondary: 'border border-edge-strong text-fg-primary hover:bg-surface-raised',
        ghost: 'text-fg-secondary hover:bg-surface-raised hover:text-fg-primary',
        danger: 'bg-danger text-surface-void hover:bg-danger-soft',
      },
      size: {
        sm: 'h-8 px-3 text-body',
        md: 'h-9 px-4 text-body',
        lg: 'h-11 px-6 text-title',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = 'Button';
