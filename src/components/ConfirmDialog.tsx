import { AlertTriangle } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

type Props = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

/** 通用确认弹窗（用于删除等破坏性操作，替代 window.confirm 以保持一致视觉且兼容 Electron）。 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '确认',
  danger = true,
  onConfirm,
  onClose,
}: Props) {
  return (
    <Dialog open={open} onClose={onClose} className="max-w-md">
      <div className="p-6">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-md',
              danger ? 'bg-rose-500/15 text-rose-300' : 'bg-command/15 text-command-soft',
            )}
          >
            <AlertTriangle className="h-5 w-5" />
          </div>
          <h2 className="font-display text-base font-semibold text-white">{title}</h2>
        </div>
        {description && (
          <p className="mt-3 text-sm leading-relaxed text-slate-400">{description}</p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
