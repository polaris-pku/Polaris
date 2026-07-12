import type { NodeExecutionLogDetail } from '@/types';

/**
 * 各 workflow 节点（N0–N18）的详细执行日志（mock）。
 * 在 Node Inspector 的「节点执行日志」面板中展示。
 */
export const nodeExecutionLogs: Record<string, NodeExecutionLogDetail> = {
  'n0-intake': {
    duration: '0.4s',
    tokenUsage: '—',
    lines: [
      {
        time: '00:00:42',
        tag: 'INTAKE',
        message: '接收用户原始需求文本 raw_spec_text',
        level: 'info',
      },
      {
        time: '00:00:42',
        tag: 'META',
        message: 'submitted_at / submitter / attachments 字段待冻结（TBD）',
        level: 'debug',
      },
      { time: '00:00:43', tag: 'DONE', message: '需求入队，移交 N1 Triage 分诊', level: 'success' },
    ],
  },
  'n1-triage': {
    duration: '1.6s',
    tokenUsage: '640 tokens',
    lines: [
      {
        time: '00:01:02',
        tag: 'ANALYZE',
        message: '解析需求关键词：权限校验、登录态、测试覆盖',
        level: 'info',
      },
      {
        time: '00:01:03',
        tag: 'RISK',
        message: 'risk_level = medium（涉及鉴权与越权面）',
        level: 'warning',
      },
      {
        time: '00:01:04',
        tag: 'PATHS',
        message: 'affected_paths：authMiddleware.ts / permissionService.ts',
        level: 'info',
      },
      {
        time: '00:01:05',
        tag: 'ROLE',
        message: '建议 role_id = backend，附 completion_criteria 草案',
        level: 'info',
      },
      {
        time: '00:01:05',
        tag: 'DONE',
        message: '生成 TaskCreateRequest 草案（结果结构 TBD）',
        level: 'success',
      },
    ],
  },
  'n2-create-task': {
    duration: '0.8s',
    tokenUsage: '210 tokens',
    lines: [
      {
        time: '00:01:22',
        tag: 'CREATE',
        message: '_coord.task.create → task_id=TASK-AUTH-017',
        level: 'info',
      },
      { time: '00:01:22', tag: 'STATUS', message: 'status = created', level: 'info' },
      {
        time: '00:01:23',
        tag: 'CRIT',
        message: 'completion_criteria：未授权拦截 100% / Admin 边界明确',
        level: 'info',
      },
      { time: '00:01:23', tag: 'EMIT', message: 'emit task.created', level: 'success' },
    ],
  },
  'n3-create-run': {
    duration: '0.5s',
    tokenUsage: '120 tokens',
    lines: [
      {
        time: '00:01:31',
        tag: 'CREATE',
        message: '_coord.run.create → run_id=RUN-7741',
        level: 'info',
      },
      { time: '00:01:31', tag: 'STATUS', message: 'status = created，绑定 task_id', level: 'info' },
      { time: '00:01:32', tag: 'DONE', message: 'event_ids 关联就绪', level: 'success' },
    ],
  },
  'n4-claim': {
    duration: '0.7s',
    tokenUsage: '180 tokens',
    lines: [
      {
        time: '00:01:44',
        tag: 'CLAIM',
        message: '_coord.task.claim → owner_agent_id=backend-a',
        level: 'info',
      },
      {
        time: '00:01:44',
        tag: 'AGENT',
        message: 'AgentRecord：role_id=backend / driver_id=claude-code',
        level: 'info',
      },
      {
        time: '00:01:45',
        tag: 'LEASE',
        message: 'FileLease：src/auth/** · scope=write · status=active',
        level: 'info',
      },
      {
        time: '00:01:45',
        tag: 'EMIT',
        message: 'emit task.claimed（status=claimed）',
        level: 'success',
      },
    ],
  },
  'n5-contextpack': {
    duration: '2.3s',
    tokenUsage: '1,180 tokens',
    lines: [
      {
        time: '00:02:02',
        tag: 'PACK',
        message: '构建 ContextPack → context_pack_id=CTX-3318',
        level: 'info',
      },
      {
        time: '00:02:03',
        tag: 'PROFILE',
        message: '引用 role_profile_id（B 角色画像）',
        level: 'info',
      },
      {
        time: '00:02:04',
        tag: 'TAGS',
        message: 'capability_tags：auth, rbac, testing',
        level: 'debug',
      },
      {
        time: '00:02:05',
        tag: 'TBD',
        message: 'persona_ref / skill_refs 引用格式待 B 定',
        level: 'warning',
      },
      { time: '00:02:05', tag: 'DONE', message: 'ContextPackRef 就绪', level: 'success' },
    ],
  },
  'n6-start-driver': {
    duration: '1.1s',
    tokenUsage: '—',
    lines: [
      {
        time: '00:02:22',
        tag: 'START',
        message: '启动 Driver Session → session_id=SES-9920',
        level: 'info',
      },
      { time: '00:02:22', tag: 'DRIVER', message: 'driver_id = claude-code', level: 'debug' },
      {
        time: '00:02:23',
        tag: 'EMIT',
        message: 'emit task.started（status=running）',
        level: 'success',
      },
    ],
  },
  'n7-executing': {
    duration: '—',
    tokenUsage: '—',
    lines: [
      {
        time: '00:03:42',
        tag: 'INIT',
        message: 'Driver 开始执行，加载 ContextPack 与实现计划',
        level: 'info',
      },
      {
        time: '00:03:45',
        tag: 'EDIT',
        message: '创建 authMiddleware.ts — 登录态解析中间件',
        level: 'info',
      },
      {
        time: '00:03:52',
        tag: 'EDIT',
        message: '创建 permissionService.ts — 角色权限判断服务',
        level: 'info',
      },
      {
        time: '00:04:01',
        tag: 'EDIT',
        message: '更新 userRole.ts — 扩展 Admin / Member 角色枚举',
        level: 'info',
      },
      {
        time: '00:04:08',
        tag: 'RETRY',
        message: 'retry_state：attempt 1 / max 3 · exhausted=false',
        level: 'debug',
      },
      {
        time: '00:04:12',
        tag: 'RUN',
        message: '等待用户介入或继续推进（tool_events 实时流待 A 定）',
        level: 'info',
      },
    ],
  },
  'n8-driver-result': {
    duration: '0.6s',
    tokenUsage: '—',
    lines: [
      {
        time: '00:04:40',
        tag: 'RESULT',
        message: 'DriverRunResult：status=success',
        level: 'success',
      },
      {
        time: '00:04:40',
        tag: 'REF',
        message: 'transcript_ref → artifact://transcript/SES-9920',
        level: 'debug',
      },
      {
        time: '00:04:41',
        tag: 'DONE',
        message: '结果移交 C 侧消费入口（其余字段 TBD）',
        level: 'info',
      },
    ],
  },
  'n9-artifact': {
    duration: '0.9s',
    tokenUsage: '240 tokens',
    lines: [
      {
        time: '00:04:52',
        tag: 'REG',
        message: '_coord.artifact.register → artifact_id=ART-5512',
        level: 'info',
      },
      {
        time: '00:04:52',
        tag: 'TYPE',
        message: 'type=patch · producer_type=driver',
        level: 'info',
      },
      {
        time: '00:04:53',
        tag: 'REG',
        message: '追加 type=test_log（28 passed / 0 failed）',
        level: 'info',
      },
      { time: '00:04:53', tag: 'DONE', message: 'ArtifactRef 就绪，附 sha256', level: 'success' },
    ],
  },
  'n10-task-completed': {
    duration: '0.3s',
    tokenUsage: '—',
    lines: [
      {
        time: '00:05:02',
        tag: 'EMIT',
        message: 'emit task.completed（event_id=EVT-8830）',
        level: 'info',
      },
      { time: '00:05:02', tag: 'STATUS', message: 'status = reviewing', level: 'info' },
      { time: '00:05:03', tag: 'ROUTE', message: '交由 D 方向 Hook 进行路由', level: 'success' },
    ],
  },
  'n11-hook-gate': {
    duration: '0.5s',
    tokenUsage: '160 tokens',
    lines: [
      {
        time: '00:05:12',
        tag: 'HOOK',
        message: 'HookEvent(task.completed) 命中检查点',
        level: 'info',
      },
      {
        time: '00:05:12',
        tag: 'POINT',
        message: 'matched_hook_point = before_merge',
        level: 'info',
      },
      {
        time: '00:05:13',
        tag: 'REQ',
        message: '生成 GateRequest，subject_id=ART-5512',
        level: 'success',
      },
    ],
  },
  'n13-gate': {
    duration: '1.4s',
    tokenUsage: '880 tokens',
    lines: [
      {
        time: '00:05:22',
        tag: 'EVAL',
        message: '评估 GateRequest：检出 ACL vs RBAC 策略分歧',
        level: 'info',
      },
      {
        time: '00:05:23',
        tag: 'DECIDE',
        message: 'decision = defer（需证据化决策）',
        level: 'warning',
      },
      {
        time: '00:05:23',
        tag: 'STATE',
        message: 'target_state = pending_council',
        level: 'warning',
      },
      {
        time: '00:05:24',
        tag: 'AUDIT',
        message: '写入 audit_ref，emit lifecycle.human_gate',
        level: 'info',
      },
      { time: '00:05:24', tag: 'DONE', message: '升级到 Council 证据化裁决', level: 'council' },
    ],
  },
  'n14-council': {
    duration: '—',
    tokenUsage: '—',
    lines: [
      {
        time: '00:07:02',
        tag: 'INIT',
        message: 'MockCouncil 启动，加载 3 套候选方案',
        level: 'council',
      },
      {
        time: '00:07:05',
        tag: 'PROPOSE',
        message: 'Backend Eng A 提出 Option A · RBAC',
        level: 'info',
      },
      {
        time: '00:07:08',
        tag: 'PROPOSE',
        message: 'Frontend Eng B 提出 Option B · Feature Flag',
        level: 'info',
      },
      {
        time: '00:07:11',
        tag: 'PROPOSE',
        message: 'Security Agent 提出 Option C · Hybrid',
        level: 'info',
      },
      {
        time: '00:07:14',
        tag: 'EVIDENCE',
        message: 'evidence_refs 已附（N-way Diff 后置）',
        level: 'debug',
      },
      {
        time: '00:07:15',
        tag: 'WAIT',
        message: '等待用户在 Council Board 选择 verdict',
        level: 'council',
      },
    ],
  },
  'n15-merge-auth': {
    duration: '0.6s',
    tokenUsage: '150 tokens',
    lines: [
      {
        time: '00:07:42',
        tag: 'AUTH',
        message: '生成 MergeAuthorization → authorized=true',
        level: 'info',
      },
      {
        time: '00:07:42',
        tag: 'SRC',
        message: 'source = human_delegated（基于 CouncilDecision）',
        level: 'info',
      },
      {
        time: '00:07:43',
        tag: 'SCOPE',
        message: 'target_branch=main · allowed_paths=src/auth/**',
        level: 'info',
      },
      { time: '00:07:43', tag: 'EMIT', message: 'emit task.before_merge', level: 'success' },
    ],
  },
  'n16-checkpoint': {
    duration: '0.7s',
    tokenUsage: '—',
    lines: [
      {
        time: '00:07:52',
        tag: 'CKPT',
        message: '_coord.state.checkpoint → checkpoint_id=CKPT-2207',
        level: 'info',
      },
      { time: '00:07:52', tag: 'TRIG', message: 'trigger = gate_result', level: 'debug' },
      {
        time: '00:07:53',
        tag: 'SNAP',
        message: 'mechanical_snapshot + semantic_handoff 已保存',
        level: 'info',
      },
      {
        time: '00:07:53',
        tag: 'VALID',
        message: 'validity_status = valid，emit agent.checkpoint',
        level: 'success',
      },
    ],
  },
  'n17-merge-boundary': {
    duration: '1.0s',
    tokenUsage: '—',
    lines: [
      {
        time: '00:08:02',
        tag: 'BOUND',
        message: 'merge_requested → authorization_check ✓',
        level: 'info',
      },
      { time: '00:08:03', tag: 'GATE', message: 'gate_refs_check ✓', level: 'info' },
      {
        time: '00:08:03',
        tag: 'TRIAL',
        message: 'trial_merge / integrated（v0 reserved）',
        level: 'debug',
      },
      { time: '00:08:04', tag: 'DONE', message: 'before_merge 通过', level: 'success' },
    ],
  },
  'n18-run-complete': {
    duration: '1.2s',
    tokenUsage: '320 tokens',
    lines: [
      {
        time: '00:08:42',
        tag: 'AGG',
        message: '汇总 ArtifactRef · 测试 · 介入记录 · CouncilDecision',
        level: 'info',
      },
      {
        time: '00:08:44',
        tag: 'COMPLETE',
        message: '_coord.run.complete → status=completed',
        level: 'info',
      },
      { time: '00:08:45', tag: 'REPORT', message: '生成 Delivery Report v1.0', level: 'info' },
      {
        time: '00:08:46',
        tag: 'EMIT',
        message: 'emit task.completed，建议复核 Admin 权限范围',
        level: 'success',
      },
    ],
  },
};

