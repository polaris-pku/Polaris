import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Loader2, ScrollText } from 'lucide-react';
import { selectActiveReplay, useDemoStore } from '@/store/useDemoStore';
import {
  buildCouncilConfirmLogLines,
  buildInterventionLogLines,
  buildUpdatedPendingLines,
  nodeExecutionLogs,
} from '@/data/nodeExecutionLogs';
import { stripExecSuffix } from '@/data/workflow';
import type { NodeExecLogLevel, NodeExecLogLine, RunReplay, WorkflowNodeStatus } from '@/types';
import { cn } from '@/lib/utils';

const levelStyles: Record<NodeExecLogLevel, string> = {
  info: 'text-slate-300',
  success: 'text-emerald-300',
  warning: 'text-amber-300',
  council: 'text-violet-300',
  debug: 'text-slate-500',
};

const tagStyles: Record<NodeExecLogLevel, string> = {
  info: 'bg-slate-700/60 text-slate-300',
  success: 'bg-emerald-600/20 text-emerald-300',
  warning: 'bg-amber-600/20 text-amber-300',
  council: 'bg-violet-600/20 text-violet-300',
  debug: 'bg-slate-800 text-slate-500',
};

type Props = {
  nodeId: string;
  status: WorkflowNodeStatus;
};

export function NodeExecutionLog({ nodeId, status }: Props) {
  const interventionRules = useDemoStore((s) => s.interventionRules);
  const confirmedCouncilOptionId = useDemoStore((s) => s.confirmedCouncilOptionId);
  const replay = useDemoStore(selectActiveReplay);

  const [open, setOpen] = useState(status === 'active');

  useEffect(() => {
    setOpen(status === 'active');
  }, [nodeId, status]);

  const { lines, duration, tokenUsage, emptyMessage } = useMemo(
    () => buildLogContent(nodeId, status, interventionRules, confirmedCouncilOptionId, replay),
    [nodeId, status, interventionRules, confirmedCouncilOptionId, replay],
  );

  const hasContent = lines.length > 0;

  return (
    <div className="rounded-lg border border-slate-800 bg-ink-900/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-ink-800/50"
      >
        <div className="flex items-center gap-1.5">
          <ScrollText className="h-3.5 w-3.5 text-slate-500" />
          <span className="text-[11px] font-semibold text-slate-300">节点执行日志</span>
          {hasContent && (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500">
              {lines.length} 条
            </span>
          )}
          {status === 'active' && <Loader2 className="h-3 w-3 animate-spin text-blue-400" />}
        </div>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-slate-500 transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div className="border-t border-slate-800/80 px-3 py-2.5">
          {!hasContent ? (
            <p className="text-xs text-slate-500">{emptyMessage}</p>
          ) : (
            <>
              {(duration || tokenUsage) && status !== 'active' && (
                <div className="mb-2 flex gap-3 text-[10px] text-slate-500">
                  {duration && duration !== '—' && (
                    <span>
                      耗时 <span className="text-slate-400">{duration}</span>
                    </span>
                  )}
                  {tokenUsage && tokenUsage !== '—' && (
                    <span>
                      Token <span className="text-slate-400">{tokenUsage}</span>
                    </span>
                  )}
                </div>
              )}

              {status === 'active' && (
                <div className="mb-2 flex items-center gap-1.5 text-[10px] text-blue-400">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  节点执行中…
                </div>
              )}

              <div className="max-h-52 space-y-1 overflow-y-auto font-mono text-[10px] leading-relaxed">
                {lines.map((line, i) => (
                  <LogLine
                    key={`${line.time}-${line.tag}-${i}`}
                    line={line}
                    isRunning={status === 'active' && i === lines.length - 1}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function LogLine({ line, isRunning }: { line: NodeExecLogLine; isRunning?: boolean }) {
  return (
    <div className={cn('flex gap-2 rounded px-1 py-0.5', isRunning && 'bg-blue-500/5')}>
      <span className="shrink-0 text-slate-600">{line.time}</span>
      <span
        className={cn(
          'shrink-0 rounded px-1 py-px text-[9px] font-semibold uppercase',
          tagStyles[line.level],
        )}
      >
        {line.tag}
      </span>
      <span className={cn('min-w-0', levelStyles[line.level])}>
        {line.message}
        {isRunning && <span className="ml-1 inline-block animate-pulse text-blue-400">▌</span>}
      </span>
    </div>
  );
}

function buildLogContent(
  nodeId: string,
  status: WorkflowNodeStatus,
  interventionRules: { text: string }[],
  confirmedCouncilOptionId: string | null,
  replay?: RunReplay,
): {
  lines: NodeExecLogLine[];
  duration?: string;
  tokenUsage?: string;
  emptyMessage: string;
} {
  // 执行子链节点 id 带派单后缀，剥去后复用同一执行段的日志；
  // 回放任务只用真实 run 的执行日志（不回落 mock，本次 run 无记录即为空）
  const baseId = stripExecSuffix(nodeId);
  const base = replay
    ? (replay.nodeExecLogs[nodeId] ?? replay.nodeExecLogs[baseId])
    : (nodeExecutionLogs[nodeId] ?? nodeExecutionLogs[baseId]);

  if (status === 'pending') {
    return {
      lines: [],
      emptyMessage: '节点尚未执行，暂无日志。',
    };
  }

  if (status === 'updated') {
    return {
      lines: buildUpdatedPendingLines(),
      emptyMessage: '节点尚未执行，暂无日志。',
    };
  }

  if (!base) {
    return {
      lines: [],
      emptyMessage: '暂无该节点的执行日志。',
    };
  }

  let lines = [...base.lines];

  if (baseId === 'n7-executing' && interventionRules.length > 0) {
    lines = [...lines, ...buildInterventionLogLines(interventionRules[0].text)];
  }

  if (baseId === 'n13-gate' || baseId === 'n15-merge-auth' || baseId === 'n18-run-complete') {
    if (interventionRules.length > 0 && status === 'done') {
      lines = [
        ...lines.slice(0, -1),
        {
          time: lines[lines.length - 1]?.time ?? '—',
          tag: 'INTERVENE',
          message: '执行时已应用用户介入规则',
          level: 'warning' as const,
        },
        ...(lines[lines.length - 1] ? [lines[lines.length - 1]] : []),
      ];
    }
  }

  if (baseId === 'n14-council' && confirmedCouncilOptionId) {
    lines = [
      ...lines.filter((l) => l.tag !== 'WAIT'),
      ...buildCouncilConfirmLogLines('Option A · Use RBAC'),
    ];
  }

  return {
    lines,
    duration: base.duration,
    tokenUsage: base.tokenUsage,
    emptyMessage: '节点尚未执行，暂无日志。',
  };
}
