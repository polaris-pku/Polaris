import type { LogEntry } from '@/types';
import { interventionCheckpoint } from '@/data/logs';
import { NODE_IDS } from '@/data/workflow';
import type { InterventionSlice, PartialExecState, SliceCreator } from '@/store/types';
import { extractTaskFields, syncTasks } from '@/store/lib/taskSync';
import { buildTimelineEvent } from '@/store/lib/timeline';

/** 注入业务规则后，下游尚未执行的节点标记为「已被介入」。 */
const DOWNSTREAM_UPDATED_IDS = [NODE_IDS.gate, 'n15-merge-auth', NODE_IDS.complete];

/** 介入域：人对流程的干预（业务规则注入、文件写权限确认）。 */
export const createInterventionSlice: SliceCreator<InterventionSlice> = (set) => ({
  addInterventionRule: (rule) =>
    set((state) => {
      const nodes = state.nodes.map((n) => {
        if (DOWNSTREAM_UPDATED_IDS.includes(n.id) && n.status === 'pending') {
          return { ...n, status: 'updated' as const };
        }
        return n;
      });
      const feedback =
        '已识别为业务规则。该规则将同步给 Coding Agent、Test Agent 和 Security Audit Agent。';
      const log: LogEntry = {
        time: '00:15',
        source: '用户介入',
        text: `注入业务规则：${rule.text}`,
        level: 'warning',
      };
      const exec: PartialExecState = {
        stage: state.stage,
        currentPage: state.currentPage,
        nodes,
        revealedNodeCount: state.revealedNodeCount,
        activeStepIndex: state.activeStepIndex,
        selectedNodeId: state.selectedNodeId,
        interventionRules: [...state.interventionRules, rule],
        confirmedCouncilOptionId: state.confirmedCouncilOptionId,
        interventionFeedback: feedback,
      };
      const timeline = [...state.timeline, buildTimelineEvent(log, exec, interventionCheckpoint)];
      const taskFields = extractTaskFields({
        ...state,
        ...exec,
        timeline,
      });
      return {
        ...exec,
        timeline,
        tasks: syncTasks(state.tasks, state.activeTaskId, taskFields),
      };
    }),

  resolveFilePermission: (toolEventId, outcome) =>
    set((state) => {
      const filePermissionOutcomes = {
        ...(state.filePermissionOutcomes ?? {}),
        [toolEventId]: outcome,
      };
      const taskFields = extractTaskFields({ ...state, filePermissionOutcomes });
      return {
        filePermissionOutcomes,
        tasks: syncTasks(state.tasks, state.activeTaskId, taskFields),
      };
    }),
});
