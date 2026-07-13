/**
 * 右栏那一列 Fold 需要的**事实**。全部是纯函数，输入只有后端事件与快照。
 *
 * 为什么单独一个文件：这些判定以前散在 LiveRunPanel / NodeInspector / DeliveryReport 三个组件里，
 * 同一件事（产出了几个文件、Gate 拦没拦、这一步是谁做的）各算各的，三处答案还不一样。
 * 事实只算一次，组件只负责排版。
 *
 * ⚠️ **`files_written` 的字段陷阱**（同名两个字段，类型不同）：
 *  - `RunEvent('worktree.materialized').payload.files_written` 是 **number（数量）**；
 *  - `RunSnapshot.delivery_report.files_written` 是 **string[]（路径）**。
 * 对前者做 `.length` / `.map()` 会当场崩。取数规则见 artifactFactsOf()。
 */
import type { RunEvent, RunSnapshot } from '@/api/types/rpc';
import { isFrontendWorkflowV01 } from '@/api/types/rpc';
import { groupEvents, type StepKey } from '@/lib/eventGraph';
import { OWNER_FALLBACK, roleName } from '@/lib/roleNames';
import type { LiveRunState } from '@/store/types';
import type { WorkflowNodeData } from '@/types';

const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

// ── Gate ──────────────────────────────────────────────────────────────────

/** 一次 Gate 结论。`decision` 是后端原文（allow / deny / ask / defer）。 */
export type GateFact = {
  decision: string;
  reason: string;
  requiredActions: string[];
};

/** 四个分支里，只有这两个意味着「停下来，需要人」。与 runState.ts 的判定同源。 */
const BLOCKING_DECISIONS = new Set(['ask', 'defer']);

/** 时间线里**最后一次** Gate 结论；没有 Gate 事件则为 null。 */
export function gateFactOf(timeline: RunEvent[]): GateFact | null {
  for (let i = timeline.length - 1; i >= 0; i -= 1) {
    const event = timeline[i];
    if (event.type !== 'gate.result') continue;
    const payload = asRecord(event.payload);
    const actions = payload.required_actions;
    return {
      decision: str(payload.decision),
      reason: str(payload.reason),
      requiredActions: Array.isArray(actions) ? actions.map((a) => str(a)).filter(Boolean) : [],
    };
  }
  return null;
}

/**
 * 需要人的那次 Gate（ask / defer）。
 *
 * 【R4】后端**没有人类回写通道**（`can_create_merge_authorization` 恒 false，无 `gate.respond` RPC）——
 * 所以这个事实只用来**告知**，不长按钮。
 */
export function blockingGateOf(timeline: RunEvent[]): GateFact | null {
  const gate = gateFactOf(timeline);
  return gate && BLOCKING_DECISIONS.has(gate.decision) ? gate : null;
}

// ── 产出文件 ───────────────────────────────────────────────────────────────

/** 一个产出文件。`absPath` 只在快照给了绝对路径时才有 —— 有它才敢让用户点开文件管理器。 */
export type ArtifactFile = { label: string; absPath?: string };
export type ArtifactFacts = { count: number; files: ArtifactFile[] };

const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/** 快照里 agent 真正写进工作区的文件（artifacts[type=diff].source_path，绝对路径）。 */
function producedAbsPaths(snapshot: RunSnapshot): string[] {
  return snapshot.artifacts
    .map((artifact) => asRecord(artifact))
    .filter((artifact) => str(artifact.type) === 'diff')
    .map((artifact) => str(artifact.source_path))
    .filter(Boolean);
}

/**
 * `worktree.materialized` 的 `payload.files_written` —— 它是**数量**，不是数组。
 * 快照还没到（run 刚结束的那一瞬）时，这是唯一能拿到文件数的地方。
 */
