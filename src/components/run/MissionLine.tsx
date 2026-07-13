/**
 * 主句 —— **全屏唯一的 24px（`text-headline`）**。
 *
 * 它是这块屏幕的主语。陌生人站两米外看 3 秒，必须能说出「谁 / 在做什么 / 多久了 / 成没成」——
 * 这就是整次重设计的验收判据，而它全部压在这一行上。
 *
 * 在此之前，这四件事碎在六个互相竞争的对象里（`执行中` badge、`LIVE · 后端真实执行` badge、
 * `COORD · TASK_<uuid>`、`MODE · SINGLE_AGENT`、常驻 textarea、5 个英文按钮的控制栏）——
 * **没有一处是主语**。那六个已经全部删除。
 *
 * 四态同槽：主句只有一个槽位，idle / running / blocked / completed / failed / cancelled /
 * unsent 轮流占用它。**永远不要为某个状态在旁边加第二行。**
 */
import { FolderOpen } from 'lucide-react';
import type { EventChannelStatus } from '@/api/events';
import type { RunState } from '@/lib/runState';
import { cn } from '@/lib/utils';

/** 主句的语气：颜色只编码状态。human = 需要你，全屏最多一处。 */
const HEADLINE_TONE: Record<RunState, string> = {
  idle: 'text-fg-primary',
  running: 'text-fg-primary',
  blocked: 'text-human',
  completed: 'text-fg-primary',
  failed: 'text-danger',
  cancelled: 'text-fg-muted',
  unsent: 'text-danger',
};

/**
 * 呼吸点 = **事件通道健康度**（原底部遥测条 6 格里唯一不重复的那一格，幸存并升到主句旁）。
 *
 * 它回答的是那个没人问出口、却每次都想问的问题：**界面不动，是没事发生，还是断了？**
 * 全屏唯一还会发光的东西就是它 —— 因为它是唯一真的在传达「活着」的东西。
 */
const CHANNEL_TONE: Record<EventChannelStatus, { dot: string; title: string }> = {
  connected: { dot: 'bg-command', title: '后端事件通道已连接' },
  connecting: { dot: 'bg-human', title: '正在连接后端事件通道' },
  disconnected: { dot: 'bg-danger', title: '后端事件通道已断开（界面收不到新事件）' },
};

export function MissionLine({
  state,
  headline,
  sub,
  workspacePath,
  channel,
  onRetry,
  onRevealWorkspace,
}: {
  state: RunState;
  headline: string;
  sub?: string;
  workspacePath?: string;
  channel: EventChannelStatus;
  onRetry?: () => void;
  onRevealWorkspace?: () => void;
}) {
  const tone = CHANNEL_TONE[channel];
  const clickable = (state === 'failed' || state === 'unsent') && !!onRetry;

  return (
    <div className="flex items-start gap-3">
      <span
        aria-label={tone.title}
        title={tone.title}
        className={cn(
          'led mt-3 h-1.5 w-1.5 shrink-0 rounded-full',
          tone.dot,
          channel === 'connected' && 'animate-pulse-ring',
        )}
      />

      <div className="min-w-0 flex-1">
        {/* text-headline 在全仓只允许出现这一次（design-guard 规则 11 会数它）。
            unsent / failed 时主句本身可点 —— 那个错误就是它的出路，不需要第二个控件。 */}
        <h1 className={cn('truncate text-headline', HEADLINE_TONE[state])}>
          {clickable ? (
            <button
              type="button"
              onClick={onRetry}
              className="max-w-full truncate text-left transition-colors hover:text-danger-soft"
            >
              {headline}
            </button>
          ) : (
            headline
          )}
        </h1>

        {sub && <p className="truncate text-body text-fg-secondary">{sub}</p>}

        {/* agent 到底把文件写到哪 —— **全屏后果最重的一条事实**。
            它原来是侧栏第二行的 10px 灰字；文件写错项目也毫无察觉，run 照样显示已交付。 */}
        {workspacePath && (
          <button
            type="button"
            onClick={onRevealWorkspace}
            title={`在文件管理器中打开：${workspacePath}`}
            className="mt-0.5 flex max-w-full items-center gap-1 rounded-chip text-code text-fg-muted transition-colors hover:text-command"
          >
            <FolderOpen className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">{workspacePath}</span>
          </button>
        )}
      </div>
    </div>
  );
}
