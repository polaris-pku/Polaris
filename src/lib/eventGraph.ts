/**
 * 由后端事件派生**人能读懂的执行步骤** —— 不是「一个事件一个节点」。
 *
 * 为什么要再抽象一层：一次 run 后端发 22 个事件，但人真正关心的只有六件事 ——
 * 需求受理了吗 / 谁接的 / agent 在干活吗、干了多久 / 产出了什么 / 有没有被拦住 / 交付了吗。
 * 把 `mailbox.message_acked` 这种管道事件画成节点，是拿机器的语言对人说话。
 *
 * 所以：**事件 → 语义步骤**。多个事件汇聚成一步，原始事件一条不丢（全部收进 Inspector）。
 * 仍然 100% 由事件派生 —— 一个步骤只有在**有事件佐证**时才存在，没触发的步骤压根不出现
 * （单 agent 模式下就没有「议会」这一步）。
 *
 * 时间也回来了：agent 执行是一个**跨度**（requested→completed），带真实耗时；
 * 未闭合时节点上有实时秒表 —— 后端在 agent 干活的十几秒里一个事件都不发，
 * 没有它，界面在最关键的时段是死的。
 */
import type { RunEvent } from '@/api/types/rpc';
import type { PhaseKey } from '@/data/workflow';
import type { Lane, NodeDirection, NodeTier, WorkflowNodeData, WorkflowNodeStatus } from '@/types';

export type LiveRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/** 一个步骤背后的原始事件（Inspector 里逐条可查，一条不丢） */
export type EventGroup = {
  nodeId: string;
  events: RunEvent[];
  /** 跨度步骤：开始事件已到、结束事件未到 → agent 此刻正在做这件事 */
  open: boolean;
};

// ── 语义步骤定义 ──

type StepKey = 'intake' | 'prepare' | 'execute' | 'produce' | 'review' | 'council' | 'deliver';

type StepDef = {
  labelCn: string;
  label: string;
  tier: NodeTier;
  phase: PhaseKey;
  direction: NodeDirection;
  /** 按 agent 角色分身：后端派几个角色，这一步就有几个节点（多 agent 时扇出成多条泳道） */
  perAgent: boolean;
  lane: Lane;
};

const STEPS: Record<StepKey, StepDef> = {
  intake: {
    labelCn: '需求受理',
    label: 'Intake',
    tier: 'milestone',
    phase: 'intake',
    direction: 'C',
    perAgent: false,
    lane: 'System',
  },
  prepare: {
    labelCn: '分派与上下文',
    label: 'Dispatch',
    tier: 'machine',
    phase: 'execution',
    direction: 'B',
    perAgent: true,
    lane: 'Memory',
  },
  execute: {
    labelCn: 'Agent 执行',
    label: 'Agent Work',
    tier: 'human',
    phase: 'execution',
    direction: 'A',
    perAgent: true,
    lane: 'Agent',
  },
  produce: {
    labelCn: '产出',
    label: 'Artifacts',
    tier: 'milestone',
    phase: 'execution',
    direction: 'A',
    perAgent: false,
    lane: 'Driver',
  },
  review: {
    labelCn: '审查',
    label: 'Review',
    tier: 'human',
    phase: 'review',
    direction: 'D',
    perAgent: false,
    lane: 'Security',
  },
  council: {
    labelCn: '议会',
    label: 'Council',
    tier: 'human',
    phase: 'review',
    direction: 'C',
    perAgent: false,
    lane: 'Council',
  },
  deliver: {
    labelCn: '交付',
    label: 'Delivery',
    tier: 'milestone',
    phase: 'delivery',
    direction: 'C',
    perAgent: false,
    lane: 'System',
  },
};

/** 事件 → 步骤。mailbox 靠 payload.message_type 细分（后端就是这么标的）。 */
function stepOf(event: RunEvent): StepKey | undefined {
  const messageType = String((event.payload as { message_type?: unknown }).message_type ?? '');
  switch (event.type) {
    case 'task.created':
    case 'run.created':
    case 'run.started':
      return 'intake';

    case 'memory.context_pack_built':
    case 'driver.session_started':
      return 'prepare';
    case 'mailbox.message_sent':
    case 'mailbox.message_acked':
      if (messageType === 'driver.completed') return 'produce';
      return 'prepare';

    case 'agent.execution_requested':
    case 'agent.execution_completed':
    case 'agent.execution_failed':
      return 'execute';

    case 'driver.run_result':
    case 'artifact.registered':
      return 'produce';

    case 'task.completed':
    case 'hook.matched':
    case 'gate.requested':
    case 'gate.result':
      return 'review';

    case 'council.started':
    case 'council.decision':
    case 'council.completed':
      return 'council';

    case 'artifact.selected':
    case 'worktree.materialized':
    case 'checkpoint.saved':
    case 'coord.checkpoint_observed':
    case 'run.completed':
    case 'run.failed':
    case 'run.cancelled':
      return 'deliver';

    // 未登记的事件类型：不丢弃、不编造 —— 收进「审查」步骤，原始事件在 Inspector 里可查
    default:
      return 'review';
  }
}

