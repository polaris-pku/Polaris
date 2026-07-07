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
  return (
    <div
      className={cn(
        'w-[188px] rounded-lg border px-3.5 py-3 transition-all cursor-pointer',
        s.box,
        selected && 'ring-2 ring-white/40',
        isNew && 'animate-fade-in',
      )}
    >
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      {/* 顶行：节点编号（安静）+ 状态灯 */}
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] font-medium tracking-[0.14em] opacity-45">
          {wf.code}
        </span>
        <span className={cn('led h-1.5 w-1.5 shrink-0', s.dot)} />
      </div>
      {/* 标题 + 中文名（颜色随状态，构成一张统一色调的卡） */}
      <div className="mt-2 font-display text-[15px] font-semibold leading-tight">{wf.label}</div>
      <div className="mt-0.5 truncate text-[11px] opacity-60">{wf.labelCn}</div>
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
