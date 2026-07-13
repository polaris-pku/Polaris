/**
 * 主句（Mission Line）的取数 —— **全屏唯一的 24px，四态同槽**。
 *
 * 它回答的四个问题就是运行屏的验收判据：**谁 / 在做什么 / 多久了 / 成没成。**
 * 在此之前这四件事碎在四处（节点卡的 owner、10px 秒表、底栏 NODE/OWNER、控制栏一句话），
 * **没有一处是主语**。
 *
 * 本文件是纯函数：`now` 由调用方传入（秒表每秒重算一次），没有 React、没有 store。
 * 协议词（`gate.result` / `worktree.materialized`）只在这里做取数，**不外泄到 UI 文案**。
 */
import type { RunEvent } from '@/api/types/rpc';
import type { LiveRunState } from '@/store/types';
import type { DemoTask, WorkflowNodeData } from '@/types';
import type { PhaseKey } from '@/data/workflow';
import { PHASE_LABEL, PHASE_ORDER } from '@/lib/glossary';
import { explainError } from '@/lib/backendErrors';
import { durationBetween, elapsedSince, formatElapsed } from '@/lib/elapsed';
import { OWNER_FALLBACK, roleName } from '@/lib/roleNames';
import { runStateOf, type RunState } from '@/lib/runState';
import { buildEventGraph, STEPS, type StepKey } from '@/lib/eventGraph';

/** 主句要渲染的一切。`MissionLine.tsx` 只负责把它摆上屏，不做任何取数。 */
export type MissionLineModel = {
  state: RunState;
  /** 24px 的那一行。四态同槽。 */
  headline: string;
  /** 13px 副句；没有可说的就没有副句（不给占位）。 */
  sub?: string;
  /** 主句可点 = 有出路（failed / unsent → 重试） */
  retry: boolean;
};

/**
 * 步骤 → 主句里的**动作短语**。
 *
 * 不能直接用 `STEPS[k].labelCn`：它是卡片上的**名词**（「Agent 执行」「产出」），
 * 塞进「{owner} 正在…」会长出「后端 Agent 正在Agent 执行」这种句子。
 * 这里只做词形转换，不新增任何后端没说过的事实。
 */
const ACTION_LABEL: Record<StepKey, string> = {
  intake: '受理需求',
  prepare: '准备上下文',
  execute: '执行',
  produce: '整理产出',
  review: '审查',
  council: '合议',
  deliver: '交付',
};

/** 非 perAgent 步骤的执行者名（perAgent 的走 `roleName(role_id)`）。 */
const STEP_OWNER: Record<StepKey, string> = {
  intake: '协调器',
  prepare: '调度',
  execute: OWNER_FALLBACK,
  produce: '执行运行时',
  review: '自动检查',
  council: '合议',
  deliver: '协调器',
};

const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

/** 事件图的节点 id 形如 `step-<stepKey>|<role>`。 */
function stepKeyOf(nodeId: string): StepKey | undefined {
  if (!nodeId.startsWith('step-')) return undefined;
  const key = nodeId.slice('step-'.length).split('|')[0];
  return key in ACTION_LABEL ? (key as StepKey) : undefined;
}

/** 需求原文的首行（主句下的 clamp）。 */
function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .find((line) => line.trim().length > 0)
      ?.trim() ?? ''
  );
}

/** 时间线里最后一条某类事件。 */
function lastEvent(timeline: RunEvent[], type: string): RunEvent | undefined {
  for (let i = timeline.length - 1; i >= 0; i -= 1) {
    if (timeline[i].type === type) return timeline[i];
  }
  return undefined;
}

/**
 * 执行者名。
 *
 * `execute` 步骤的 `payload.role_id` → 显示名；拿不到就回退「后端 Agent」。
 * **绝不显示 `role_ts_engineer` 原文** —— 蛇形 id 是数据库主键，不是人名。
 */
export function ownerOf(timeline: RunEvent[]): string {
  for (let i = timeline.length - 1; i >= 0; i -= 1) {
    const event = timeline[i];
    if (!event.type.startsWith('agent.execution')) continue;
    const roleId = asRecord(event.payload).role_id;
    if (typeof roleId === 'string' && roleId) return roleName(roleId);
  }
  return OWNER_FALLBACK;
}