/** 跨度：开始事件到了、结束事件还没到 = 这一步正在进行中 */
const SPAN_STARTS = new Set(['agent.execution_requested', 'council.started']);
const SPAN_ENDS = new Set([
  'agent.execution_completed',
  'agent.execution_failed',
  'council.completed',
]);

// ── 角色归属 ──

const roleIdOf = (event: RunEvent): string =>
  String((event.payload as { role_id?: unknown }).role_id ?? '');

/**
 * 事件属于哪个 agent 角色。
 *
 * 只有部分事件自带 role_id（context_pack / agent.execution_*）；mailbox、driver.session_started
 * 这类管道事件没有。它们按**最近的带角色事件**归属（优先向后找，其次向前）——
 * 这是「展示位置」的路由决定（E 的自由度），不产生后端没说过的内容。
 */
function resolveRoles(events: RunEvent[]): Map<string, string> {
  const roleByEventId = new Map<string, string>();
  const own = events.map(roleIdOf);

  events.forEach((event, index) => {
    if (own[index]) {
      roleByEventId.set(event.event_id, own[index]);
      return;
    }
    const next = own.slice(index + 1).find(Boolean);
    const prev = [...own.slice(0, index)].reverse().find(Boolean);
    roleByEventId.set(event.event_id, next ?? prev ?? '');
  });

  return roleByEventId;
}

// ── 展示文案（全部取自后端 payload，不叙事化）──

const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

/** payload 值 → 展示文本。数组展平成逗号串，不把 JSON 括号甩给用户看。 */
const text = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join(', ');
  return JSON.stringify(v);
};

