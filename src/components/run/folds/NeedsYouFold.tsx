import { Fold } from '@/components/ui/Fold';
import { KeyValue, KeyValueList } from '@/components/ui/KeyValue';
import type { GateFact } from '@/lib/runFacts';

/**
 * ③「需要你」—— Gate 判定 ask / defer。**human 色，默认展开，只告知 + 复制，一个按钮都没有。**
 *
 * 【R4】后端**没有人类回写通道**：`can_create_merge_authorization` 恒为 false，也没有 `gate.respond`
 * 这个 RPC。一个「同意 / 拒绝」按钮在这里只会改本地状态，永远送不到后端 ——
 * 让用户以为自己影响了 agent，比一个明显的死按钮更糟。
 * 所以我们只把「后端要什么」原样告诉他，并让他能一键复制走（贴进 issue / 贴给同事）。
 */
export function NeedsYouFold({
  gate,
  eventCount,
  onOpenEvidence,
}: {
  gate: GateFact;
  eventCount: number;
  onOpenEvidence: () => void;
}) {
  const copyAll = () => {
    void navigator.clipboard?.writeText(JSON.stringify(gate, null, 2));
  };

  return (
    <Fold
      id="fold-needs-you"
      title="需要你"
      status="human"
      fact={gate.reason || '后端要求人工确认'}
      defaultOpen
      evidence={{ count: eventCount, onOpen: onOpenEvidence }}
    >
      <KeyValueList onCopyAll={copyAll}>
        {gate.reason && <KeyValue k="原因" v={gate.reason} />}
        {gate.requiredActions.map((action, i) => (
          <KeyValue key={action} k={i === 0 ? '需要做' : ''} v={action} />
        ))}
        {/* 协议原文只作 D2 的灰色注解（F2） */}
        <KeyValue k="Gate" v={gate.decision} mono />
        {gate.gateId && <KeyValue k="检查项" v={gate.gateId} mono />}
        {gate.phase && <KeyValue k="阶段" v={gate.phase} mono />}
        {gate.targetState && <KeyValue k="目标态" v={gate.targetState} mono />}
      </KeyValueList>
      <p className="mt-1 text-body text-fg-muted">
        这一步只能在后端侧放行，Polaris 里没有能把你的决定送回去的通道 —— 所以这里不给按钮。
      </p>
    </Fold>
  );
}
