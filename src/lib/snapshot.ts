import type { DemoSnapshot, InterventionRule, PageKey, DemoStage, WorkflowNodeData } from '@/types';

type SnapshotSource = {
  stage: DemoStage;
  currentPage: PageKey;
  nodes: WorkflowNodeData[];
  revealedNodeCount: number;
  activeStepIndex: number;
  selectedNodeId: string | null;
  interventionRules: InterventionRule[];
  confirmedCouncilOptionId: string | null;
  interventionFeedback: string | null;
};

export function captureSnapshot(source: SnapshotSource): DemoSnapshot {
  return {
    stage: source.stage,
    currentPage: source.currentPage,
    nodes: source.nodes.map((n) => ({
      ...n,
      input: [...n.input],
      output: [...n.output],
    })),
    revealedNodeCount: source.revealedNodeCount,
    activeStepIndex: source.activeStepIndex,
    selectedNodeId: source.selectedNodeId,
    interventionRules: source.interventionRules.map((r) => ({
      ...r,
      affectedAgents: [...r.affectedAgents],
    })),
    confirmedCouncilOptionId: source.confirmedCouncilOptionId,
    interventionFeedback: source.interventionFeedback,
  };
}

let timelineSeq = 0;

export function nextTimelineId(): string {
  timelineSeq += 1;
  return `tl-${timelineSeq}`;
}

export function resetTimelineSeq(): void {
  timelineSeq = 0;
}
