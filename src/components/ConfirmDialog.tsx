import { useEffect, useState } from 'react';
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
  /**
   * 确认动作。返回 Promise 时弹窗会进入 pending 状态：等待期间禁用按钮防重复提交，
   * 结果为 `{ ok: false }` 时**保持打开**并展示 error，由调用方决定后续。
   * void 返回值（同步动作）走旧行为：立刻关闭弹窗。
   */
  onConfirm?: (() => void | { ok: true } | Promise<{ ok: true } | { ok: false; error: string }>) | undefined;
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 每次打开都是一次全新的尝试：上一次的报错不该带进这一次。
  useEffect(() => {
    if (open) {
      setPending(false);
      setError(null);
    }
  }, [open]);

  const handleConfirm = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = onConfirm ? await onConfirm() : undefined;
      // 同步 void（onConfirm = undefined 或返回 void）：旧行为，立刻关闭；只有 Promise 且
      // 返回 { ok: false } 时保持打开并展示 error —— 这正是破坏性操作（删除）需要的行为。
      if (result && typeof result === 'object' && 'ok' in result && !result.ok) {
        setError(result.error);
        return;
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onClose={pending ? () => undefined : onClose} className="max-w-md">
      <div className="p-6">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-panel',
              danger ? 'bg-danger/15 text-danger' : 'bg-command/15 text-command-soft',
            )}
          >
            <AlertTriangle className="h-5 w-5" />
          </div>
          <h2 className="text-title text-fg-primary">{title}</h2>
        </div>
        {description && <p className="mt-3 text-body text-fg-secondary">{description}</p>}
        {error && (
          <p role="alert" className="mt-3 text-body text-danger">
            {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            取消
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            disabled={pending}
            onClick={() => {
              void handleConfirm();
            }}
          >
            {pending ? '处理中…' : confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
