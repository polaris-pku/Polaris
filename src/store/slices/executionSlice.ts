import type { DemoTask, RunReplay } from '@/types';
import { unwatchRun } from '@/api/events';
import { resetTimelineSeq } from '@/lib/snapshot';
import type { ExecutionSlice, PartialExecState, SliceCreator } from '@/store/types';
import { blankState } from '@/store/lib/blankState';
import { extractTaskFields, syncTasks } from '@/store/lib/taskSync';
import { buildTimelineEvent, getNodeLog } from '@/store/lib/timeline';

/** 活动任务挂载的真实 run 回放数据源（普通 mock 任务为 undefined）。 */
const activeReplay = (s: {
  tasks: DemoTask[];
  activeTaskId: string | null;
}): RunReplay | undefined => s.tasks.find((t) => t.id === s.activeTaskId)?.replay;

/**
 * 执行域。
 *
 * 曾经这里是一整套 mock 推进引擎（单步 / 自动跑 / 交付 / 回退 Checkpoint）。它们连同
 * `介入` / `Next Step` / `Auto Run` 三个按钮在信息架构重排时就被删了（见 PrimaryAction 的
 * 【R4】：真实 run 全自动且没有人类回写通道，这类按钮只能改本地状态），此后一直是无调用者的
 * 死代码 —— 现已移除。真实 run 的推进由后端事件驱动（taskSlice.applyLiveProgress）。
 *
 * `isAutoRunning` 因此恒为 false：字段仍在（多处读取并写进导出的运行记录），但再没有人能把它置真。
 */
export const createExecutionSlice: SliceCreator<ExecutionSlice> = (set) => ({
  useRecommendedWorkflow: () =>
    set((state) => {
      const nodes = state.nodes.map((n, i) => (i === 0 ? { ...n, status: 'active' as const } : n));
      const nodeLog = getNodeLog(nodes[0].id, activeReplay(state));
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

  /**
   * 保留为空动作：13 处调用点（切项目 / 切任务 / 建任务…）把它当作「停下正在跑的东西」的
   * 统一收口。自动跑已删除，所以它现在只把标志位归位。
   */
  stopAutoRun: () => {
    set({ isAutoRunning: false });
  },

  resetDemo: () => {
    resetTimelineSeq();
    // 任务全清了，订阅也要一并撤掉（不传参 = 退订全部）。否则那些 run 会继续推事件进来，
    // 在一个已经没有对应任务的 store 里凭空重建 liveRuns 条目，并触发无意义的快照拉取。
    void unwatchRun();
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
});
