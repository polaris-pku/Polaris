import { Fold } from '@/components/ui/Fold';
import type { RunEvent } from '@/api/types/rpc';
import type { WorkflowNodeData } from '@/types';

/**
 * ⑤「机器握手 · {n} 步」—— `tier==='machine'` 的步骤**聚合成一个，永不单独成 Fold**。
 *
 * 建 Run / ContextPack / mailbox 握手这些是 A/B/C/D 之间的内部对话：它们发生了，但它们不是
 * 「我的需求跑得怎么样」的答案。给它们每人一个 Fold，右栏就又变回一列噪声。
 *
 * D2 里每一步各自可以下钻到自己的事件（↗）；Fold 底部那一行 L3 入口（由 Fold 自己渲染）
 * 打开的是**未过滤**的事件流 —— 因为「过滤到某一步」只能过滤到一步，而这里有 n 步：
 * 与其挑一步假装代表全部，不如老实打开全部。计数仍然是这 n 步背后的真实事件条数。
 */
export function MachineHandshakeFold({
  nodes,
  eventsByNodeId,
  onOpenEvidence,
  onOpenAllEvidence,
}: {
  nodes: WorkflowNodeData[];
  eventsByNodeId: Record<string, RunEvent[]>;
  onOpenEvidence: (stepId: string) => void;
  onOpenAllEvidence: () => void;
}) {
  const total = nodes.reduce((n, node) => n + (eventsByNodeId[node.id]?.length ?? 0), 0);

  return (
    <Fold
      id="fold-machine"
      title={`机器握手 · ${String(nodes.length)} 步`}
      status="idle"
      tier="machine"
      evidence={{ count: total, onOpen: onOpenAllEvidence }}
    >
      <ul className="flex flex-col">
        {nodes.map((node) => {
          const count = eventsByNodeId[node.id]?.length ?? 0;
          return (
            <li key={node.id}>
              <button
                type="button"
                onClick={() => {
                  onOpenEvidence(node.id);
                }}
                className="flex w-full items-baseline gap-2 rounded-chip px-1 py-1 text-left transition-colors hover:bg-surface-panel"
              >
                <span className="shrink-0 text-body text-fg-secondary">{node.labelCn}</span>
                <span className="min-w-0 flex-1 truncate text-body text-fg-muted">
                  {node.summary}
                </span>
                <span className="tabular shrink-0 text-meta text-fg-faint">{count} ↗</span>
              </button>
            </li>
          );
        })}
      </ul>
    </Fold>
  );
}