/**
 * 步骤卡上的执行者名。
 *
 * `eventGraph` 里的 `node.owner` 对 `execute` 步骤给的是 `role_ts_engineer · acp-external` ——
 * **蛇形 id 是数据库主键，不是人名**，主层一个字都不许露。这里统一过 `roleName()`。
 */
export function stepOwnerOf(node: WorkflowNodeData): string {
  const step = stepKeyOf(node.id);
  if (step) {
    const role = node.id.slice('step-'.length).split('|')[1] ?? '';
    if (STEPS[step].perAgent && role) return roleName(role);
    return STEP_OWNER[step];
  }
  // mock 模板节点的 owner 本就是人话；万一是蛇形 id，照样过映射。
  return /^[a-z][a-z0-9_]*$/.test(node.owner) ? roleName(node.owner) : node.owner;
}

/** run 的总用时：优先快照的 started_at → completed_at，否则取事件时间线的两端。 */
function runDuration(live: LiveRunState | undefined, now: number): number {
  if (!live) return 0;
  const run = live.snapshot?.run;
  if (run?.started_at && run.completed_at) return durationBetween(run.started_at, run.completed_at);
  const timeline = live.timeline;
  if (timeline.length === 0) return 0;
  const start = timeline[0].created_at;
  if (live.status === 'running') return elapsedSince(start, now);
  return durationBetween(start, timeline[timeline.length - 1].created_at);
}

const baseName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/**
 * 产出文件 —— **同名两个字段，类型不同。踩中就是白屏。**
 *
 *  - `RunEvent('worktree.materialized').payload.files_written` 是 **number（数量）**；
 *    路径数组在同一 payload 的 `changed_files`。
 *  - `RunSnapshot.delivery_report.files_written` 是 **string[]（路径）**。
 *
 * 取数规则：**快照在 → `delivery_report.files_written.length`；快照未到 → 那个 number 直接当数字用。**
 * 一次 run 的完成瞬间（快照还在路上）必然走后一条路，所以两条都必须是活的。
 */
export function producedFiles(live: LiveRunState | undefined): { count: number; names: string[] } {
  const delivery = live?.snapshot?.delivery_report;
  if (delivery) {
    const paths = delivery.files_written;
    return { count: paths.length, names: paths.map(baseName) };
  }

  const materialized = live ? lastEvent(live.timeline, 'worktree.materialized') : undefined;
  if (!materialized) return { count: 0, names: [] };

  const payload = asRecord(materialized.payload);
  const written = payload.files_written;
  const count = typeof written === 'number' ? written : 0;
  const changed = payload.changed_files;
  const names = Array.isArray(changed)
    ? changed.filter((p): p is string => typeof p === 'string').map(baseName)
    : [];
  return { count: count || names.length, names };
}

/** Gate 拦下时后端给的三个字段（只告知，不给按钮 —— 后端没有人类回写通道，R4）。 */
export function gateBlock(
  live: LiveRunState | undefined,
): { reason: string; requiredAction: string } | null {
  const gate = live ? lastEvent(live.timeline, 'gate.result') : undefined;
  if (!gate) return null;
  const payload = asRecord(gate.payload);
  const decision = payload.decision;
  if (decision !== 'ask' && decision !== 'defer') return null;

  const reason = typeof payload.reason === 'string' ? payload.reason : '';
  const actions = payload.required_actions;
  const requiredAction =
    Array.isArray(actions) && typeof actions[0] === 'string' ? (actions[0] as string) : '';
  return { reason: reason || '需要人工确认', requiredAction };
}

/** 失败原因：翻成人话（`explainError`），拿不到就用后端原文，绝不编。 */
function failure(live: LiveRunState | undefined): { title: string; hint?: string } {
  const error = live?.snapshot?.errors[0];
  if (error) {
    const explained = explainError(error);
    return { title: explained.title, hint: explained.hint };
  }
  if (live?.error) return { title: live.error };
  return { title: '后端未给出失败原因' };
}

