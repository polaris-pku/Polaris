/**
 * 由**后端事件**生成泳道图 —— 触发了什么就展示什么，没发生的不出现。
 *
 * 为什么不再用 N0–N18 固定模板：
 *  - 一次 run 不一定触发所有节点。实测单 agent 模式下 N1（分诊）与 N14（议会）**永远不亮** ——
 *    前者后端根本没这一步，后者要 council 模式才有。它们灰着占位，看起来像「没跑完」，
 *    实际是「不适用」。把事件硬塞进模板，就必然产生这种永久空位。
 *  - 后端新增事件类型时，模板要跟着改；事件驱动则天然容纳。
 *
 * 附带把「时间」带了回来：有开始/结束成对的事件（agent 执行、议会）合并成**跨度节点**，
 * 带真实耗时。原来的节点图把 15 秒的 agent 执行画得和一个 0 毫秒的 mailbox 一样大 ——
 * 而那 15 秒恰恰是整次 run 的 99%。
 */
import type { RunEvent } from '@/api/types/rpc';
import type { PhaseKey } from '@/data/workflow';
import type { Lane, NodeDirection, NodeTier, WorkflowNodeData, WorkflowNodeStatus } from '@/types';

export type LiveRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/** 一个节点背后的原始事件（一个或多个：跨度节点、同类连续事件合并） */
export type EventGroup = {
  nodeId: string;
  events: RunEvent[];
  /** 跨度节点：开始事件已到、结束事件未到 → 该节点正在进行中 */
  open: boolean;
};

// ── 事件词表 ──

type EventMeta = {
  /** 中文名（展示用；取不到就退回事件类型原文，不编造） */
  labelCn: string;
  tier: NodeTier;
  phase: PhaseKey;
  /** 对应主链路 N 编号（有就标，纯展示；没有就用序号） */
  code?: string;
};

const EVENT_META: Record<string, EventMeta> = {
  'task.created': { labelCn: '创建 Task', tier: 'milestone', phase: 'intake', code: 'N2' },
  'run.created': { labelCn: '创建 Run', tier: 'machine', phase: 'intake', code: 'N3' },
  'run.started': { labelCn: 'Run 启动', tier: 'machine', phase: 'intake', code: 'N3' },
  'mailbox.message_sent': { labelCn: '消息投递', tier: 'machine', phase: 'execution' },
  'mailbox.message_acked': { labelCn: '消息确认', tier: 'machine', phase: 'execution' },
  'memory.context_pack_built': {
    labelCn: '构建 ContextPack',
    tier: 'machine',
    phase: 'execution',
    code: 'N5',
  },
  'driver.session_started': {
    labelCn: '启动 Driver Session',
    tier: 'machine',
    phase: 'execution',
    code: 'N6',
  },
  'agent.execution_requested': {
    labelCn: 'Agent 执行',
    tier: 'human',
    phase: 'execution',
    code: 'N7',
  },
  'driver.run_result': {
    labelCn: 'Driver 运行结果',
    tier: 'machine',
    phase: 'execution',
    code: 'N8',
  },
  'artifact.registered': {
    labelCn: '注册 Artifact',
    tier: 'milestone',
    phase: 'execution',
    code: 'N9',
  },
  'task.completed': { labelCn: 'Task 完成', tier: 'machine', phase: 'review', code: 'N10' },
  'hook.matched': { labelCn: 'Hook 匹配', tier: 'machine', phase: 'review', code: 'N11' },
  'gate.requested': { labelCn: 'Gate 请求', tier: 'machine', phase: 'review', code: 'N12' },
  'gate.result': { labelCn: 'Gate 决策', tier: 'human', phase: 'review', code: 'N13' },
  'council.started': { labelCn: '议会', tier: 'human', phase: 'review', code: 'N14' },
  'council.decision': { labelCn: '议会决策', tier: 'human', phase: 'review', code: 'N14' },
  'artifact.selected': { labelCn: '选定产物', tier: 'milestone', phase: 'delivery', code: 'N15' },
  'checkpoint.saved': {
    labelCn: '保存 Checkpoint',
    tier: 'milestone',
    phase: 'delivery',
    code: 'N16',
  },
  'coord.checkpoint_observed': {
    labelCn: 'Checkpoint 观测',
    tier: 'machine',
    phase: 'delivery',
    code: 'N16',
  },
  'worktree.materialized': {
    labelCn: '物化 Worktree',
    tier: 'machine',
    phase: 'delivery',
    code: 'N17',
  },
  'run.completed': { labelCn: 'Run 完成', tier: 'milestone', phase: 'delivery', code: 'N18' },
  'run.failed': { labelCn: 'Run 失败', tier: 'milestone', phase: 'delivery', code: 'N18' },
  'run.cancelled': { labelCn: 'Run 取消', tier: 'milestone', phase: 'delivery', code: 'N18' },
};

