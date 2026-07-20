/**
 * N0–N18 协议节点状态 —— **完全由后端事件流投影，不用任何硬编码的进度值**。
 *
 * 后端快照里有两个 `active_node_code`：`current.*` 由 registry 查表更新（表有 N6/N11/N14
 * 空洞），`flow.*` 是硬编码占位（`completed ? 'N18' : 'N8'`，与 timeline 无关）；
 * `flow.node_statuses` 只在终态存在，且 `event_type` 用的是另一套 PascalCase 命名。
 * 但这些节点对应的**事件在 RunEvent 时间线里全都真实存在** —— 所以这里用一张
 * 「dotted 事件类型 → 节点码」的纯函数表直接从 timeline 重建全部节点状态：
 * live / 终态同一条代码路径，事件到达即点亮。
 *
 * 表内容 = 后端两张映射表（run-registry EVENT_NODE_CODES ∪ frontend-run-snapshot
 * TIMELINE_NODE_CODES）的并集换成 dotted 命名。**不发明后端没有的映射**：
 * N0/N1/N4/N7/N12/N15/N17 在两套后端体系里都没有对应事件，永远 pending（见 reachable）。
 */
import type { RunEvent } from '@/api/types/rpc';

export type ProtocolNodeStatus = 'pending' | 'active' | 'done' | 'blocked';

export type ProtocolNode = {
  code: string;
  labelCn: string;
  /** 责任方（与 docs/protocol.md 的节点编号表一致） */
  ownerCn: string;
  /** false = 后端两套映射都没有对应事件，这个节点在今天的后端上永远不会点亮 */
  reachable: boolean;
  status: ProtocolNodeStatus;
  /** 最近一次点亮它的事件类型 / 时刻（D2 注解） */
  eventType?: string;
  time?: string;
};

/** N0–N18 目录（labels 与 src/docs/protocol.md「节点编号」一节逐字一致）。 */
const CATALOG: { code: string; labelCn: string; ownerCn: string }[] = [
  { code: 'N0', labelCn: '需求到达', ownerCn: '用户' },
  { code: 'N1', labelCn: '分诊', ownerCn: '调度' },
  { code: 'N2', labelCn: '创建 Task', ownerCn: '调度' },
  { code: 'N3', labelCn: '创建 Run', ownerCn: '调度' },
  { code: 'N4', labelCn: '认领任务', ownerCn: 'Agent' },
  { code: 'N5', labelCn: '构建 ContextPack', ownerCn: '记忆' },
  { code: 'N6', labelCn: '启动 Driver Session', ownerCn: 'Driver' },
  { code: 'N7', labelCn: '执行中', ownerCn: 'Driver' },
  { code: 'N8', labelCn: 'Driver 运行结果', ownerCn: 'Driver' },
  { code: 'N9', labelCn: '注册 Artifact', ownerCn: '调度' },
  { code: 'N10', labelCn: '完成事件', ownerCn: '调度' },
  { code: 'N11', labelCn: 'Hook 匹配', ownerCn: '安全检查' },
  { code: 'N12', labelCn: 'Gate 请求', ownerCn: '安全检查' },
  { code: 'N13', labelCn: 'Gate 决策', ownerCn: '安全检查' },
  { code: 'N14', labelCn: '议会（可选）', ownerCn: '调度' },
  { code: 'N15', labelCn: '合并授权', ownerCn: '调度' },
  { code: 'N16', labelCn: '保存 Checkpoint', ownerCn: '调度' },
  { code: 'N17', labelCn: '合并边界', ownerCn: '合并器' },
  { code: 'N18', labelCn: 'Run 完成', ownerCn: '调度' },
];

/** dotted 事件类型 → 节点码（后端两张表的并集；表外事件不点亮任何节点）。 */
const EVENT_NODE: Record<string, string> = {
  'task.created': 'N2',
  'run.created': 'N3',
  'run.started': 'N3',
  'memory.context_pack_built': 'N5',
  'driver.session_started': 'N6',
  'driver.run_result': 'N8',
  'artifact.registered': 'N9',
  'task.completed': 'N10',
  'hook.matched': 'N11',
  'gate.result': 'N13',
  'council.started': 'N14',
  'council.proposal.completed': 'N14',
  'council.review.completed': 'N14',
  'council.synthesis.completed': 'N14',
  'council.decision': 'N14',
  'council.completed': 'N14',
  'council.failed': 'N14',
  'checkpoint.saved': 'N16',
  'coord.checkpoint_observed': 'N16',
  'run.completed': 'N18',
  'run.failed': 'N18',
  'run.cancelled': 'N18',
};

const REACHABLE = new Set(Object.values(EVENT_NODE));

const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

/** 该事件是否表示失败（与 eventGraph.statusOf 同款判定：类型后缀或 payload.status）。 */
const isFailure = (event: RunEvent): boolean =>
  event.type.endsWith('.failed') || asRecord(event.payload).status === 'failed';

/**
 * timeline → 19 个协议节点的状态。
 *
 * - 命中映射的事件点亮对应节点：失败类 → blocked，其余 → done；
 * - run 进行中时，最近一次点亮事件所在的节点为 active（blocked 不被覆盖）；
 * - 没点亮 → pending。
 */
export function projectProtocolFlow(
  timeline: RunEvent[],
  runStatus: 'running' | 'completed' | 'failed' | 'cancelled',
): ProtocolNode[] {
  const byCode = new Map<string, RunEvent[]>();
  let latest: { code: string; sequence: number } | undefined;

  for (const event of timeline) {
    const code = EVENT_NODE[event.type];
    if (!code) continue;
    const list = byCode.get(code) ?? [];
    list.push(event);
    byCode.set(code, list);
    if (!latest || event.sequence > latest.sequence) latest = { code, sequence: event.sequence };
  }

  return CATALOG.map(({ code, labelCn, ownerCn }) => {
    const events = byCode.get(code);
    if (!events || events.length === 0) {
      return { code, labelCn, ownerCn, reachable: REACHABLE.has(code), status: 'pending' as const };
    }
    const last = events[events.length - 1];
    const blocked = events.some(isFailure);
    const active = runStatus === 'running' && latest?.code === code && !blocked;
    return {
      code,
      labelCn,
      ownerCn,
      reachable: true,
      status: blocked ? ('blocked' as const) : active ? ('active' as const) : ('done' as const),
      eventType: last.type,
      time: last.created_at.slice(11, 19),
    };
  });
}

/** D1 那一行：run 进行中 → 当前节点；终态 → 最后点亮的节点。没有任何点亮 → undefined。 */
export function activeProtocolNode(nodes: ProtocolNode[]): ProtocolNode | undefined {
  return (
    nodes.find((n) => n.status === 'active') ??
    [...nodes].reverse().find((n) => n.status !== 'pending')
  );
}
