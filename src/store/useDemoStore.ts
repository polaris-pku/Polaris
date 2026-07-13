import { create } from 'zustand';
import { getRunSnapshot } from '@/api/client';
import { onBackendStatus, onEvent, onEventChannelStatus, onRunEvent } from '@/api/events';
import type { DemoState } from '@/store/types';
import { blankState } from '@/store/lib/blankState';
import { createProjectSlice } from '@/store/slices/projectSlice';
import { createTeamSlice } from '@/store/slices/teamSlice';
import { createTaskSlice } from '@/store/slices/taskSlice';
import { createExecutionSlice } from '@/store/slices/executionSlice';
import { createInterventionSlice } from '@/store/slices/interventionSlice';
import { createCouncilSlice } from '@/store/slices/councilSlice';
import { createTerminalSlice, reduceTermEvent } from '@/store/slices/terminalSlice';
import { onTerminalEvent } from '@/api/terminal';

// 对外类型与常量保持原路径可用（historical import site: '@/store/useDemoStore'）
export { PROJECT_TRACE_FORMAT, type ProjectTrace } from '@/store/types';

/**
 * 活动任务的真实 run 回放数据源（普通 mock 任务为 undefined）。
 * 各内容消费组件用它做「replay 优先、mock 回退」的选择。
 */
export const selectActiveReplay = (s: DemoState) =>
  s.tasks.find((t) => t.id === s.activeTaskId)?.replay;

/**
 * 当前选中任务自己那次真实 run 的实时状态；没有真实 run（纯 mock 剧本任务）时为 undefined。
 *
 * 界面**只能**通过它取 live 数据。直接读 `liveRuns` 再自己比对 runId 的写法已经出过事：
 * 并发跑第二个任务时，界面会把另一次 run 的状态/事件数安在当前任务头上。
 */
export const selectActiveLiveRun = (s: DemoState) => {
  const runId = s.tasks.find((t) => t.id === s.activeTaskId)?.contractRunId;
  return runId ? s.liveRuns[runId] : undefined;
};

/**
 * 全局演示 store：由六个领域切片组合而成，本文件只做组装与事件通道接线。
 *
 *   项目域  slices/projectSlice.ts      项目生命周期 + 文件树
 *   团队域  slices/teamSlice.ts         Agent 选择与组队定制
 *   任务域  slices/taskSlice.ts         任务生命周期 + 页面导航
 *   执行域  slices/executionSlice.ts    工作流推进引擎（单步/自动/回退/交付）
 *   介入域  slices/interventionSlice.ts 业务规则注入 + 文件写权限确认
 *   议会域  slices/councilSlice.ts      进入议会 + 裁决收束
 *   终端域  slices/terminalSlice.ts    Dock 三频道 + Python 终端会话 + 帮助抽屉
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
  ...createTerminalSlice(...a),
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

/**
 * ── 终端事件接线（模块级常驻订阅）──
 *
 * 只吸收会话状态（exit / error）。**输出 chunk 不进 store** —— 它由 TerminalFrame 自己订阅后
 * 直接喂进 xterm；一个 `while True: print('x')` 的输出量放进 zustand 会把渲染层拖死。
 *
 * 【R3/I5】这条链路是**只读**的：它永远不会调 startTerminalRun / term:start。
 * 事件驱动的自动执行 = agent → 宿主的静默 RCE（agent 会往工作区写 .py）。
 */
onTerminalEvent((event) => {
  useDemoStore.setState((s) => reduceTermEvent(s, event));
});

/**
 * 后端进程掉线 → 把还在跑的 run 如实标成中断。
 *
 * BCD 的 run registry 只活在它自己的进程内存里，进程一死那些 run 就不会再有任何事件了。
 * 没有这条兜底，任何一次后端崩溃/重启都会在界面上留下一个永远转圈的「执行中」——
 * 这正是用户看到的那个症状最阴的一种成因（后端已经死了，前端还在等一个永远不来的事件）。
 *
 * 只在 ready 之外的状态触发。应用刚启动时后端是 stopped/starting，但那时一个 run 都没有，空转无害。
 */
onBackendStatus((status) => {
  if (status.state === 'ready') return;
  const reason =
    status.state === 'error'
      ? `后端异常，该 run 已中断：${status.message || '未知原因'}`
      : '后端进程已重启或退出，该 run 已中断（后端不会再推送它的事件）。';
  useDemoStore.getState().failLiveRuns(reason);
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

/**
 * 事件 → liveRuns[run_id]。
 *
 * **每个 run 各自累积自己的时间线。** 并发跑多个需求时，两个 run 的事件是交错到达的；
 * 这里以前是单槽 `liveRun`，后到的 run 会把前一个顶掉、时间线归零重建 ——
 * 先提交的任务因此永远停在半路。现在按 run_id 键控，互不干扰。
 */
onRunEvent((event) => {
  const runId = event.run_id;

  useDemoStore.setState((s) => {
    const prev = s.liveRuns[runId] ?? {
      runId,
      taskId: event.task_id,
      status: 'running' as const,
      timeline: [],
      snapshot: null,
      error: null,
    };
    // 后端事件带单调递增的 sequence —— 排序以它为准，不依赖到达顺序。
    const timeline = [...prev.timeline, event].sort((a, b) => a.sequence - b.sequence);
    const terminal = TERMINAL_EVENTS[event.type];
    return {
      liveRuns: {
        ...s.liveRuns,
        [runId]: { ...prev, timeline, status: terminal ?? prev.status },
      },
    };
  });

  // 泳道图实时跟着后端走：每条事件都用该 run「全部已收到的事件」重投影一次节点状态。
  // applyLiveProgress 内部按 contractRunId 寻址任务，所以并发 run 各自落到各自的任务上。
  const live = useDemoStore.getState().liveRuns[runId];
  if (live) {
    useDemoStore.getState().applyLiveProgress(runId, live.timeline, live.status);
  }

  if (!TERMINAL_EVENTS[event.type]) return;

  // 终态：拉完整快照。失败不影响已收到的事件时间线。
  void getRunSnapshot(runId)
    .then((snapshot) => {
      useDemoStore.setState((s) => {
        const cur = s.liveRuns[runId];
        return cur ? { liveRuns: { ...s.liveRuns, [runId]: { ...cur, snapshot } } } : {};
      });
      // 用后端事实接管这个任务：泳道图 / 节点日志 / Inspector / 交付报告不再是 mock 剧本。
      useDemoStore.getState().attachLiveRun(runId, snapshot);
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      useDemoStore.setState((s) => {
        const cur = s.liveRuns[runId];
        return cur ? { liveRuns: { ...s.liveRuns, [runId]: { ...cur, error: message } } } : {};
      });
    });
});