/** 用户介入相关的动态日志行 */
export function buildInterventionLogLines(ruleText: string) {
  return [
    {
      time: '00:04:15',
      tag: 'INTERVENE',
      message: `收到用户介入规则：${ruleText}`,
      level: 'warning' as const,
    },
    {
      time: '00:04:16',
      tag: 'SYNC',
      message: '规则已同步至 Coding / Test / Security Agent 上下文',
      level: 'info' as const,
    },
    {
      time: '00:04:17',
      tag: 'APPLY',
      message: '下游 Gate / 合并授权 / Run 完成 节点已标记「已被介入」',
      level: 'warning' as const,
    },
  ];
}

/** Council 裁决确认后的动态日志行 */
export function buildCouncilConfirmLogLines(optionLabel: string) {
  return [
    {
      time: '00:07:28',
      tag: 'DECIDE',
      message: `用户确认 verdict=select：${optionLabel}`,
      level: 'council' as const,
    },
    {
      time: '00:07:29',
      tag: 'APPLY',
      message: 'RBAC 策略已写入 permissionService 配置',
      level: 'success' as const,
    },
    {
      time: '00:07:30',
      tag: 'DONE',
      message: 'CouncilDecision 回写，流程回到主路径',
      level: 'success' as const,
    },
  ];
}

/** 受介入影响但尚未执行的节点提示行 */
export function buildUpdatedPendingLines() {
  return [
    {
      time: '—',
      tag: 'PENDING',
      message: '节点尚未开始执行，但已收到用户介入规则，启动时将自动应用',
      level: 'warning' as const,
    },
  ];
}
