import { create } from 'zustand';
import { getRunSnapshot } from '@/api/client';
import { onEvent, onEventChannelStatus, onRunEvent } from '@/api/events';
import type { DemoState } from '@/store/types';
import { blankState } from '@/store/lib/blankState';
import { createProjectSlice } from '@/store/slices/projectSlice';
import { createTeamSlice } from '@/store/slices/teamSlice';
import { createTaskSlice } from '@/store/slices/taskSlice';
import { createExecutionSlice } from '@/store/slices/executionSlice';
import { createInterventionSlice } from '@/store/slices/interventionSlice';
import { createCouncilSlice } from '@/store/slices/councilSlice';

// 对外类型与常量保持原路径可用（historical import site: '@/store/useDemoStore'）
export { PROJECT_TRACE_FORMAT, type ProjectTrace } from '@/store/types';

/**
 * 活动任务的真实 run 回放数据源（普通 mock 任务为 undefined）。
 * 各内容消费组件用它做「replay 优先、mock 回退」的选择。
 */
export const selectActiveReplay = (s: DemoState) =>
  s.tasks.find((t) => t.id === s.activeTaskId)?.replay;

/**
 * 全局演示 store：由六个领域切片组合而成，本文件只做组装与事件通道接线。
 *
 *   项目域  slices/projectSlice.ts      项目生命周期 + 文件树
 *   团队域  slices/teamSlice.ts         Agent 选择与组队定制
 *   任务域  slices/taskSlice.ts         任务生命周期 + 页面导航
 *   执行域  slices/executionSlice.ts    工作流推进引擎（单步/自动/回退/交付）
 *   介入域  slices/interventionSlice.ts 业务规则注入 + 文件写权限确认
 *   议会域  slices/councilSlice.ts      进入议会 + 裁决收束
 *
 * 跨域共享的纯函数在 store/lib/（任务回写、时间线快照、文件树、id）。
 */
export const useDemoStore = create<DemoState>()((...a) => ({
  ...blankState(),
  ...createProjectSlice(...a),
  ...createTeamSlice(...a),
  ...createTaskSlice(...a),
  ...createExecutionSlice(...a),
  ...createInterventionSlice(...a),
  ...createCouncilSlice(...a),
}));

// dev 下把 store 挂到 window，便于在 DevTools 里直接观察真实 run 的状态与后端事件。
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __demoStore?: unknown }).__demoStore = useDemoStore;
}

/** 事件日志封顶条数：只做近期观测窗口，完整审计流由 C 持久化（E 不重放）。 */
const EVENT_LOG_CAP = 200;

// ── 事件通道接线（模块级，应用生命周期内常驻订阅） ──
// mock 模式下 onEvent 不建 WS 连接，事件由 client.ts mock 路径本地喂入，
// 消费链路（追加到 backendEvents 观测窗口）与真连接完全一致。
onEvent((event) => {
  useDemoStore.setState((s) => ({
    backendEvents: [event, ...s.backendEvents].slice(0, EVENT_LOG_CAP),
  }));
});
onEventChannelStatus((eventChannelStatus) => {
  useDemoStore.setState({ eventChannelStatus });
});

// ── 真实 run 接线（模块级常驻订阅）──
// mock 模式下传输层不推 RunEvent，这条链路自然静默；有真实后端时它是唯一的事实来源。
// 注意：与 mock 剧本并存 —— 剧本继续驱动泳道图演示，liveRun 记录后端真发生了什么。

/** run 的终态事件：拿到后去拉一次完整快照（含 flow/delivery_report/errors）。 */
const TERMINAL_EVENTS: Record<string, 'completed' | 'failed' | 'cancelled'> = {
  'run.completed': 'completed',
  'run.failed': 'failed',
  'run.cancelled': 'cancelled',
};

onRunEvent((event) => {
  useDemoStore.setState((s) => {
    const prev =
      s.liveRun?.runId === event.run_id
        ? s.liveRun
        : {
            runId: event.run_id,
            taskId: event.task_id,
            status: 'running' as const,
            timeline: [],
            snapshot: null,
            error: null,
          };
    // 后端事件带单调递增的 sequence —— 排序以它为准，不依赖到达顺序。
    const timeline = [...prev.timeline, event].sort((a, b) => a.sequence - b.sequence);
    const terminal = TERMINAL_EVENTS[event.type];
    return { liveRun: { ...prev, timeline, status: terminal ?? prev.status } };
  });

  if (!TERMINAL_EVENTS[event.type]) return;

  // 终态：拉完整快照。失败不影响已收到的事件时间线。
  void getRunSnapshot(event.run_id)
    .then((snapshot) => {
      useDemoStore.setState((s) =>
        s.liveRun?.runId === event.run_id ? { liveRun: { ...s.liveRun, snapshot } } : {},
      );
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      useDemoStore.setState((s) =>
        s.liveRun?.runId === event.run_id ? { liveRun: { ...s.liveRun, error: message } } : {},
      );
    });
});
