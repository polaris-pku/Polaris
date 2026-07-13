import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { WorkflowNodeData } from '@/types';
import { elapsedSince, formatElapsed, useNow } from '@/lib/elapsed';
import { cn } from '@/lib/utils';

/**
 * 状态样式。**颜色只编码状态**，四个强调色之外没有第五种。
 *
 * 责任方 / 泳道 / 事件源那 6–9 色的色板已经删除 —— 它不是语义色，是装饰色：
 * 同一屏里紫色同时表示「议会」「council 级日志」「agent 事件源」三件事。
 * 泳道的区分现在只靠**位置 + 一条左缘灰线**（见 LaneNode）。
 *
 * R5：一个容器只用一种方式与背景区分。卡片选的是「描边 + 唯一的面板底色」，
 * 强调色只上到边框与状态灯上，不做面板底色（ok / danger 尤其不能当底色）。
 */
const statusStyles: Record<WorkflowNodeData['status'], { box: string; dot: string }> = {
  pending: { box: 'border-edge bg-surface-panel text-fg-muted', dot: 'bg-fg-faint' },
  active: {
    box: 'border-command bg-surface-panel text-fg-primary',
    dot: 'bg-command animate-pulse-ring',
  },
  done: { box: 'border-ok/40 bg-surface-panel text-fg-secondary', dot: 'bg-ok' },
  blocked: { box: 'border-danger/60 bg-surface-panel text-fg-primary', dot: 'bg-danger' },
  // 「已被介入」：介入在数据层保留，但 live run 上已没有入口（R4：后端收不到人类的决定）
  updated: { box: 'border-human/60 bg-surface-panel text-fg-primary', dot: 'bg-human' },
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
 *
 * 格式化走 `src/lib/elapsed.ts` —— 与主句（MissionLine）**同一套算法、同一个字面**，
 * 否则同一个 run 会在两个地方给出两个不一样的「多久了」。
 */
function Elapsed({ since }: { since: string }) {
  const now = useNow();
  return <span className="font-mono tabular-nums">{formatElapsed(elapsedSince(since, now))}</span>;
}

/**
 * 步骤卡。
 *
 * 表达顺序按「人想知道什么」排：**谁在做 → 多久 → 做了什么 → 关键事实**。
 * 不再有 N 编号 —— 节点编号是给协议作者看的，不是给用户看的（它们已移入帮助 › 协议参考）。
 *
 * 卡上**没有**原始事件的展开面板了：原始事件全应用只有一个出口 —— Dock 的事件流频道。
 * 点这张卡 = 选中这一步，右栏的「步骤」Fold 随之展开，L3 的入口在那个 Fold 的 D2 末尾。
 */
export function StepNode({ data }: NodeProps<Node<StepNodeData>>) {
  const { wf, selected, isNew } = data;
  const s = statusStyles[wf.status];
  return (
    <div
      className={cn(
        'relative w-[188px] cursor-pointer rounded-panel border px-3 py-3 transition-colors',
        s.box,
        selected && 'ring-2 ring-command/40',
        isNew && 'animate-fade-in',
      )}
    >
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      {/* 顶行：谁在做 · 多久了（进行中是实时秒表，闭合后是后端给的用时）· 状态灯 */}
      <div className="flex items-center justify-between gap-1.5">
        <span className="truncate text-body text-fg-muted" title={wf.owner}>
          {wf.owner}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {wf.status === 'active' && wf.spanStartedAt ? (
            <span className="text-meta text-fg-secondary">
              <Elapsed since={wf.spanStartedAt} />
            </span>
          ) : (
            wf.statusNote && (
              <span className="font-mono text-meta text-fg-muted">{wf.statusNote}</span>
            )
          )}
          <span className={cn('led h-1.5 w-1.5 shrink-0', s.dot)} />
        </div>
      </div>
      {/* 这一步是什么 */}
      <div className="mt-1 text-title text-fg-primary">{wf.labelCn}</div>
      {/* 关键事实（后端原文，扫一眼就知道发生了什么） */}
      {wf.summary && (
        <div className="mt-1 line-clamp-2 text-body text-fg-secondary" title={wf.summary}>
          {wf.summary}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  );
}

/**
 * 泳道底板。纵轴说的是**执行者**，不是仓库模块。
 *
 * 泳道**不着色**：一条 1.5px 的左缘灰线 + 位置，就够把「谁在做」分开了。
 * （原来这里是 9 个色相的责任方色板 —— 它把颜色这个通道彻底榨干了，
 * 于是「暖色 = 停下来，这里需要人」这条本该唯一没有例外的规则就没法成立。）
 */
export function LaneNode({
  data,
}: NodeProps<Node<{ label: string; lane: string; width: number }>>) {
  return (
    <div className="h-[116px] border-l-[1.5px] border-edge-strong" style={{ width: data.width }}>
      <div className="px-3 py-2 text-body text-fg-muted">{data.label}</div>
    </div>
  );
}