const fmtDuration = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${String(ms)}ms`);

/** 从某个事件类型的 payload 里取一个字段 */
function pick(events: RunEvent[], type: string, key: string): string {
  const event = events.find((e) => e.type === type);
  return event ? text(asRecord(event.payload)[key]) : '';
}

/** 该步骤的「关键事实」一行 —— 人扫一眼就知道这步发生了什么。 */
function summaryOf(step: StepKey, events: RunEvent[]): string {
  switch (step) {
    case 'intake': {
      const spec = pick(events, 'task.created', 'spec');
      const risk = pick(events, 'task.created', 'risk_level');
      return [spec, risk && `风险 ${risk}`].filter(Boolean).join(' · ');
    }
    case 'prepare': {
      const driver = pick(events, 'driver.session_started', 'driver_id');
      const refs = pick(events, 'memory.context_pack_built', 'memory_refs');
      return [refs && `ContextPack ${refs}`, driver && `driver=${driver}`]
        .filter(Boolean)
        .join(' · ');
    }
    case 'execute': {
      const status = events.find((e) => e.type.startsWith('agent.execution_c'))?.payload;
      return status ? text(asRecord(status).status) : '执行中';
    }
    case 'produce': {
      const artifacts = events.filter((e) => e.type === 'artifact.registered');
      // 只有 diff 产物是「agent 写出的代码」；transcript 产物的 uri 尾段是 session id，
      // 不是文件名 —— 混进来就成了一串没人看得懂的乱码。
      const files = artifacts
        .filter((e) => text(asRecord(e.payload).type) === 'diff')
        .map((e) => {
          const uri = text(asRecord(e.payload).uri);
          try {
            return decodeURIComponent(uri.split('/').pop() ?? '')
              .split('/')
              .pop();
          } catch {
            return '';
          }
        })
        .filter((name): name is string => !!name);

      const others = artifacts.length - files.length;
      return (
        [files.join(' · '), others > 0 && `+${String(others)} 个记录产物`]
          .filter(Boolean)
          .join(' · ') || `${String(artifacts.length)} 个产物`
      );
    }
    case 'review': {
      const decision = pick(events, 'gate.result', 'decision');
      const reason = pick(events, 'gate.result', 'reason');
      return [decision && `Gate ${decision}`, reason].filter(Boolean).join(' · ');
    }
    case 'council': {
      const verdict = pick(events, 'council.decision', 'verdict');
      return verdict ? `裁决 ${verdict}` : '议会进行中';
    }
    case 'deliver': {
      const files = pick(events, 'worktree.materialized', 'files_written');
      const terminal = events.find((e) => e.type.startsWith('run.'));
      const status = terminal ? text(asRecord(terminal.payload).status) : '';
      return [status, files && `${files} 个文件落盘`].filter(Boolean).join(' · ');
    }
  }
}

/** 这一步是谁在做 —— 卡片上最先看到的东西。 */
function ownerOf(step: StepKey, role: string, events: RunEvent[]): string {
  const driver = pick(events, 'driver.session_started', 'driver_id');
  switch (step) {
    case 'intake':
    case 'deliver':
      return '协调器';
    case 'prepare':
      return role || '调度';
    case 'execute':
      return [role, driver].filter(Boolean).join(' · ') || 'Agent';
    case 'produce':
      return driver || 'Driver';
    case 'review':
      return 'Gate';
    case 'council':
      return '议会';
  }
}

// ── 分组 ──

/**
 * 事件流 → 语义步骤分组。
 * 步骤按「首个事件的到达顺序」排列 —— 后端的 sequence 是权威顺序，前端不重排。
 */
export function groupEvents(events: RunEvent[]): EventGroup[] {
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
  const roles = resolveRoles(sorted);

  const groups: EventGroup[] = [];
  const byKey = new Map<string, EventGroup>();

  for (const event of sorted) {
    const step = stepOf(event);
    if (!step) continue;
    const def = STEPS[step];
    const role = def.perAgent ? (roles.get(event.event_id) ?? '') : '';
    const key = `${step}|${role}`;

    let group = byKey.get(key);
    if (!group) {
      group = { nodeId: `step-${key}`, events: [], open: false };
      byKey.set(key, group);
      groups.push(group);
    }
    group.events.push(event);

    if (SPAN_STARTS.has(event.type)) group.open = true;
    if (SPAN_ENDS.has(event.type)) group.open = false;
  }

  return groups;
}

// ── 建图 ──

function stepKeyOf(group: EventGroup): StepKey {
  return group.nodeId.slice('step-'.length).split('|')[0] as StepKey;
}

function roleKeyOf(group: EventGroup): string {
  return group.nodeId.slice('step-'.length).split('|')[1] ?? '';
}

function statusOf(group: EventGroup, runStatus: LiveRunStatus): WorkflowNodeStatus {
  if (group.open) return runStatus === 'running' ? 'active' : 'blocked';
  if (group.events.some((e) => e.type.endsWith('.failed'))) return 'blocked';
  return 'done';
}

/** 跨度耗时：requested → completed 的真实间隔。 */
function durationOf(group: EventGroup): number | undefined {
  const start = group.events.find((e) => SPAN_STARTS.has(e.type));
  const end = group.events.find((e) => SPAN_ENDS.has(e.type));
  if (!start || !end) return undefined;
  return new Date(end.created_at).getTime() - new Date(start.created_at).getTime();
}

/**
 * 由事件派生泳道图的语义步骤节点。
 *
 * 泳道 = 这一步的执行者（协调器 / 各 agent 角色 / Driver / Gate / 议会）——
 * 后端派几个角色，「分派」「执行」就扇出成几条泳道，前端不预设条数。
 */
export function buildEventGraph(
  events: RunEvent[],
  runStatus: LiveRunStatus,
): { nodes: WorkflowNodeData[]; groups: EventGroup[] } {
  const groups = groupEvents(events);

  const nodes: WorkflowNodeData[] = groups.map((group, index) => {
    const step = stepKeyOf(group);
    const role = roleKeyOf(group);
    const def = STEPS[step];
    const status = statusOf(group, runStatus);
    const durationMs = durationOf(group);
    const first = group.events[0];

    return {
      id: group.nodeId,
      // 不再有 N 编号 —— 人不需要背协议节点号。卡片上显示的是「谁在做」。
      code: '',
      label: def.label,
      labelCn: def.labelCn,
      // perAgent 的步骤以角色为泳道；后端没给角色就退回该步骤的默认泳道
      lane: def.perAgent && role ? role : def.lane,
      direction: def.direction,
      column: index,
      tier: def.tier,
      phase: def.phase,
      deps: index > 0 ? [groups[index - 1].nodeId] : [],
      owner: ownerOf(step, role, group.events),
      status,
      taskStatus: null,
      ...(group.open ? { spanStartedAt: first.created_at } : {}),
      ...(durationMs !== undefined ? { statusNote: fmtDuration(durationMs) } : {}),
      frozen: 'frozen' as const,
      summary: summaryOf(step, group.events),
      // 后端事件没有「输入/输出/风险/下一步」这些模板字段 —— 不虚构，留空
      input: [],
      output: [],
      decided: group.events.flatMap((e) =>
        Object.entries(asRecord(e.payload)).map(([key, value]) => ({
          key,
          desc: text(value),
        })),
      ),
      tbd: [],
      events: [...new Set(group.events.map((e) => e.type))],
      risk: '',
      nextAction: '',
    };
  });

  return { nodes, groups };
}
