/**
 * 方向 C · Council API 类型。
 *
 * 本文件分两层：
 *  1) 【v0 后端契约·已实现】对齐 BCD `src/council/contract.ts`（newide-scaffold 已落地）。
 *  2) 【后端规划中·前端保留】更丰富的评审/决策类型 —— Council RFC 已定义，且 BCD
 *     `hook` 已列出 council.context_packaged / profile_snapshot_saved / diff_ready /
 *     decision 等点位，属后端打算实现但 v0 尚未落地的部分。依"后端打算实现则前端
 *     保留"的原则保留；在后端落地前，不要假设当前 v0 会返回这些字段。
 */

import type { ArtifactId, RunId, SchemaVersion, TaskId, Timestamp } from './core';
import type { RiskLevel } from './coord';

// ══════════════════════════════════════════════════
//  1) v0 后端契约（council/contract.ts）
// ══════════════════════════════════════════════════

export interface Proposal {
  proposal_id: string;
  run_id: RunId;
  task_id: TaskId;
  artifact_refs: ArtifactId[];
  summary: string;
  created_at: Timestamp;
  schema_version: SchemaVersion;
}

export interface Review {
  review_id: string;
  proposal_id: string;
  reviewer_id: string;
  verdict: 'approve' | 'reject' | 'needs_revision';
  reason: string;
  created_at: Timestamp;
  schema_version: SchemaVersion;
}

export interface EvidencePack {
  evidence_pack_id: string;
  context_pack_ref: string;
  artifact_refs: ArtifactId[];
  gate_result_refs: string[];
  created_at: Timestamp;
  schema_version: SchemaVersion;
}

/** v0 权威决策形状（council/contract.ts）。前端前瞻的富形状见下方 `DecisionPacket`。 */
export interface CouncilDecision {
  decision_id: string;
  run_id: RunId;
  task_id: TaskId;
  selected_proposal_id?: string;
  verdict: 'accept' | 'reject' | 'defer';
  reason: string;
  evidence_refs: string[];
  created_at: Timestamp;
  schema_version: SchemaVersion;
}

export interface CouncilRoundInput {
  run_id: RunId;
  task_id: TaskId;
  proposals: Proposal[];
  reviews?: Review[];
  evidence_pack: EvidencePack;
}

// ══════════════════════════════════════════════════
//  2) 后端规划中·前端保留（Council RFC；BCD v0 尚未落地）
// ══════════════════════════════════════════════════

export type CouncilStatus =
  | 'created'
  | 'context_packaging'
  | 'profile_snapshotting'
  | 'extracting'
  | 'proposing'
  | 'cross_reviewing'
  | 'diffing'
  | 'judging'
  | 'deciding'
  | 'completed'
  | 'escalated_to_human'
  | 'failed'
  | 'timeout'
  | 'cancelled';

export type CouncilParticipantProfileSnapshot = {
  participant_id: string;
  council_id: string;
  agent_id: string;
  role_id: string;
  driver_id: string;
  participant_role: 'proposer' | 'reviewer' | 'judge' | 'observer';
  capability_tags: string[];
  domain_experience_summary?: string;
  known_strengths?: string[];
  known_limits?: string[];
  review_specialties?: string[];
  conflict_of_interest_flags?: string[];
};

export type ClaimCluster = {
  cluster_id: string;
  normalized_claim: string;
  supporting_proposals: string[];
  evidence_refs: string[];
  risk_level: RiskLevel;
};

export type ConflictCluster = {
  cluster_id: string;
  conflict_type:
    | 'same_range_text_conflict'
    | 'api_contract_conflict'
    | 'assumption_conflict'
    | 'risk_policy_conflict'
    | 'artifact_dependency_conflict';
  claims: string[];
  proposals: string[];
  severity: 'blocker' | 'high' | 'medium' | 'low';
};

export type NWayDiff = {
  diff_id: string;
  council_id: string;
  base_ref: string;
  full_consensus: ClaimCluster[];
  partial_agreement: ClaimCluster[];
  disagreement: ConflictCluster[];
  unique_findings: ClaimCluster[];
};

/**
 * Council RFC 的合入授权（人读形状，后端规划中）。
 * ⚠️ 与 core/decision.ts 的权威 `MergeAuthorization`（已实现，见 ./core）字段完全不同，
 * 故此处重命名为 `CouncilMergeAuthorization` 以避免名称冲突。以 core 版为权威对齐目标。
 */
export type CouncilMergeAuthorization = {
  authorized: boolean;
  source: 'human' | 'deterministic_gate';
  selected_proposal_id?: string;
  target_branch: string;
  human_approval_ref?: string;
};

export type DecisionPacket = {
  decision_id: string;
  council_id?: string;
  mode: 'advisory' | 'evidence_only' | 'human_gate';
  outcome: 'approve_merge' | 'request_revision' | 'choose_alternative' | 'reject' | 'defer';
  summary: string;
  recommended_option?: string;
  selected_proposal_id?: string;
  required_action: DecisionPacket['outcome'];
  artifact_refs: string[];
  approval_basis: string[];
  gate_refs: string[];
  merge_authorization_status: 'none' | 'pending_human' | 'authorized';
  merge_authorization?: CouncilMergeAuthorization;
  rationale: string[];
  human_approval_ref?: string;
};

export type CouncilSession = {
  council_id: string;
  origin_task_id: string;
  status: CouncilStatus;
  question: string;
  decision_mode: DecisionPacket['mode'];
  participant_count: number;
  nway_diff?: NWayDiff;
  decision_packet?: DecisionPacket;
  participant_profiles: CouncilParticipantProfileSnapshot[];
};
