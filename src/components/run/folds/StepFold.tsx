import { Fold, type FoldStatus } from '@/components/ui/Fold';
import { KeyValue, KeyValueList } from '@/components/ui/KeyValue';
import { PHASE_LABEL } from '@/lib/glossary';
import { stepOwnerOf } from '@/lib/runFacts';
import type { RunEvent } from '@/api/types/rpc';
import type { WorkflowNodeData, WorkflowNodeStatus } from '@/types';

const STATUS: Record<WorkflowNodeStatus, FoldStatus> = {
  pending: 'idle',
  active: 'running',
  updated: 'running',
  done: 'ok',
  blocked: 'danger',
};

/**
 * ①「步骤」—— 当前（或用户选中）的那一步。
 *
 * 它取代了「三处同源」的步骤详情：NodeInspector + 节点卡浮层 + NodeExecutionLog。**这里是唯一一份。**
 *
 * D2 里**没有实时秒表**：全屏唯一每秒都在变的字是主句（§3.1）。跨度闭合后才显示后端算出的真实用时
 * （`statusNote`，由 eventGraph 从 requested→completed 的间隔算出）。
 */
export function StepFold({
  node,
  events,
  onOpenEvidence,
}: {
  node: WorkflowNodeData;
  events: RunEvent[];
  onOpenEvidence: (stepId: string) => void;
}) {
  const owner = stepOwnerOf(node, events);
  const duration = node.statusNote;

  return (
    <Fold
      id="fold-step"
      title="步骤"
      status={STATUS[node.status]}
      fact={node.labelCn}
      meta={duration}
      tier={node.tier}
      evidence={{
        count: events.length,
        onOpen: () => {
          onOpenEvidence(node.id);
        },
      }}
    >
      <KeyValueList>
        <KeyValue k="执行者" v={owner} />
        {node.phase && <KeyValue k="阶段" v={PHASE_LABEL[node.phase]} />}
        {duration ? (
          <KeyValue k="用时" v={duration} />
        ) : (
          node.status === 'active' && <KeyValue k="用时" v="进行中" />
        )}
        {/* summary 是 eventGraph 从 payload 里挑出来的那一行关键事实（已经是人话） */}
        {node.summary && <KeyValue k="关键事实" v={node.summary} />}
      </KeyValueList>
    </Fold>
  );
}
