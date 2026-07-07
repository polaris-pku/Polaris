import { useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  FolderCog,
  HardDriveDownload,
  Loader2,
  XCircle,
} from 'lucide-react';
import { selectActiveReplay, useDemoStore } from '@/store/useDemoStore';
import { fileOpsForNode } from '@/data/fileops';
import { revealAgentFile } from '@/lib/agentFs';
import { cn } from '@/lib/utils';
import type { FileOpIntent, FileOpObservation, GateDecision } from '@/api/types';
import type { WorkflowNodeStatus } from '@/types';

/**
 * N7 · 文件操作观测面板（方向 E）。
 *
 * 把 Agent 开发过程中的文件读/写/建流水渲染成一条带凭证的时间线：
 * ACP 方法（A）+ 租约（C）+ Gate 判定（D）+ 产物（C），全部为后端既成事实。
 * 唯一的交互是接住写入前的权限请求（A 的 session/request_permission）——
 * 人机确认时刻按设计语言走暖琥珀色，选择结果经 resolveFilePermission 回传。
 * 获准的写操作由桌面壳代 A 落盘到本机工作区，回执（WriteReceipt）随条目展示。
 */

const intentChips: Record<FileOpIntent, { label: string; className: string }> = {
  read: { label: '读取', className: 'bg-slate-700/60 text-slate-300' },
  list: { label: '列目录', className: 'bg-slate-700/60 text-slate-300' },
  write: { label: '写入', className: 'bg-command/15 text-command-soft' },
  create: { label: '创建', className: 'bg-command/15 text-command-soft' },
};

const gateChips: Record<GateDecision, string> = {
  allow: 'bg-emerald-600/15 text-emerald-300',
  deny: 'bg-rose-600/15 text-rose-300',
  ask: 'bg-amber-600/15 text-amber-300',
  defer: 'bg-violet-600/15 text-violet-300',
};

