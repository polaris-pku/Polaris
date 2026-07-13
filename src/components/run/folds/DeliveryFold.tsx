import { Button } from '@/components/ui/Button';
import { Fold } from '@/components/ui/Fold';
import { KeyValue, KeyValueList } from '@/components/ui/KeyValue';

export type DeliveryFacts = {
  /** 后端 worktree 的绝对路径（快照给了才有） */
  worktreePath: string;
  fileCount: number;
  artifactsMaterialized: number;
};

/**
 * ④「交付」—— 只在 run 完成时出现。
 *
 * 相对旧的 `DeliveryReport`，这里删掉了：
 *  - 3 个**无 onClick** 的死按钮（`View Diff` / `Accept Changes` / `Request Revision`）—— R4：
 *    一个控件如果无法把用户的决定送达后端，它就不存在；
 *  - 「测试结果 0 / 0 / —」—— R2：后端没有测试数据，渲染它就是在撒谎。
 * 留下的只有后端真给了的三条事实，外加那个**真的有用**的出口：再提一个需求。
 */
export function DeliveryFold({
  facts,
  eventCount,
  onOpenEvidence,
  onNewRequirement,
}: {
  facts: DeliveryFacts;
  eventCount: number;
  onOpenEvidence: () => void;
  onNewRequirement: () => void;
}) {
  return (
    <Fold
      id="fold-delivery"
      title="交付"
      status="ok"
      fact="已交付"
      evidence={{ count: eventCount, onOpen: onOpenEvidence }}
    >
      <KeyValueList>
        <KeyValue k="文件" v={`${String(facts.fileCount)} 个`} />
        <KeyValue k="落盘产物" v={`${String(facts.artifactsMaterialized)} 个`} />
        {facts.worktreePath && <KeyValue k="工作树" v={facts.worktreePath} mono copyable />}
      </KeyValueList>
      <div className="mt-2">
        <Button variant="secondary" size="sm" onClick={onNewRequirement}>
          新建需求
        </Button>
      </div>
    </Fold>
  );
}
