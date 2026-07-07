import { create } from 'zustand';
import { onEvent, onEventChannelStatus } from '@/api/events';
import type { DemoState } from '@/store/types';
import { blankState } from '@/store/lib/blankState';
import { createProjectSlice } from '@/store/slices/projectSlice';
import { createTeamSlice } from '@/store/slices/teamSlice';
import { createTaskSlice } from '@/store/slices/taskSlice';
import { createExecutionSlice } from '@/store/slices/executionSlice';
import { createInterventionSlice } from '@/store/slices/interventionSlice';
import { createCouncilSlice } from '@/store/slices/councilSlice';

// 对外类型与常量保持原路径可用（historical import site: '@/store/useDemoStore'）
export { PROJECT_EXPORT_FORMAT, type ProjectExport } from '@/store/types';

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
