import type { LogEntry } from '@/types';
import { interventionCheckpoint } from '@/data/logs';
import { findFileOp } from '@/data/fileops';
import { NODE_IDS } from '@/data/workflow';
import type { InterventionSlice, PartialExecState, SliceCreator } from '@/store/types';
import { flushAgentWritesForNode, writeTargetOf } from '@/store/lib/agentWrites';
import { insertFileNode } from '@/store/lib/fileTree';
import { extractTaskFields, syncTasks } from '@/store/lib/taskSync';
import { buildTimelineEvent } from '@/store/lib/timeline';

/** 注入业务规则后，下游尚未执行的节点标记为「已被介入」。 */
const DOWNSTREAM_UPDATED_IDS = [NODE_IDS.gate, 'n15-merge-auth', NODE_IDS.complete];

/** 介入域：人对流程的干预（业务规则注入、文件写权限确认）。 */
export const createInterventionSlice: SliceCreator<InterventionSlice> = (set, get) => ({
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

  resolveFilePermission: (toolEventId, outcome) => {
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
    });
    // 人机确认已记录；若选择为"允许"，把挂起的那条写操作真正落盘
    const found = findFileOp(toolEventId);
    if (!found) return;
    const state = get();
    flushAgentWritesForNode(
      found.nodeId,
      state.filePermissionOutcomes ?? {},
      state.agentFileWrites,
      writeTargetOf(state.projects.find((p) => p.id === state.activeProjectId)),
      state.recordAgentFileWrite,
    );
  },

  recordAgentFileWrite: (toolEventId, result) =>
    set((state) => {
      const agentFileWrites = { ...state.agentFileWrites, [toolEventId]: result };
      if (result.status !== 'written' || !state.activeProjectId) return { agentFileWrites };
      // 写成功：把文件挂进当前项目的文件树，让 IDE 侧栏同步看到 agent 产出。
      // 标 origin='demo'：这条链路走的是 mock 剧本（桌面壳代 A 落盘），
      // 与后端真实 run 的产物落在同一个工作区里，不标就分不清谁写的。
      const op = findFileOp(toolEventId)?.op;
      const parts = op?.path.split('/').filter(Boolean) ?? [];
      if (parts.length === 0) return { agentFileWrites };
      return {
        agentFileWrites,
        projects: state.projects.map((p) =>
          p.id === state.activeProjectId
            ? { ...p, files: insertFileNode(p.files, parts, false, 'demo') }
            : p,
        ),
      };
    }),
});
