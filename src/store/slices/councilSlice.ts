import type { LogEntry } from '@/types';
import { councilConfirmCheckpoint, nodeLogs } from '@/data/logs';
import { MAX_COLUMN, NODE_IDS, revealedCountThroughColumn } from '@/data/workflow';
import type { CouncilSlice, PartialExecState, SliceCreator } from '@/store/types';
import { extractTaskFields, syncTasks } from '@/store/lib/taskSync';
import { buildTimelineEvent } from '@/store/lib/timeline';

/** 议会域：进入议会（快进至 N14）与裁决收束（直达 N18）。 */
export const createCouncilSlice: SliceCreator<CouncilSlice> = (set, get) => ({
  goToCouncil: () => {
    const state = get();
    const councilIdx = state.nodes.findIndex((n) => n.id === NODE_IDS.council);
    if (councilIdx < 0) return;
    const councilCol = state.nodes[councilIdx].column;
    const nodes = state.nodes.map((n) => {
      if (n.column < councilCol) {
        return n.status === 'done' ? n : { ...n, status: 'done' as const };
      }
      if (n.id === NODE_IDS.council) return { ...n, status: 'active' as const };
      return n;
    });
    const nodeLog = nodeLogs[NODE_IDS.council];
    const alreadyHasCouncil = state.timeline.some(
      (e) => e.source === 'Council' && e.text.includes('已就绪'),
    );
    const exec: PartialExecState = {
      stage: 'council',
      currentPage: 'council',
      nodes,
      activeStepIndex: councilIdx,
      selectedNodeId: NODE_IDS.council,
      revealedNodeCount: Math.max(
        state.revealedNodeCount,
        revealedCountThroughColumn(nodes, councilCol),
      ),
      interventionRules: state.interventionRules,
      confirmedCouncilOptionId: state.confirmedCouncilOptionId,
      interventionFeedback: state.interventionFeedback,
    };
    const timeline =
      alreadyHasCouncil || !nodeLog
        ? state.timeline
        : [
            ...state.timeline,
            buildTimelineEvent(
              {
                time: nodeLog.time,
                source: nodeLog.source,
                text: nodeLog.text,
                level: nodeLog.level,
              },
              exec,
              nodeLog.checkpoint,
            ),
          ];
    const taskFields = extractTaskFields({ ...state, ...exec, timeline });
    set({
      ...exec,
      timeline,
      tasks: syncTasks(state.tasks, state.activeTaskId, taskFields),
    });
    get().stopAutoRun();
  },

  confirmCouncilOption: (optionId) => {
    const state = get();
    const completeIdx = state.nodes.findIndex((n) => n.id === NODE_IDS.complete);
    // 裁决后：议会与中间合并节点(N15–N17)收束为 done，直达 N18 complete
    const nodes = state.nodes.map((n) =>
      n.column < MAX_COLUMN
        ? { ...n, status: 'done' as const }
        : { ...n, status: 'active' as const },
    );
    const log: LogEntry = {
      time: '00:28',
      source: 'Council',
      text: '用户已裁决：采用 Option A · RBAC 策略，回到主流程。',
      level: 'council',
    };
    const exec: PartialExecState = {
      stage: 'executing',
      currentPage: 'tasks',
      nodes,
      activeStepIndex: completeIdx,
      selectedNodeId: nodes[completeIdx].id,
      revealedNodeCount: state.nodes.length,
      interventionRules: state.interventionRules,
      confirmedCouncilOptionId: optionId,
      interventionFeedback: state.interventionFeedback,
    };
    const timeline = [...state.timeline, buildTimelineEvent(log, exec, councilConfirmCheckpoint)];
    const taskFields = extractTaskFields({ ...state, ...exec, timeline });
    set({
      ...exec,
      timeline,
      tasks: syncTasks(state.tasks, state.activeTaskId, taskFields),
    });
  },
});
