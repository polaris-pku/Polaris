/**
 * 步骤轨 —— 运行屏的**默认视图**。
 *
 * 为什么它取代了 xyflow 画布：事件图的 `deps` 是**线性链**（`groups[index-1]`）——
 * 真实 run 的「图」其实是**一条直线**。用一个图渲染器画直线，还占掉 700px 的舞台，
 * 是把最贵的像素花在一个没有分叉的结构上。画布保留，只在多 agent 扇出（lane 数 > 2）时才回来。
 *
 * 一排卡，**只高亮当前步**。卡上按「人想知道什么」的顺序排：谁在做 → 做什么 → 多久。
 */
import type { WorkflowNodeData } from '@/types';
import { formatElapsed, elapsedSince, useNow } from '@/lib/elapsed';
import { stepOwnerOf } from '@/lib/missionLine';
import { cn } from '@/lib/utils';

export function StepRail({
  nodes,
  activeId,
  onSelect,
}: {
  nodes: WorkflowNodeData[];
  activeId: string | null;
  onSelect: (nodeId: string) => void;
}) {
  // 有未闭合的跨度才起秒表 —— 全跑完了还每秒重渲染，是白烧电。
  const ticking = nodes.some((n) => !!n.spanStartedAt && n.status === 'active');
  const now = useNow(1000, ticking);

  return (
    <ol className="flex items-stretch gap-2 overflow-x-auto px-1 py-2">
      {nodes.map((node, index) => (
        // items-stretch：所有卡等高（取最高的那张）。用固定高会在中文摘要换行时把字裁掉一半。
        <li key={node.id} className="flex items-stretch gap-2">
          {index > 0 && (
            <span aria-hidden className="self-center shrink-0 text-body text-fg-faint">
              →
            </span>
          )}
          <StepCard
            node={node}
            selected={node.id === activeId}
            now={now}
            onSelect={() => {
              onSelect(node.id);
            }}
          />
        </li>
      ))}
    </ol>
  );
}

const STATUS_DOT: Record<WorkflowNodeData['status'], string> = {
  pending: 'border border-fg-faint',
  active: 'bg-command led animate-pulse-ring',
  done: 'bg-ok',
  blocked: 'bg-human',
  updated: 'bg-command',
};

function StepCard({
  node,
  selected,
  now,
  onSelect,
}: {
  node: WorkflowNodeData;
  selected: boolean;
  now: number;
  onSelect: () => void;
}) {
  // 未闭合跨度 → 实时秒表（agent 干活那十几秒里后端一个事件都不发，没有它这张卡是死的）；
  // 已闭合 → 后端给的真实耗时（statusNote）。
  const elapsed = node.spanStartedAt
    ? formatElapsed(elapsedSince(node.spanStartedAt, now))
    : (node.statusNote ?? '');

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={node.status === 'active' ? 'step' : undefined}
      className={cn(
        // 高度自适应（min-h 保底，靠 li 的 items-stretch 拉齐）：
        // 原先是死高 104px，而一张卡实际要 ~134px（标题24 + 执行者22 + 摘要两行44 + 耗时16 + 间距内边距28）——
        // 中文摘要一换行就从卡底漏出去、被拦腰切断。overflow-hidden 是兜底：任何内容都不许再越过边框。
        'flex min-h-[104px] w-[168px] shrink-0 flex-col gap-1 overflow-hidden rounded-panel border bg-surface-panel px-3 py-2 text-left transition-colors',
        selected ? 'border-command' : 'border-edge hover:border-edge-strong',
        // 只高亮当前步：一屏之内只允许有一个「正在发生」。
        node.status === 'active' && 'ring-2 ring-edge-focus',
      )}
    >
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden
          className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[node.status])}
        />
        <span className="truncate text-title text-fg-primary">{node.labelCn}</span>
      </div>
      <div className="truncate text-body text-fg-muted">{stepOwnerOf(node)}</div>
      <p className="line-clamp-2 flex-1 text-body text-fg-secondary">{node.summary}</p>
      {elapsed && <span className="tabular text-meta text-fg-muted">{elapsed}</span>}
    </button>
  );
}