/** 未登记的事件类型：不丢弃、不编造 —— 原样展示类型名，归到当前阶段的机器层。 */
function metaOf(type: string): EventMeta {
  return EVENT_META[type] ?? { labelCn: type, tier: 'machine', phase: 'review' };
}

/**
 * 成对事件 → 跨度节点。
 * 开始事件到了、结束事件还没到 = agent 此刻正在做这件事（那 15 秒的真相）。
 */
const SPANS: Record<string, { ends: string[]; keyOf: (e: RunEvent) => string }> = {
  'agent.execution_requested': {
    ends: ['agent.execution_completed', 'agent.execution_failed'],
    keyOf: (e) => String((e.payload as { role_id?: unknown }).role_id ?? ''),
  },
  'council.started': { ends: ['council.completed'], keyOf: () => '' },
};

const SPAN_END_TYPES = new Set(Object.values(SPANS).flatMap((s) => s.ends));

// ── 泳道与责任方（由 event.source 决定，不预设）──

const DIRECTION_BY_SOURCE: Record<string, NodeDirection> = {
  coordinator: 'C',
  memory: 'B',
  driver: 'A',
  agent: 'A',
  gate: 'D',
  council: 'C',
};

const LANE_BY_SOURCE: Record<string, Lane> = {
  coordinator: 'System',
  memory: 'Memory',
  driver: 'Driver',
  gate: 'Security',
  council: 'Council',
};

/** agent 事件按 role_id 分泳道 —— 后端派几个角色就有几条，前端不预设条数。 */
function laneOf(event: RunEvent): Lane {
  if (event.source === 'agent') {
    const roleId = (event.payload as { role_id?: unknown }).role_id;
    return typeof roleId === 'string' && roleId ? roleId : 'Agent';
  }
  return LANE_BY_SOURCE[event.source] ?? 'System';
}

// ── 分组 ──

/** payload 摘要（原文，不叙事化） */
function payloadText(payload: Record<string, unknown>): string {
  return Object.entries(payload)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' · ');
}

/**
 * 事件流 → 分组。
 *  - 成对事件合成跨度节点（开始+结束）
 *  - 同源同类的**连续**事件合并（如一次注册 2 个 artifact → 一个节点，不铺两个）
 */
export function groupEvents(events: RunEvent[]): EventGroup[] {
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
  const groups: EventGroup[] = [];
  /** 待配对的跨度组：`${startType}|${key}` → group */
  const openSpans = new Map<string, EventGroup>();

  for (const event of sorted) {
    // 跨度结束事件：并回它的开始节点，不单独成节点
    if (SPAN_END_TYPES.has(event.type)) {
      const matched = [...openSpans.entries()].find(([mapKey, group]) => {
        const startType = mapKey.split('|')[0];
        const span = SPANS[startType];
        return (
          span.ends.includes(event.type) && mapKey === `${startType}|${span.keyOf(group.events[0])}`
        );
      });
      if (matched) {
        matched[1].events.push(event);
        matched[1].open = false;
        openSpans.delete(matched[0]);
        continue;
      }
      // 没有配上开始事件（理论上不该发生）→ 独立成节点，不丢
    }

    const span = SPANS[event.type];
    if (span) {
      const group: EventGroup = { nodeId: `ev-${event.event_id}`, events: [event], open: true };
      groups.push(group);
      openSpans.set(`${event.type}|${span.keyOf(event)}`, group);
      continue;
    }

    // 同源同类的连续事件合并
    const prev = groups[groups.length - 1];
    if (
      prev &&
      !prev.open &&
      prev.events[0].type === event.type &&
      prev.events[0].source === event.source
    ) {
      prev.events.push(event);
      continue;
    }

    groups.push({ nodeId: `ev-${event.event_id}`, events: [event], open: false });
  }

  return groups;
}

