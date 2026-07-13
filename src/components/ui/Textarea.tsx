import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/** 需求描述是**散文，不是代码** —— 所以它走 font-sans 的正文档，不再是等宽。 */
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'w-full resize-none rounded-panel border border-edge-strong bg-surface-void px-3 py-2 font-sans text-body text-fg-primary placeholder:text-fg-faint focus:border-command focus:outline-none focus:ring-1 focus:ring-command/40',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';
