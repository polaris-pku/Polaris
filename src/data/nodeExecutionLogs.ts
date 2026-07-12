/**
 * 节点执行日志的动态构造器。
 *
 * 真实 run 的节点执行日志来自后端事件（见 lib/liveReplay.ts 的 nodeExecLogs），不在此文件。
 * 这里只保留几个「由当前 UI 状态派生日志行」的纯函数（用户介入 / Council 确认 / 待执行提示）。
 */

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
