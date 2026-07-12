import { useEffect, useState } from 'react';
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
  // 事件驱动图的泳道（= event.source）
  Memory: 'border-l-sky-500/60', // B · 角色记忆
  Driver: 'border-l-emerald-500/60', // A · 执行运行时
  Agent: 'border-l-teal-500/60', // agent 角色（无 role_id 时的兜底）
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

/**
 * 未闭合跨度节点的实时计时。
 *
 * agent 执行那十几秒里后端**一个事件都不发** —— 没有这个计时器，界面在最关键的那段时间
 * 完全是死的，用户会以为卡住了。这里按秒自走，数据源是后端给的开始时刻，不是编的。
 */
function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, (now - new Date(since).getTime()) / 1000);
  return <span className="font-mono tabular-nums">{seconds.toFixed(0)}s</span>;
}

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
      {/* 顶行：节点编号（安静）+ 进行中计时 + 状态灯 */}
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] font-medium tracking-[0.14em] opacity-45">
          {wf.code}
        </span>
        <div className="flex items-center gap-1.5">
          {wf.spanStartedAt && wf.status === 'active' && (
            <span className="text-[10px] opacity-70">
              <Elapsed since={wf.spanStartedAt} />
            </span>
          )}
          <span className={cn('led h-1.5 w-1.5 shrink-0', s.dot)} />
        </div>
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

export type PhaseNodeData = {
  phase: string;
  label: string;
  labelCn: string;
  done: number;
  total: number;
  status: WorkflowNodeData['status'];
};

/**
 * 折叠态的**阶段卡**：一整段（受理 / 执行 / 评审 / 交付）收成一张卡。
 *
 * 存在的理由：18 个节点一次性铺开信息量过载，真实 run 里更是被后端一次性推出来的。
 * 折叠后任何时刻只有 agent 正在做的那个阶段是展开的，其余是四张带进度的卡。
 * 点击展开。
 */
function PhaseNode({ data }: NodeProps<Node<PhaseNodeData>>) {
  // 部分完成不能显示成「未开始」的灰色 —— 有些节点后端本就不发事件（如 N1 分诊，
  // 当前后端没有这个步骤），它们永远是 pending。若照搬聚合状态，跑完的阶段仍然一片灰，
  // 看起来像出错。所以：只要有节点完成过，卡片就走「已推进」的绿色，进度条如实显示 2/4。
  const partial = data.status === 'pending' && data.done > 0;
  const s = partial ? statusStyles.done : statusStyles[data.status];
  const pct = data.total > 0 ? (data.done / data.total) * 100 : 0;
  return (
    <div
      title={
        `${data.labelCn} · ${data.done}/${data.total} 已完成（点击展开）` +
        (partial ? '\n未完成的节点：当前后端未就该节点发出事件' : '')
      }
      className={cn(
        'w-[150px] cursor-pointer rounded-md border px-2.5 py-2 transition-all hover:brightness-125',
        s.box,
      )}
    >
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <div className="flex items-center gap-1.5">
        <span className={cn('led h-1.5 w-1.5 shrink-0', s.dot)} />
        <span className="callsign text-[9px]">{data.labelCn}</span>
        <span className="ml-auto font-mono text-[9px] opacity-70">
          {data.done}/{data.total}
        </span>
      </div>
      {/* 进度条：一眼看出这段跑到哪了，不用展开 */}
      <div className="mt-1.5 h-0.5 w-full overflow-hidden rounded-full bg-black/30">
        <div className={cn('h-full transition-all', s.dot)} style={{ width: `${String(pct)}%` }} />
      </div>
      <div className="mt-1 text-[8px] opacity-50">▸ 点击展开</div>
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

/** React Flow 自定义节点注册表：step 大卡片 / chip 折叠胶囊 / phase 折叠阶段卡 / lane 泳道底板 */
export const nodeTypes = {
  step: StepNode,
  chip: ChipNode,
  phase: PhaseNode,
  lane: LaneNode,
};