function StatusIcon({ status }: { status: FileOpObservation['status'] }) {
  if (status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />;
  if (status === 'failed') return <XCircle className="h-3.5 w-3.5 text-rose-400" />;
  if (status === 'in_progress')
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />;
  return <CircleDashed className="h-3.5 w-3.5 text-amber-400" />;
}

/** 落盘回执：agent 生成内容真正写入本机工作区的结果（机器行为，走冷色遥测）。 */
function WriteReceipt({ op }: { op: FileOpObservation }) {
  const result = useDemoStore((s) => s.agentFileWrites[op.tool_event_id]);
  if (!result) return null;

  if (result.status === 'pending') {
    return (
      <div className="mt-1 flex items-center gap-1.5 font-mono text-[9px] text-slate-500">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>写入工作区…</span>
      </div>
    );
  }
  if (result.status === 'written') {
    return (
      <div className="mt-1 flex min-w-0 items-center gap-1.5 font-mono text-[9px] text-emerald-400/90">
        <HardDriveDownload className="h-3 w-3 shrink-0" />
        <span className="shrink-0">已写入</span>
        <button
          type="button"
          title="在文件管理器中定位"
          onClick={() => revealAgentFile(result.absPath)}
          className="min-w-0 truncate text-left text-emerald-300/70 underline decoration-emerald-300/30 underline-offset-2 transition-colors hover:text-emerald-200"
        >
          {result.absPath}
        </button>
      </div>
    );
  }
  if (result.status === 'failed') {
    return (
      <div className="mt-1 font-mono text-[9px] text-rose-400/90">落盘失败 · {result.error}</div>
    );
  }
  return <div className="mt-1 font-mono text-[9px] text-slate-600">未落盘 · {result.reason}</div>;
}

function PermissionPrompt({ op }: { op: FileOpObservation }) {
  const resolveFilePermission = useDemoStore((s) => s.resolveFilePermission);
  if (!op.permission) return null;

  // 已确认：显示人选结果（既成事实，只读）
  if (op.permission_outcome) {
    const chosen = op.permission.options.find(
      (o) => o.optionId === op.permission_outcome?.optionId,
    );
    return (
      <div className="mt-1.5 rounded border border-human/20 bg-human/5 px-2.5 py-1.5 text-[10px]">
        <span className="callsign text-[8px] text-human/80">HUMAN CONFIRMED</span>
        <span className="ml-2 text-slate-300">
          {op.permission_outcome.outcome === 'cancelled'
            ? '已取消'
            : (chosen?.name ?? op.permission_outcome.optionId)}
        </span>
      </div>
    );
  }

  // 待确认：暖琥珀色人机确认块（写入被挂起，等待人的选择）
  return (
    <div className="mt-1.5 rounded border border-human/40 bg-human/10 px-2.5 py-2">
      <div className="callsign text-[8px] text-human">PERMISSION REQUEST · 写入前确认</div>
      <div className="mt-1 text-[11px] font-medium text-amber-100">{op.permission.title}</div>
      {op.permission.message && (
        <p className="mt-0.5 text-[10px] leading-relaxed text-amber-100/70">
          {op.permission.message}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {op.permission.options.map((option) => (
          <button
            key={option.optionId}
            type="button"
            onClick={() =>
              resolveFilePermission(op.tool_event_id, {
                outcome: 'selected',
                optionId: option.optionId,
              })
            }
            className={cn(
              'rounded border px-2 py-1 text-[10px] transition-colors',
              option.optionId === 'reject'
                ? 'border-rose-500/40 text-rose-300 hover:bg-rose-500/10'
                : 'border-human/50 text-amber-100 hover:bg-human/20',
            )}
          >
            {option.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function OpRow({ op }: { op: FileOpObservation }) {
  return (
    <div className="rounded-md border border-slate-800/80 bg-ink-900/60 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <StatusIcon status={op.status} />
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[9px] font-medium',
            intentChips[op.intent].className,
          )}
        >
          {intentChips[op.intent].label}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-200">
          {op.path}
        </span>
        {op.gate_decision && (
          <span className={cn('rounded px-1.5 py-0.5 text-[9px]', gateChips[op.gate_decision])}>
            gate:{op.gate_decision}
          </span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-[22px] font-mono text-[9px] text-slate-500">
        <span>{op.method}</span>
        <span>scope:{op.required_scope}</span>
        {op.lease_id && <span className="text-slate-400">{op.lease_id}</span>}
        {op.artifact_ref && (
          <span className="text-emerald-400/80">
            {op.artifact_ref.type}:{op.artifact_ref.artifact_id}
          </span>
        )}
      </div>
      <p className="mt-0.5 pl-[22px] text-[10px] text-slate-400">{op.summary}</p>
      <div className="pl-[22px]">
        <WriteReceipt op={op} />
        <PermissionPrompt op={op} />
      </div>
    </div>
  );
}

type Props = {
  nodeId: string;
  status: WorkflowNodeStatus;
};

export function FileOpsPanel({ nodeId, status }: Props) {
  const filePermissionOutcomes = useDemoStore((s) => s.filePermissionOutcomes);
  const replay = useDemoStore(selectActiveReplay);
  const [open, setOpen] = useState(true);

  // 节点尚未执行到（pending）不展示；无剧本的节点直接不渲染。
  // 回放任务用真实 run 的观测流整体替换 mock 剧本。
  const ops =
    status === 'pending'
      ? []
      : fileOpsForNode(nodeId, filePermissionOutcomes ?? {}, replay?.nodeFileOps);
  if (ops.length === 0) return null;

  const awaiting = ops.filter((o) => o.permission && !o.permission_outcome).length;

  return (
    <div className="rounded-lg border border-slate-800 bg-ink-900/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-ink-800/50"
      >
        <div className="flex items-center gap-1.5">
          <FolderCog className="h-3.5 w-3.5 text-slate-500" />
          <span className="text-[11px] font-semibold text-slate-300">文件操作 · FILE OPS</span>
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500">
            {ops.length} 条
          </span>
          {awaiting > 0 && (
            <span className="rounded bg-human/15 px-1.5 py-0.5 text-[10px] text-human">
              {awaiting} 待确认
            </span>
          )}
        </div>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-slate-500 transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div className="space-y-1.5 border-t border-slate-800/80 px-3 py-2.5">
          {ops.map((op) => (
            <OpRow key={op.tool_event_id} op={op} />
          ))}
          <p className="pt-0.5 text-[9px] leading-relaxed text-slate-600">
            观测视图：文件读写由 Driver（A）执行，租约（C）与 Gate（D）为后端既成事实；
            此处确认写入权限，获准的写操作由桌面壳代 A 落盘到本机工作区。
          </p>
        </div>
      )}
    </div>
  );
}
