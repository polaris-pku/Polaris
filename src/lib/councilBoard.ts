/**
 * 合议面板的数据模型 —— **事件流先行，终态快照补全**。
 *
 * 运行中只有 council.* 事件（谁提了案 / 谁评审了 / 综合完成没有），提案正文要等
 * 终态快照的 `snapshot.council.proposals[]`（summary / affected_paths / known_risks…）。
 * 两份数据按 proposal_id 合并；快照到达前对应字段留空 —— 不虚构占位。
 *
 * 铁律同 liveReplay：后端给什么展示什么。裁决由后端 agent 自主完成，
 * 本模型只呈现结果，不承载任何「送回后端」的交互。
 */
import type { RunEvent, RunSnapshot } from '@/api/types/rpc';

const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : [];

export type CouncilReviewCard = {
  reviewId: string;
  proposalId: string;
  /** 后端原文 approve / reject / needs_revision；空串 = 快照未到 */
  verdict: string;
  reason: string;
};

export type CouncilProposalCard = {
  proposalId: string;
  /** 事件里的真实长期 role_id；Council seat 只由 kind 表示，不创建伪角色。 */
  roleId: string;
  /** 以下正文字段来自终态快照；运行中为空 */
  summary: string;
  affectedPaths: string[];
  assumptions: string[];
  knownRisks: string[];
  completionEvidence: string[];
  artifactRefs: string[];
  reviews: CouncilReviewCard[];
  selected: boolean;
};

export type CouncilBoardModel = {
  /** running / completed / failed（事件推导，快照到达后以快照为准） */
  status: string;
  decisionMode: string;
  trigger: string;
  failedCode: string;
  proposals: CouncilProposalCard[];
  synthesis: {
    synthesisId: string;
    roleId: string;
    summary: string;
    artifactRefs: string[];
  } | null;
  decision: {
    /** 后端原文 select / needs_human / request_revision / reject */
    verdict: string;
    decisionId: string;
    selectedProposalId: string;
    terminationReason: string;
    selectedArtifactRefs: string[];
  } | null;
  requiredNextActions: string[];
  blockedBy: string[];
  /** 合议过程一览（事件序）：time + 类型 + role_id */
  feed: { time: string; type: string; roleId: string }[];
};

/** timeline (+ 终态快照的 council 段) → 面板模型。没有任何合议数据 → null。 */
export function buildCouncilBoard(
  timeline: RunEvent[],
  council?: NonNullable<RunSnapshot['council']>,
): CouncilBoardModel | null {
  const events = timeline.filter((e) => e.type.startsWith('council.'));
  if (events.length === 0 && !council) return null;

  const payloadOf = (type: string): Record<string, unknown> => {
    const event = events.find((e) => e.type === type);
    return event ? asRecord(event.payload) : {};
  };

  // 提案骨架来自事件（运行中即出现）；正文从快照按 proposal_id 补
  const snapshotProposals = new Map<string, Record<string, unknown>>();
  for (const raw of council?.proposals ?? []) {
    const p = asRecord(raw);
    snapshotProposals.set(str(p.proposal_id), p);
  }

  const reviews: CouncilReviewCard[] = (council?.reviews ?? []).map((raw) => {
    const r = asRecord(raw);
    return {
      reviewId: str(r.review_id),
      proposalId: str(r.proposal_id),
      verdict: str(r.verdict),
      reason: str(r.reason),
    };
  });

  const decisionEvent = payloadOf('council.decision');
  const completedEvent = payloadOf('council.completed');
  const selectedProposalId =
    council?.selected_proposal_id ?? str(decisionEvent.selected_proposal_id);

  const proposalCards: CouncilProposalCard[] = events
    .filter((e) => e.type === 'council.proposal.completed')
    .map((e) => {
      const payload = asRecord(e.payload);
      const proposalId = str(payload.proposal_id);
      const snap = snapshotProposals.get(proposalId) ?? {};
      return {
        proposalId,
        roleId: str(payload.role_id),
        summary: str(snap.summary),
        affectedPaths: strList(snap.affected_paths),
        assumptions: strList(snap.assumptions),
        knownRisks: strList(snap.known_risks),
        completionEvidence: strList(snap.completion_evidence),
        artifactRefs: strList(snap.artifact_refs ?? payload.artifact_refs),
        reviews: reviews.filter((r) => r.proposalId === proposalId),
        selected: proposalId !== '' && proposalId === selectedProposalId,
      };
    });
  // 快照里有、事件里没有的提案（理论上不该发生，但不丢数据）
  for (const [proposalId, snap] of snapshotProposals) {
    if (proposalCards.some((p) => p.proposalId === proposalId)) continue;
    proposalCards.push({
      proposalId,
      roleId: str(snap.agent_id),
      summary: str(snap.summary),
      affectedPaths: strList(snap.affected_paths),
      assumptions: strList(snap.assumptions),
      knownRisks: strList(snap.known_risks),
      completionEvidence: strList(snap.completion_evidence),
      artifactRefs: strList(snap.artifact_refs),
      reviews: reviews.filter((r) => r.proposalId === proposalId),
      selected: proposalId !== '' && proposalId === selectedProposalId,
    });
  }

  const synthesisEvent = payloadOf('council.synthesis.completed');
  const snapSynthesis = council?.synthesis ? asRecord(council.synthesis) : {};
  const synthesisId = str(snapSynthesis.synthesis_id) || str(synthesisEvent.synthesis_id);
  const synthesis = synthesisId
    ? {
        synthesisId,
        roleId: str(synthesisEvent.role_id) || str(snapSynthesis.synthesizer_id),
        summary: str(snapSynthesis.summary),
        artifactRefs: strList(snapSynthesis.artifact_refs ?? synthesisEvent.artifact_refs),
      }
    : null;

  const verdict = council?.verdict ?? str(decisionEvent.verdict);
  const decision = verdict
    ? {
        verdict,
        decisionId: council?.decision_id ?? str(completedEvent.decision_id),
        selectedProposalId,
        terminationReason: str(decisionEvent.termination_reason),
        selectedArtifactRefs:
          council?.selected_artifact_refs ?? strList(completedEvent.selected_artifact_refs),
      }
    : null;

  const statusFromEvents = events.some((e) => e.type === 'council.failed')
    ? 'failed'
    : events.some((e) => e.type === 'council.completed')
      ? 'completed'
      : 'running';

  return {
    status: council?.status ?? statusFromEvents,
    decisionMode:
      council?.decision_mode ??
      (str(decisionEvent.decision_mode) || str(payloadOf('council.started').decision_mode)),
    trigger: str(payloadOf('council.started').trigger),
    failedCode: str(payloadOf('council.failed').code),
    proposals: proposalCards,
    synthesis,
    decision,
    requiredNextActions: (council?.required_next_actions ?? []).map((a) => str(a)).filter(Boolean),
    blockedBy: (council?.blocked_by ?? []).map((b) => str(b)).filter(Boolean),
    feed: events.map((e) => ({
      time: e.created_at.slice(11, 19),
      type: e.type,
      roleId: str(asRecord(e.payload).role_id),
    })),
  };
}