function worktreeFileCount(timeline: RunEvent[]): number | undefined {
  const event = timeline.find((e) => e.type === 'worktree.materialized');
  if (!event) return undefined;
  const value = asRecord(event.payload).files_written;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  // 有的后端版本会把它序列化成字符串数字；容忍，但绝不把它当数组用
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

/**
 * `worktree.materialized` 的 `payload.changed_files` —— **它才是那个字符串数组**。
 *
 * 同一条事件里 `files_written` 是数量、`changed_files` 是路径数组（后端两个字段同源不同型，
 * 名字还起得像，极易踩）。快照到达之前，这是唯一能拿到**文件名**的地方 ——
 * 丢掉它，界面就只能说一句「已落盘 N 个文件，路径要等快照」，而事实上名字明明已经在手里了。
 */
function worktreeChangedFiles(timeline: RunEvent[]): string[] {
  const event = [...timeline].reverse().find((e) => e.type === 'worktree.materialized');
  if (!event) return [];
  const changed = asRecord(event.payload).changed_files;
  return Array.isArray(changed) ? changed.map((v) => str(v)).filter(Boolean) : [];
}

/**
 * 运行中还没有快照时，只能从 `artifact.registered(type=diff)` 的 uri 尾段取文件名。
 * transcript 类产物的 uri 尾段是 session id，不是文件名 —— 混进来就是一串没人看得懂的乱码。
 */
function diffArtifactNames(timeline: RunEvent[]): string[] {
  return timeline
    .filter((e) => e.type === 'artifact.registered')
    .map((e) => asRecord(e.payload))
    .filter((payload) => str(payload.type) === 'diff')
    .map((payload) => {
      const uri = str(payload.uri);
      if (!uri) return '';
      try {
        return baseName(decodeURIComponent(uri));
      } catch {
        return baseName(uri);
      }
    })
    .filter(Boolean);
}

/**
 * 产出文件：**快照在 → `delivery_report.files_written`（string[]，路径）；
 * 快照未到 → `worktree.materialized.payload.files_written`（number，直接当数字用）。**
 */
export function artifactFactsOf(live: LiveRunState | undefined): ArtifactFacts {
  if (!live) return { count: 0, files: [] };

  const snapshot = live.snapshot;
  if (snapshot && isFrontendWorkflowV01(snapshot)) {
    const abs = producedAbsPaths(snapshot);
    const written = snapshot.delivery_report.files_written;
    if (written.length > 0) {
      return {
        count: written.length,
        files: written.map((path) => ({
          label: path,
          absPath: abs.find((a) => a === path || baseName(a) === baseName(path)),
        })),
      };
    }
    // files_written 为空但产物里有代码文件 —— 两者都来自同一份快照，取能点开的那个
    return { count: abs.length, files: abs.map((a) => ({ label: baseName(a), absPath: a })) };
  }

  // 快照未到：名字优先取 worktree.materialized 的 changed_files（真数组），
  // 它没有时才退回 artifact.registered 的 uri 尾段。
  // 两者都拿不到路径 → 只报数量，如实说明路径还没到，绝不编。
  const names = worktreeChangedFiles(live.timeline);
  const fallback = names.length > 0 ? names : diffArtifactNames(live.timeline);
  const count = worktreeFileCount(live.timeline);
  return {
    count: count ?? fallback.length,
    files: fallback.map((label) => ({ label })),
  };
}

// ── 步骤 ───────────────────────────────────────────────────────────────────

/** 节点 id 形如 `step-<stepKey>|<role>`（见 eventGraph.groupEvents）。 */
export function stepKeyOfNode(node: WorkflowNodeData): StepKey | undefined {
  if (!node.id.startsWith('step-')) return undefined;
  return node.id.slice('step-'.length).split('|')[0] as StepKey;
}

/** `tier==='machine'` 的步骤：A/B/C/D 之间的内部握手。**永不单独成 Fold，聚合成一个。** */
export function machineSteps(nodes: WorkflowNodeData[]): WorkflowNodeData[] {
  return nodes.filter((n) => n.tier === 'machine');
}

/** 人真正关心的步骤（human / milestone）。 */
export function visibleSteps(nodes: WorkflowNodeData[]): WorkflowNodeData[] {
  return nodes.filter((n) => n.tier !== 'machine');
}

/**
 * 「步骤」Fold 显示哪一步：用户选中的那步优先，否则跟着 agent 走（active），
 * run 结束后落在最后一个已发生的步骤上。
 */
export function focusStepOf(
  nodes: WorkflowNodeData[],
  selectedNodeId: string | null,
): WorkflowNodeData | undefined {
  const visible = visibleSteps(nodes);
  const selected = visible.find((n) => n.id === selectedNodeId);
  if (selected) return selected;
  return (
    visible.find((n) => n.status === 'active') ??
    [...visible].reverse().find((n) => n.status !== 'pending') ??
    visible[visible.length - 1]
  );
}

/**
 * 这一步是谁做的。
 *
 * **绝不显示 `role_ts_engineer` 原文**：有 role_id 就过 roleName()；agent 执行类步骤拿不到角色时
 * 回退 `后端 Agent`。eventGraph 的 `owner` 对 execute/prepare 会把 role_id / driver_id 原样拼进去 ——
 * 那是给图用的调试串，不能直接端到人面前。
 */
export function stepOwnerOf(node: WorkflowNodeData, events: RunEvent[]): string {
  const roleId = events.map((e) => str(asRecord(e.payload).role_id)).find(Boolean);
  if (roleId) return roleName(roleId);

  const key = stepKeyOfNode(node);
  if (key === 'execute' || key === 'prepare') return OWNER_FALLBACK;
  if (key === 'produce') return '执行器';
  return node.owner || OWNER_FALLBACK;
}

/** 节点 id → 该步骤背后的原始事件（`原始事件 · {n} 条` 的 n 就是它的长度）。 */
export function eventsByNode(timeline: RunEvent[]): Record<string, RunEvent[]> {
  const out: Record<string, RunEvent[]> = {};
  for (const group of groupEvents(timeline)) out[group.nodeId] = group.events;
  return out;
}

// ── 运行信息（全应用唯一能出现机器 ID 的地方）────────────────────────────────

/** 模式：主层说人话，机器原文只作 D2 的灰色注解。 */
const MODE_LABEL: Record<string, string> = {
  single_agent: '单 Agent',
  council: '合议',
};
export const modeLabel = (mode: string): string => MODE_LABEL[mode] ?? mode;

/** 执行器同上。`acp-external` 是仓库里唯一在跑的那个。 */
const DRIVER_LABEL: Record<string, string> = {
  'acp-external': 'ACP 外部驱动',
};
export const driverLabel = (driverId: string): string => DRIVER_LABEL[driverId] ?? driverId;

export type RunMeta = {
  runId: string;
  taskId: string;
  /** 后端原文（single_agent / council）；显示名过 modeLabel() */
  mode: string;
  /** 后端原文（acp-external）；显示名过 driverLabel()。拿不到就是空串 —— 不猜 */
  driverId: string;
  eventCount: number;
};

export function runMetaOf(live: LiveRunState): RunMeta {
  const driverId =
    live.timeline
      .filter((e) => e.type === 'driver.session_started')
      .map((e) => str(asRecord(e.payload).driver_id))
      .find(Boolean) ?? '';

  return {
    runId: live.runId,
    taskId: live.taskId,
    mode: live.snapshot?.mode ?? '',
    driverId,
    eventCount: live.timeline.length,
  };
}
