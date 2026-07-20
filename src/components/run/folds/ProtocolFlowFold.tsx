import { Fold } from '@/components/ui/Fold';
import { activeProtocolNode, type ProtocolNode } from '@/lib/protocolFlow';
import { cn } from '@/lib/utils';

/** 节点状态点（与泳道图同一套语义：机器在动 / 完成 / 被拦 / 未到）。 */
const DOT: Record<ProtocolNode['status'], string> = {
  pending: 'bg-surface-raised',
  active: 'bg-command animate-pulse',
  done: 'bg-ok',
  blocked: 'bg-danger',
};

/**
 * 「协议流程」—— 后端主链路 N0–N18 的实时点亮图。
 *
 * 状态**完全由 RunEvent 时间线投影**（见 lib/protocolFlow.ts）：快照里的
 * `flow.active_node_code` 是硬编码占位，这里不读它。machine tier —— N 编号是
 * 后端同学的语言，默认折叠，报 bug / 对协议时才展开。
 */
export function ProtocolFlowFold({
  nodes,
  eventCount,
  onOpenEvidence,
}: {
  nodes: ProtocolNode[];
  eventCount: number;
  onOpenEvidence: () => void;
}) {
  const lit = nodes.filter((n) => n.status !== 'pending').length;
  const current = activeProtocolNode(nodes);

  return (
    <Fold
      id="fold-protocol-flow"
      title="协议流程"
      status={current?.status === 'blocked' ? 'danger' : 'idle'}
      tier="machine"
      fact={current ? `${current.code} · ${current.labelCn}` : undefined}
      meta={`${String(lit)}/19`}
      evidence={{ count: eventCount, onOpen: onOpenEvidence }}
    >
      <ul className="flex flex-col">
        {nodes.map((node) => (
          <li key={node.code} className="flex items-baseline gap-2 px-1 py-0.5">
            <span
              className={cn('h-1.5 w-1.5 shrink-0 self-center rounded-full', DOT[node.status])}
            />
            <span className="w-8 shrink-0 font-mono text-code text-fg-faint">{node.code}</span>
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-body',
                node.status === 'pending'
                  ? node.reachable
                    ? 'text-fg-muted'
                    : 'text-fg-faint'
                  : 'text-fg-secondary',
              )}
            >
              {node.labelCn}
            </span>
            <span className="shrink-0 text-meta text-fg-faint">
              {node.time ?? (node.reachable ? '' : '无事件')}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-body text-fg-muted">
        由后端事件流实时点亮。灰暗的节点在今天的后端上没有对应事件，不会点亮。
      </p>
    </Fold>
  );
}
