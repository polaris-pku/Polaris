import type { LogEntry, TimelineCheckpoint } from '@/types';

export type { LogEntry };

/**
 * 每个 workflow 节点激活/完成时追加的执行时间轴事件（mock）。
 * key 为节点 id（N0–N18）。带 checkpoint 的条目可回溯到该时刻。
 * 文案尽量贴近字段清单里的标准事件（task.created / task.completed 等）。
 */
export const nodeLogs: Record<string, LogEntry & { checkpoint?: TimelineCheckpoint }> = {
  'n0-intake': {
    time: '00:01',
    source: 'User',
    text: 'N0 需求到达：已接收原始需求文本 raw_spec_text。',
    level: 'info',
    checkpoint: {
      label: '需求到达',
      description: 'raw_spec_text 已进入 IDE，链路启动',
    },
  },
  'n1-triage': {
    time: '00:02',
    source: 'Coordinator',
    text: 'N1 分诊：识别风险 medium，建议角色 backend，生成 TaskCreateRequest 草案。',
    level: 'info',
  },
  'n2-create-task': {
    time: '00:03',
    source: 'Coordinator',
    text: 'N2 task.created：Task 已创建（status=created），完成标准已写入。',
    level: 'info',
    checkpoint: {
      label: 'Task 已建',
      description: 'TaskCreateRequest 已冻结，Task(created) 已落库',
    },
  },
  'n3-create-run': {
    time: '00:04',
    source: 'Coordinator',
    text: 'N3：Run 已创建（status=created），关联事件流就绪。',
    level: 'info',
  },
  'n4-claim': {
    time: '00:05',
    source: 'Coordinator',
    text: 'N4 task.claimed：Backend Eng A 已认领，签发 FileLease(write)。',
    level: 'info',
  },
  'n5-contextpack': {
    time: '00:07',
    source: 'Context · B',
    text: 'N5：ContextPack 构建完成，引用 RoleProfileRef + capability_tags。',
    level: 'info',
  },
  'n6-start-driver': {
    time: '00:09',
    source: 'Driver · A',
    text: 'N6 task.started：Driver Session 已启动（status=running）。',
    level: 'info',
    checkpoint: {
      label: 'Driver 启动',
      description: 'session_id 已绑定，进入执行节点',
    },
  },
  'n7-executing': {
    time: '00:14',
    source: 'Driver · A',
    text: 'N7 执行中：正在实现鉴权中间件与权限服务……可在此 Intervene。',
    level: 'info',
    checkpoint: {
      label: '执行节点',
      description: '可在此回溯并重试 Intervene 注入规则',
    },
  },
  'n8-driver-result': {
    time: '00:18',
    source: 'Driver · A',
    text: 'N8：DriverRunResult 返回 status=success，附带 transcript_ref。',
    level: 'success',
  },
  'n9-artifact': {
    time: '00:19',
    source: 'Coordinator',
    text: 'N9：已注册 Artifact（type=patch + test_log），生成 ArtifactRef。',
    level: 'info',
  },
  'n10-task-completed': {
    time: '00:20',
    source: 'Coordinator',
    text: 'N10 task.completed：任务进入 reviewing，触发 Hook 路由。',
    level: 'info',
    checkpoint: {
      label: '完成事件',
      description: 'task.completed 已 emit，即将进入 Gate 审查',
    },
  },
  'n11-hook-gate': {
    time: '00:22',
    source: 'Gate · D',
    text: 'N11/N12：HookEvent 命中 before_merge 检查点，生成 GateRequest。',
    level: 'info',
  },
  'n13-gate': {
    time: '00:24',
    source: 'Gate · D',
    text: 'N13 Gate 决策：decision=defer（权限策略分歧），落点 pending_council。',
    level: 'warning',
    checkpoint: {
      label: 'Gate=defer',
      description: 'Gate 判为 defer，升级到 Council 证据化裁决',
    },
  },
  'n14-council': {
    time: '00:26',
    source: 'Council',
    text: 'N14：MockCouncil 已就绪，3 套方案 + 证据已生成，等待用户裁决。',
    level: 'council',
    checkpoint: {
      label: 'Council 就绪',
      description: '多 Agent 方案已生成，等待用户选择 verdict',
    },
  },
  'n15-merge-auth': {
    time: '00:29',
    source: 'Coordinator',
    text: 'N15 task.before_merge：生成 MergeAuthorization（authorized=true）。',
    level: 'info',
  },
  'n16-checkpoint': {
    time: '00:30',
    source: 'Coordinator',
    text: 'N16 agent.checkpoint：已保存 Checkpoint（validity=valid）。',
    level: 'info',
  },
  'n17-merge-boundary': {
    time: '00:31',
    source: 'Merger',
    text: 'N17：合并边界 authorization_check → before_merge 通过（v0 reserved）。',
    level: 'info',
  },
  'n18-run-complete': {
    time: '00:32',
    source: 'Coordinator',
    text: 'N18：Run 落终态 completed，已生成 Delivery Report。',
    level: 'success',
    checkpoint: {
      label: 'Run 完成',
      description: '全链路执行完毕，可查看 Delivery Report',
    },
  },
};

export const interventionCheckpoint: TimelineCheckpoint = {
  label: '用户介入',
  description: '已注入业务规则，下游节点已标记为「已被介入」',
};

export const councilConfirmCheckpoint: TimelineCheckpoint = {
  label: '裁决完成',
  description: '用户已确认权限策略，流程回到主路径',
};
