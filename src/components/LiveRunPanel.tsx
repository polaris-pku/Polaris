/**
 * 后端真实 Run 面板。
 *
 * 存在的理由：泳道图 / 执行时间线演的是 **mock 剧本**，而 `liveRun` 是 **后端真事实**。
 * 两者并存且长得很像 —— 不分开呈现，用户会把演示当成真实执行（反过来也会）。
 * 这个面板只展示后端给了什么：状态、真实事件流、错误、产物。**后端没说的不补写。**
 */
import { AlertTriangle, CheckCircle2, Loader2, ServerCrash, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { useDemoStore } from '@/store/useDemoStore';
import { explainError } from '@/lib/backendErrors';
import { cn } from '@/lib/utils';
import type { RunEventSource } from '@/api/types/rpc';

const STATUS_META = {
  running: { label: '执行中', variant: 'blue', Icon: Loader2, spin: true },
  completed: { label: '已完成', variant: 'green', Icon: CheckCircle2, spin: false },
  failed: { label: '失败', variant: 'red', Icon: XCircle, spin: false },
  cancelled: { label: '已取消', variant: 'slate', Icon: ServerCrash, spin: false },
} as const;

/** 事件来源 → 颜色（与 N0–N18 的责任方分区同一套语义：A/B/C/D + agent）。 */
const SOURCE_COLOR: Record<RunEventSource, string> = {
  coordinator: 'text-command-soft',
  agent: 'text-violet-300',
  driver: 'text-emerald-300',
  memory: 'text-sky-300',
  gate: 'text-human-soft',
  council: 'text-violet-300',
};

export function LiveRunPanel() {
  const liveRun = useDemoStore((s) => s.liveRun);

  // 没有真实 run（纯 mock 剧本任务）→ 整个面板不出现，避免占位噪音。
  if (!liveRun) return null;

  const meta = STATUS_META[liveRun.status];
  const { Icon } = meta;
  const errors = liveRun.snapshot?.errors ?? [];
  const delivery = liveRun.snapshot?.delivery_report;

  return (
    <div className="border-b border-line-bright bg-ink-900/40">
      <div className="flex items-center gap-2 px-4 pb-2 pt-3">
        <Icon className={cn('h-3.5 w-3.5 text-slate-400', meta.spin && 'animate-spin')} />
        <span className="callsign text-[9px] text-slate-400">后端真实 Run</span>
        <Badge variant={meta.variant}>{meta.label}</Badge>
        <span className="ml-auto font-mono text-[9px] text-slate-600">
          {liveRun.runId.slice(0, 12)}…
        </span>
      </div>

      {/* 与 mock 剧本划清界限：这句话是这个面板存在的全部意义 */}
      <p className="px-4 pb-2 text-[10px] leading-relaxed text-slate-500">
        这里是 agent 在后端的<strong className="text-slate-300">真实执行</strong>
        。左侧泳道图与执行时间线走的是
        <strong className="text-slate-300">演示剧本</strong>，两者独立、互不影响。
      </p>

      {/* 失败原因：翻译成人话 + 保留后端原始码 */}
      {errors.map((error) => {
        const explained = explainError(error);
        return (
          <div
            key={explained.code}
            className={cn(
              'mx-4 mb-3 rounded border px-3 py-2',
              explained.actionable
                ? 'border-human/30 bg-human/5'
                : 'border-rose-500/30 bg-rose-500/5',
            )}
          >
            <div className="flex items-start gap-2">
              <AlertTriangle
                className={cn(
                  'mt-0.5 h-3.5 w-3.5 shrink-0',
                  explained.actionable ? 'text-human-soft' : 'text-rose-300',
                )}
              />
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-200">{explained.title}</p>
                {explained.hint && (
                  <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
                    {explained.hint}
                  </p>
                )}
                <p className="mt-1.5 font-mono text-[9px] text-slate-600">
                  {explained.code} · {explained.raw}
                </p>
              </div>
            </div>
          </div>
        );
      })}

      {/* 交付产物：如实展示后端给的 files_written（是 worktree 内的产物引用，
          后端未给出工作区里最终文件的路径 —— 不猜、不补） */}
      {delivery && delivery.files_written.length > 0 && (
        <div className="px-4 pb-3">
          <p className="callsign mb-1 text-[9px] text-slate-500">
            后端产物 · {delivery.artifacts_materialized} 个
          </p>
          {delivery.files_written.map((file) => (
            <p key={file} className="truncate font-mono text-[9px] text-slate-400" title={file}>
              {file}
            </p>
          ))}
        </div>
      )}

      {/* 真实事件流：按 sequence 升序，来源着色 */}
      <div className="max-h-52 overflow-y-auto border-t border-line px-4 py-2">
        <p className="callsign mb-1.5 text-[9px] text-slate-500">
          后端事件 · {liveRun.timeline.length} 条
        </p>
        <ol className="space-y-0.5">
          {liveRun.timeline.map((event) => (
            <li key={event.event_id} className="flex items-baseline gap-2 font-mono text-[10px]">
              <span className="w-5 shrink-0 text-right text-slate-600">{event.sequence}</span>
              <span className={cn('truncate', SOURCE_COLOR[event.source])}>{event.type}</span>
              <span className="ml-auto shrink-0 text-[9px] text-slate-600">{event.source}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