/** 四态同槽的那一行。`now` 由调用方按秒喂进来。 */
export function missionLineOf({
  task,
  live,
  now,
}: {
  task: DemoTask | undefined;
  live: LiveRunState | undefined;
  now: number;
}): MissionLineModel {
  const state = runStateOf(task, live);

  switch (state) {
    case 'idle':
      return {
        state,
        headline: `准备执行「${task?.title ?? '新需求'}」`,
        sub: task ? firstLine(task.taskText) : undefined,
        retry: false,
      };

    case 'unsent':
      return {
        state,
        headline: '未提交到后端 · 点击重试',
        sub: task?.submitError,
        retry: true,
      };

    case 'blocked': {
      const gate = gateBlock(live);
      return {
        state,
        headline: `被拦下 · ${gate?.reason ?? '需要人工确认'}`,
        sub: gate?.requiredAction || undefined,
        retry: false,
      };
    }

    case 'running': {
      const owner = live ? ownerOf(live.timeline) : OWNER_FALLBACK;
      // run.create 已经受理，但一条事件都还没到（通道刚建立）—— 如实说，不假装有进度。
      if (!live || live.timeline.length === 0) {
        return {
          state,
          headline: '已提交 · 等待后端第一个事件',
          sub: '后端已受理这次需求，事件通道正在建立。',
          retry: false,
        };
      }

      const graph = liveNodes(live);
      const active = graph.find((n) => n.status === 'active');
      const current = active ?? [...graph].reverse()[0];
      const step = current ? stepKeyOf(current.id) : undefined;
      const action = step ? ACTION_LABEL[step] : '执行';
      // 跨度未闭合 → 走 spanStartedAt（agent 干活那十几秒的唯一活口）；
      // 已闭合 → 退回 run 的总用时（不把上一步的耗时冒充成当前步的）。
      const elapsed = active?.spanStartedAt
        ? elapsedSince(active.spanStartedAt, now)
        : runDuration(live, now);

      return {
        state,
        headline: `${owner} 正在${action} · ${formatElapsed(elapsed)}`,
        sub: current?.summary || undefined,
        retry: false,
      };
    }

    case 'completed': {
      const { count, names } = producedFiles(live);
      const duration = formatElapsed(runDuration(live, now));
      const headline =
        count > 0
          ? `已交付 · ${String(count)} 个文件 · 用时 ${duration}`
          : `已交付 · 用时 ${duration}`;
      return {
        state,
        headline,
        sub: names.slice(0, 3).join(' · ') || undefined,
        retry: false,
      };
    }

    case 'failed': {
      const { title, hint } = failure(live);
      return { state, headline: `执行失败 · ${title}`, sub: hint, retry: true };
    }

    case 'cancelled':
      return {
        state,
        headline: '已取消',
        sub: live ? `用时 ${formatElapsed(runDuration(live, now))}` : undefined,
        retry: false,
      };
  }
}

/**
 * live run 的步骤节点。
 *
 * 建图是纯的（同一批事件恒得同一张图），所以主句自己算一份，不依赖 store 里那份投影 ——
 * 这样它可以被单测直接喂事件。
 */
function liveNodes(live: LiveRunState): WorkflowNodeData[] {
  return buildEventGraph(live.timeline, live.status).nodes;
}

// ── 进度缎带 ──

export type PhaseSegment = {
  key: PhaseKey;
  labelCn: string;
  done: number;
  total: number;
  active: boolean;
};

/**
 * 四段进度缎带：受理 / 执行 / 审查 / 交付。
 *
 * **只表状态，不兼折叠开关** —— 原来的 4 个阶段 chip 身兼二职（「亮 = 已展开」与
 * 「LED = 当前阶段」两种含义挤在同一个符号里），那是它必须死的原因。
 */
export function phaseSegments(nodes: WorkflowNodeData[], activeNodeId?: string): PhaseSegment[] {
  return PHASE_ORDER.map((key) => {
    const inPhase = nodes.filter((n) => n.phase === key);
    const done = inPhase.filter((n) => n.status === 'done').length;
    const active = inPhase.some((n) =>
      activeNodeId ? n.id === activeNodeId : n.status === 'active',
    );
    return { key, labelCn: PHASE_LABEL[key], done, total: inPhase.length, active };
  });
}
