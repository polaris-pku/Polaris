/**
 * 主行动 —— **一个按钮，而且只在 idle 与 failed / unsent 时存在。**
 *
 * 【R4 · 收不到就别画按钮】running 期间这一行**根本不渲染**：后端全自动，且它**没有人类回写通道**
 * （`can_create_merge_authorization` 恒 false，也没有 `gate.respond` RPC）。
 * 一个 live run 上的「介入」按钮只会改本地状态，永远送不到 agent 那里 ——
 * 让用户以为自己影响了 agent，比一个死按钮更糟。所以 `介入` / `Next Step` / `Auto Run` 全部删除。
 */
import { Play, RotateCcw, Workflow, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { RunState } from '@/lib/runState';

export function PrimaryAction({
  state,
  retrying,
  error,
  onStart,
  onUseRecommended,
  onRetry,
}: {
  state: RunState;
  retrying: boolean;
  /** 重试被拒的原因（例如别的项目还有 run 在跑）—— 必须显示出来，不能吞掉 */
  error?: string;
  onStart: () => void;
  onUseRecommended: () => void;
  onRetry: () => void;
}) {
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
