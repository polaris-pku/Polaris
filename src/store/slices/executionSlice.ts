import type { DemoStage } from '@/types';
import { nodeLogs } from '@/data/logs';
import {
  MAX_COLUMN,
  NODE_IDS,
  indicesInColumn,
  primaryIndexInColumn,
  revealedCountThroughColumn,
} from '@/data/workflow';
import { resetTimelineSeq } from '@/lib/snapshot';
import type { ExecutionSlice, PartialExecState, SliceCreator } from '@/store/types';
import { blankState } from '@/store/lib/blankState';
import { extractTaskFields, syncTasks } from '@/store/lib/taskSync';
import { buildTimelineEvent, getNodeLog } from '@/store/lib/timeline';

/** Auto Run 的调度句柄（模块级单例，与 store 生命周期一致）。 */
let autoRunTimer: ReturnType<typeof setTimeout> | null = null;

/** 执行域：工作流推进引擎（单步/自动/回退 Checkpoint/交付）。 */
export const createExecutionSlice: SliceCreator<ExecutionSlice> = (set, get) => ({
  useRecommendedWorkflow: () =>
    set((state) => {
      const nodes = state.nodes.map((n, i) => (i === 0 ? { ...n, status: 'active' as const } : n));
      const nodeLog = nodeLogs[nodes[0].id];
      const exec: PartialExecState = {
        stage: 'executing',
        currentPage: state.currentPage,
        nodes,
        revealedNodeCount: 1,
        activeStepIndex: 0,
        selectedNodeId: nodes[0].id,
        interventionRules: state.interventionRules,
        confirmedCouncilOptionId: state.confirmedCouncilOptionId,
        interventionFeedback: state.interventionFeedback,
      };
      const { checkpoint, ...entry } = nodeLog ?? {
        time: '00:01',
        source: 'Orchestrator',
        text: 'Workflow 已启动。',
        level: 'info' as const,
      };
      const timeline = nodeLog ? [buildTimelineEvent(entry, exec, checkpoint)] : [];
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

  nextStep: () => {
    const state = get();
    if (state.stage !== 'executing') return;
    const cur = state.activeStepIndex;
    if (cur < 0) return;
    const curCol = state.nodes[cur].column;

    // 活跃列为 Council 且尚未裁决 → 进入议会
    if (state.nodes[cur].id === NODE_IDS.council && !state.confirmedCouncilOptionId) {
      get().goToCouncil();
      return;
    }

    const nodes = state.nodes.map((n) => ({ ...n }));
    // 当前列整列置 done（并行列两节点一起完成）
    indicesInColumn(nodes, curCol).forEach((i) => {
      nodes[i] = { ...nodes[i], status: 'done' };
    });

    // 末列：进入交付
    if (curCol >= MAX_COLUMN) {
      const exec: PartialExecState = {
        stage: 'delivery',
        currentPage: state.currentPage,
        nodes,
        revealedNodeCount: nodes.length,
        activeStepIndex: cur,
        selectedNodeId: nodes[cur].id,
        interventionRules: state.interventionRules,
        confirmedCouncilOptionId: state.confirmedCouncilOptionId,
        interventionFeedback: state.interventionFeedback,
      };
      const taskFields = extractTaskFields({ ...state, ...exec });
      set({
        ...exec,
        tasks: syncTasks(state.tasks, state.activeTaskId, taskFields),
      });
      get().stopAutoRun();
      return;
    }

    // 推进到下一列：整列置 active（并行列两节点一起点亮）
    const nextCol = curCol + 1;
    indicesInColumn(nodes, nextCol).forEach((i) => {
      nodes[i] = { ...nodes[i], status: 'active' };
    });
    const primaryIndex = primaryIndexInColumn(nodes, nextCol);
    const primaryNode = nodes[primaryIndex];
    const nodeLog = getNodeLog(primaryNode.id);

    let stage: DemoStage = 'executing';
    let currentPage = state.currentPage;
    if (primaryNode.id === NODE_IDS.council) {
      stage = 'council';
      currentPage = 'council';
      get().stopAutoRun();
    }

    const exec: PartialExecState = {
      stage,
      currentPage,
      nodes,
      revealedNodeCount: revealedCountThroughColumn(nodes, nextCol),
      activeStepIndex: primaryIndex,
      selectedNodeId: primaryNode.id,
      interventionRules: state.interventionRules,
      confirmedCouncilOptionId: state.confirmedCouncilOptionId,
      interventionFeedback: state.interventionFeedback,
    };

    const timeline = nodeLog
      ? [
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
        ]
      : state.timeline;

    const taskFields = extractTaskFields({ ...state, ...exec, timeline });
    set({
      ...exec,
      timeline,
      tasks: syncTasks(state.tasks, state.activeTaskId, taskFields),
    });
  },

  autoRun: () => {
    const tick = () => {
      const state = get();
      if (state.stage !== 'executing') {
        set({ isAutoRunning: false });
        autoRunTimer = null;
        return;
      }
      state.nextStep();
      const after = get();
      if (after.stage === 'executing' && after.isAutoRunning) {
        autoRunTimer = setTimeout(tick, 950);
      } else {
        set({ isAutoRunning: false });
        autoRunTimer = null;
      }
    };
    set({ isAutoRunning: true });
    autoRunTimer = setTimeout(tick, 400);
  },

  stopAutoRun: () => {
    if (autoRunTimer) {
      clearTimeout(autoRunTimer);
      autoRunTimer = null;
    }
    set({ isAutoRunning: false });
  },

  resetDemo: () => {
    if (autoRunTimer) {
      clearTimeout(autoRunTimer);
      autoRunTimer = null;
    }
    resetTimelineSeq();
    // 回到空白启动态：清空项目与任务，返回启动页。
    set(blankState());
  },

  selectNode: (nodeId) =>
    set((state) => {
      const taskFields = extractTaskFields({ ...state, selectedNodeId: nodeId });
      return {
        selectedNodeId: nodeId,
        tasks: syncTasks(state.tasks, state.activeTaskId, taskFields),
      };
    }),

  showDelivery: () =>
    set((state) => {
      const completeIdx = state.nodes.findIndex((n) => n.id === NODE_IDS.complete);
      const nodes = state.nodes.map((n) =>
        n.column === MAX_COLUMN ? { ...n, status: 'done' as const } : n,
      );
      const nodeLog = nodeLogs[NODE_IDS.complete];
      const alreadyHasComplete = state.timeline.some(
        (e) => e.source === 'Orchestrator' && e.text.includes('Delivery Report'),
      );
      const exec: PartialExecState = {
        stage: 'delivery',
        currentPage: 'tasks',
        nodes,
        activeStepIndex: completeIdx,
        selectedNodeId: nodes[completeIdx].id,
        revealedNodeCount: nodes.length,
        interventionRules: state.interventionRules,
        confirmedCouncilOptionId: state.confirmedCouncilOptionId,
        interventionFeedback: state.interventionFeedback,
      };
      const timeline =
        alreadyHasComplete || !nodeLog
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
      return {
        ...exec,
        timeline,
        tasks: syncTasks(state.tasks, state.activeTaskId, taskFields),
      };
    }),

  restoreCheckpoint: (eventId) => {
    const state = get();
    const idx = state.timeline.findIndex((e) => e.id === eventId);
    if (idx < 0) return;
    const event = state.timeline[idx];
    if (!event.checkpoint) return;

    get().stopAutoRun();
    const snap = event.snapshot;
    const taskFields = extractTaskFields({
      ...state,
      stage: snap.stage,
      nodes: snap.nodes.map((n) => ({
        ...n,
        input: [...n.input],
        output: [...n.output],
      })),
      revealedNodeCount: snap.revealedNodeCount,
      activeStepIndex: snap.activeStepIndex,
      selectedNodeId: snap.selectedNodeId,
      interventionRules: snap.interventionRules.map((r) => ({
        ...r,
        affectedAgents: [...r.affectedAgents],
      })),
      confirmedCouncilOptionId: snap.confirmedCouncilOptionId,
      interventionFeedback: snap.interventionFeedback,
      timeline: state.timeline.slice(0, idx + 1),
    });
    set({
      stage: snap.stage,
      currentPage: snap.currentPage,
      nodes: taskFields.nodes,
      revealedNodeCount: taskFields.revealedNodeCount,
      activeStepIndex: taskFields.activeStepIndex,
      selectedNodeId: taskFields.selectedNodeId,
      interventionRules: taskFields.interventionRules,
      confirmedCouncilOptionId: taskFields.confirmedCouncilOptionId,
      interventionFeedback: taskFields.interventionFeedback,
      timeline: taskFields.timeline,
      tasks: syncTasks(state.tasks, state.activeTaskId, taskFields),
      isAutoRunning: false,
    });
  },
});
