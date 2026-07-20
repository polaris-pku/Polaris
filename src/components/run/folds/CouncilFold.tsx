import { Fold, type FoldStatus } from '@/components/ui/Fold';
import { KeyValue, KeyValueList } from '@/components/ui/KeyValue';
import { roleName } from '@/lib/roleNames';
import type { CouncilFacts } from '@/lib/runFacts';

/** 后端 council 状态 → Fold 状态点。未知词不猜，落 idle。 */
const FOLD_STATUS: Record<string, FoldStatus> = {
  running: 'running',
  completed: 'ok',
  failed: 'danger',
};

/**
 * 「议会」—— council 模式下 proposer / reviewer / synthesizer 的裁决过程。
 *
 * 只在**后端真的发过 council 事件**（或快照带 council 段）时出现 —— 单 agent run 里
 * 没有这一条（事实不存在就不占布局）。D1 一句裁决结论；D2 是决议字段 + 各角色的
 * 提案 / 评审 / 综合记录。全部取自事件 payload 与快照原文，不叙事化。
 */
export function CouncilFold({
  facts,
  eventCount,
  onOpenEvidence,
  onOpenBoard,
}: {
  facts: CouncilFacts;
  eventCount: number;
  onOpenEvidence: () => void;
  /** 打开合议观察面板（提案正文 / 评审意见 / 裁决全景） */
  onOpenBoard: () => void;
}) {
  const copyAll = () => {
    void navigator.clipboard?.writeText(JSON.stringify(facts, null, 2));
  };

  const fact =
    [
      facts.verdict && `裁决 ${facts.verdict}`,
      facts.proposalCount > 0 && `提案 ${String(facts.proposalCount)}`,
      facts.reviewCount > 0 && `评审 ${String(facts.reviewCount)}`,
      facts.failedCode && `失败 ${facts.failedCode}`,
    ]
      .filter(Boolean)
      .join(' · ') || '议会进行中';

  return (
    <Fold
      id="fold-council"
      title="议会"
      status={FOLD_STATUS[facts.status] ?? 'idle'}
      fact={fact}
      evidence={{ count: eventCount, onOpen: onOpenEvidence }}
    >
      <KeyValueList onCopyAll={copyAll}>
        {facts.verdict && <KeyValue k="裁决" v={facts.verdict} />}
        {facts.decisionMode && <KeyValue k="决策方式" v={facts.decisionMode} mono />}
        {facts.selectedProposalId && <KeyValue k="选中提案" v={facts.selectedProposalId} mono />}
        {facts.roles.map((role, i) => (
          <KeyValue
            key={`${role.kind}-${String(i)}`}
            k={role.kind}
            v={[roleName(role.roleId), role.refId].filter(Boolean).join(' · ')}
            mono
          />
        ))}
        {facts.synthesisDone && <KeyValue k="综合" v="已完成" />}
        {facts.failedCode && <KeyValue k="失败码" v={facts.failedCode} mono />}
        {facts.blockedBy.map((item, i) => (
          <KeyValue key={item} k={i === 0 ? '阻塞项' : ''} v={item} />
        ))}
        {facts.requiredNextActions.map((action, i) => (
          <KeyValue key={action} k={i === 0 ? '后续动作' : ''} v={action} />
        ))}
      </KeyValueList>
      <button
        type="button"
        onClick={onOpenBoard}
        className="mt-1 rounded-chip px-1 py-0.5 text-body text-command-soft transition-colors hover:bg-surface-raised"
      >
        打开合议面板 →
      </button>
    </Fold>
  );
}
