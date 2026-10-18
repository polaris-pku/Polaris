/** 开始、从头重试与可恢复停止/继续；不提供只有本地效果的人工裁决按钮。 */
import { useState } from 'react';
import { Play, RotateCcw, Workflow, Loader2, Pause } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { RunState } from '@/lib/runState';

export function PrimaryAction({
  state,
  retrying,
  error,
  onStart,
  onUseRecommended,
  onRetry,
  onInterrupt,
  onResume,
  pendingAction,
  connected = true,
}: {
  state: RunState;
  retrying: boolean;
  /** 重试被拒的原因（例如别的项目还有 run 在跑）—— 必须显示出来，不能吞掉 */
  error?: string;
  onStart: () => void;
  onUseRecommended: () => void;
  onRetry: () => void;
  onInterrupt?: () => void;
  onResume?: () => void;
  pendingAction?: 'interrupt' | 'resume';
  connected?: boolean;
}) {
  const [confirmResume, setConfirmResume] = useState(false);
  if (onInterrupt || onResume || pendingAction) {
    return (
      <div className="flex flex-col gap-2 border-t border-edge px-5 py-3">
        {confirmResume && onResume && (
          <p className="text-body text-human">
            继续会从检查点恢复，可能回写工作区文件。请先保护中断后自行修改的内容。
          </p>
        )}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={!connected || !!pendingAction}
            onClick={() => {
              if (onInterrupt) onInterrupt();
              else if (!confirmResume) setConfirmResume(true);
              else {
                setConfirmResume(false);
                onResume?.();
              }
            }}
          >
            {pendingAction ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : onInterrupt ? (
              <Pause className="h-4 w-4" aria-hidden />
            ) : (
              <Play className="h-4 w-4" aria-hidden />
            )}
            {pendingAction === 'interrupt'
              ? '正在停止并保存'
              : pendingAction === 'resume'
                ? '正在恢复'
                : onInterrupt
                  ? '停止并保存'
                  : confirmResume
                    ? '确认继续任务'
                    : '继续任务'}
          </Button>
          {confirmResume && !pendingAction && (
            <Button size="sm" variant="ghost" onClick={() => setConfirmResume(false)}>
              取消
            </Button>
          )}
        </div>
        {!connected && <p className="text-body text-fg-muted">后端连接中断，等待同步后再操作。</p>}
        {error && (
          <p role="alert" className="whitespace-pre-line text-body text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }
  if (state !== 'idle' && state !== 'failed' && state !== 'unsent') return null;

  return (
    <div className="flex flex-col gap-1 border-t border-edge px-5 py-3">
      <div className="flex items-center gap-3">
        {state === 'idle' ? (
          <>
            <Button variant="primary" size="sm" onClick={onStart}>
              <Play className="h-4 w-4" aria-hidden /> 开始执行
            </Button>
            <Button variant="ghost" size="sm" onClick={onUseRecommended}>
              <Workflow className="h-4 w-4" aria-hidden /> 采用推荐流程
            </Button>
          </>
        ) : (
          <Button variant="primary" size="sm" disabled={retrying} onClick={onRetry}>
            {retrying ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <RotateCcw className="h-4 w-4" aria-hidden />
            )}
            {retrying ? '正在重新提交' : '重试'}
          </Button>
        )}
      </div>
      {error && <p className="whitespace-pre-line text-body text-danger">{error}</p>}
    </div>
  );
}