// ── 建图 ──

function statusOf(group: EventGroup, runStatus: LiveRunStatus): WorkflowNodeStatus {
  const first = group.events[0];
  const last = group.events[group.events.length - 1];
  // 跨度未闭合：run 还在跑 → 这就是 agent 此刻正在做的事
  if (group.open) return runStatus === 'running' ? 'active' : 'blocked';
  if (last.type.endsWith('.failed') || first.type.endsWith('.failed')) return 'blocked';
  return 'done';
}

/** 跨度耗时（毫秒）；未闭合或非跨度节点返回 undefined。 */
function durationOf(group: EventGroup): number | undefined {
  if (group.events.length < 2 || !SPANS[group.events[0].type]) return undefined;
  const start = group.events[0];
  const end = group.events[group.events.length - 1];
  return new Date(end.created_at).getTime() - new Date(start.created_at).getTime();
}

const fmtDuration = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

/**
 * 由事件生成泳道图节点。
 *
 * 列 = 事件顺序（后端的 sequence 是权威顺序）；泳道 = 事件来源；连线 = 顺序链。
 * 没有事件的东西不会出现 —— 这是与旧模板最根本的差别。
 */
export function buildEventGraph(
  events: RunEvent[],
  runStatus: LiveRunStatus,
): { nodes: WorkflowNodeData[]; groups: EventGroup[] } {
  const groups = groupEvents(events);

  const nodes: WorkflowNodeData[] = groups.map((group, index) => {
    const first = group.events[0];
    const meta = metaOf(first.type);
    const status = statusOf(group, runStatus);
    const durationMs = durationOf(group);
    const count = group.events.length;

    // 中文名带上「本次的事实」：跨度耗时 / 合并条数 —— 这些都是后端给的，不是编的
    const suffix = durationMs !== undefined ? ` · ${fmtDuration(durationMs)}` : '';
    const merged = !SPANS[first.type] && count > 1 ? ` ×${String(count)}` : '';

    return {
      id: group.nodeId,
      code: meta.code ?? `#${String(first.sequence)}`,
      label: first.type,
      labelCn: `${meta.labelCn}${merged}${suffix}`,
      lane: laneOf(first),
      direction: DIRECTION_BY_SOURCE[first.source] ?? 'C',
      column: index,
      tier: meta.tier,
      phase: meta.phase,
      deps: index > 0 ? [groups[index - 1].nodeId] : [],
      owner: first.source,
      status,
      taskStatus: null,
      // 跨度未闭合 → 让节点卡展示实时计时（那 15 秒界面不能是死的）
      ...(group.open ? { spanStartedAt: first.created_at } : {}),
      frozen: 'frozen' as const,
      summary: payloadText(first.payload) || first.type,
      // 后端事件没有「输入/输出/风险/下一步」这些模板字段 —— 不虚构，留空
      input: [],
      output: [],
      decided: Object.entries(first.payload).map(([key, value]) => ({
        key,
        desc: typeof value === 'string' ? value : JSON.stringify(value),
      })),
      tbd: [],
      events: [...new Set(group.events.map((e) => e.type))],
      risk: '',
      nextAction: '',
    };
  });

  return { nodes, groups };
}
