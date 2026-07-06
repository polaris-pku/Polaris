import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { WorkflowNodeData } from '@/types';
import { cn } from '@/lib/utils';

/** 泳道左缘的责任色条 */
export const laneAccent: Record<string, string> = {
  User: 'border-l-human/70', // the human's own lane glows warm
  System: 'border-l-command/70', // 调度 / 协调 — command azure
  Backend: 'border-l-sky-500/60', // 后端 Agent
  Test: 'border-l-teal-500/60', // 测试 Agent
  Security: 'border-l-indigo-500/60', // 安全 / Gate
  Council: 'border-l-violet-500/60',
};

// 责任方角标配色（A/B/C/D/User/Merger）
const directionStyles: Record<string, string> = {
  User: 'bg-human/15 text-human-soft',
  A: 'bg-sky-500/15 text-sky-300',
  B: 'bg-teal-500/15 text-teal-300',
  C: 'bg-command/15 text-command-soft',
  D: 'bg-indigo-500/15 text-indigo-300',
  Merger: 'bg-emerald-500/15 text-emerald-300',
};

const statusStyles: Record<
  WorkflowNodeData['status'],
  { box: string; dot: string; label: string }
> = {
  pending: {
    box: 'border-line-bright bg-ink-850 text-slate-400',
    dot: 'bg-slate-600',
    label: '待执行',
  },
  active: {
    box: 'border-command bg-command/15 text-slate-100 shadow-glow',
    dot: 'bg-command animate-pulse-ring',
    label: '执行中',
  },
  done: {
    box: 'border-emerald-500/60 bg-emerald-600/10 text-emerald-100',
    dot: 'bg-emerald-400',
    label: '已完成',
  },
  blocked: {
    box: 'border-rose-500/70 bg-rose-600/10 text-rose-100',
    dot: 'bg-rose-400',
    label: '已阻塞',
  },
  updated: {
    box: 'border-dashed border-human/70 bg-human/10 text-human-soft shadow-glow-human',
    dot: 'bg-human',
    label: '已被介入',
  },
};

export type StepNodeData = {
  wf: WorkflowNodeData;
  selected: boolean;
  isNew?: boolean;
};

function StepNode({ data }: NodeProps<Node<StepNodeData>>) {
  const { wf, selected, isNew } = data;
  const s = statusStyles[wf.status];
  // 节点上展示的状态码：优先 canonical TaskStatus，否则用 statusNote 占位
  const statusCode = wf.taskStatus ?? wf.statusNote ?? '—';
  return (
    <div
      className={cn(
        'w-[182px] rounded-md border px-3 py-2.5 transition-all cursor-pointer',
        s.box,
        selected && 'ring-2 ring-white/40',
        isNew && 'animate-fade-in',
      )}
    >
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <div className="flex items-center justify-between gap-1">
        <span className="flex items-center gap-1">
          <span className="font-mono text-[9px] font-semibold text-slate-300">{wf.code}</span>
          <span
            className={cn(
              'rounded px-1 py-px font-mono text-[8px] font-semibold',
              directionStyles[wf.direction] ?? 'bg-slate-700/40 text-slate-400',
            )}
          >
            {wf.direction}
          </span>
          {/* 人的时刻标记（tier=human）：琥珀菱形，与介入/确认的暖色语义一致 */}
          {wf.tier === 'human' && <span className="text-[8px] leading-none text-human">◆</span>}
        </span>
        <span className={cn('led h-2 w-2', s.dot)} />
      </div>
      <div className="mt-1 font-display text-[13px] font-semibold leading-tight">{wf.label}</div>
      <div className="truncate text-[10px] text-slate-400">{wf.labelCn}</div>
      <div className="mt-1.5 truncate font-mono text-[9px] text-slate-500">{statusCode}</div>
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  );
}

/**
 * 机器节点的折叠态：小胶囊（状态点 + 节点编号）。
 * 点击仍可选中（Inspector 照常工作）并展开为大卡片；title 提供悬停释义。
 */
function ChipNode({ data }: NodeProps<Node<StepNodeData>>) {
  const { wf, selected, isNew } = data;
  const s = statusStyles[wf.status];
  return (
    <div
      title={`${wf.code} ${wf.label} · ${wf.labelCn}（${wf.owner}）`}
      className={cn(
        'flex w-[76px] cursor-pointer items-center justify-center gap-1.5 rounded-full border px-2 py-1 transition-all',
        s.box,
        selected && 'ring-2 ring-white/40',
        isNew && 'animate-fade-in',
      )}
    >
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <span className={cn('led h-1.5 w-1.5 shrink-0', s.dot)} />
      <span className="font-mono text-[9px] font-semibold">{wf.code}</span>
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  );
}

function LaneNode({ data }: NodeProps<Node<{ label: string; lane: string; width: number }>>) {
  return (
    <div
      className={cn(
        'h-[116px] rounded-r-md border-l-[3px] bg-ink-900/30',
        laneAccent[data.lane] ?? 'border-l-slate-600',
      )}
      style={{ width: data.width }}
    >
      <div className="callsign px-3 py-2 text-[10px] text-slate-400">{data.label}</div>
    </div>
  );
}

/** React Flow 自定义节点注册表：step 大卡片 / chip 折叠胶囊 / lane 泳道底板 */
export const nodeTypes = {
  step: StepNode,
  chip: ChipNode,
  lane: LaneNode,
};
