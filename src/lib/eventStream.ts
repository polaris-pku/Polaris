/**
 * 事件流（L3）的取数与格式化 —— 纯函数，不碰 React、不碰 store。
 *
 * L3 是**全应用唯一渲染原始文本的区域**（FINAL-SPEC §2.1）。它取代了历史上三处
 * 同源的事件转储（LiveRunPanel 的 22 条 type 列表 / NodeInspector 的 19 行 raw
 * key-value / 泳道节点卡的悬浮面板）。协议词（event.type / source / payload 原文）
 * 只允许出现在这里（F2）。
 *
 * 两条纪律：
 *  - **一条不丢**：`groupEvents()` 会丢掉不属于任何语义步骤的事件（`stepOf()` 返回
 *    undefined 的那些）——但日志不能丢。这里对**全量 timeline** 建行，步骤归属只是
 *    行上的一个可选注解（`stepId === ''` = 不属于任何步骤，照样渲染）。
 *  - **后端的 sequence 是权威顺序**，前端不重排、不按时间戳猜。
 */
import type { RunEvent } from '@/api/types/rpc';
import { STEPS, groupEvents, type StepKey } from '@/lib/eventGraph';

/**
 * 渲染上限。日志本身无上限（它是日志），但 DOM 有 —— 一次跑几千条事件时，
 * 全量渲染会把渲染层卡死。沿用 store 里 `EVENT_LOG_CAP` 的精神：**保留最新的，
 * 并如实告诉用户省略了多少条**（不静默截断）。
 */
export const EVENT_STREAM_CAP = 1000;

/** 事件流里的一行。字段顺序就是列顺序：seq · time · type · source。 */
export type EventStreamRow = {
  /** React key：后端的 event_id 全局唯一 */
  eventId: string;
  seq: number;
  /** HH:MM:SS —— 取自事件自带的 created_at（后端给的真值，不是本地时钟） */
  time: string;
  type: string;
  source: string;
  /** 归属的语义步骤节点 id（= eventGraph 的 nodeId）。'' = 不属于任何步骤 */
  stepId: string;
  /** 步骤中文名，行上的灰色注解。'' = 不属于任何步骤 */
  stepLabel: string;
  /** 格式化后的 payload JSON 原文。'' = 无 payload（此行不可展开） */
  payload: string;
};

/** ISO → HH:MM:SS。事件都带 created_at，时间戳是后端给的真值。 */
const hms = (iso: string): string => iso.slice(11, 19);

/**
 * payload → 可读 JSON 原文。空 payload 返回 ''（调用方据此判定该行不可展开）。
 * 序列化失败（循环引用 / BigInt）不抛 —— 日志区域**永远不能因为一条脏数据白屏**。
 */
export function formatPayload(payload: unknown): string {
  if (payload == null) return '';
  if (typeof payload === 'object' && Object.keys(payload as object).length === 0) return '';
  try {
    return JSON.stringify(payload, null, 2) ?? '';
  } catch {
    return '（payload 无法序列化为 JSON）';
  }
}

/** 步骤节点 id（`step-<key>|<role>`）→ 步骤中文名。未知步骤返回 ''。 */
export function stepLabelOf(stepId: string): string {
  if (!stepId.startsWith('step-')) return '';
  const key = stepId.slice('step-'.length).split('|')[0] as StepKey;
  return STEPS[key]?.labelCn ?? '';
}

/**
 * 全量事件 → 事件流行，按 sequence 升序。
 *
 * 步骤归属复用 `groupEvents()`（与步骤轨 / 右栏 Fold **同一个真值源**），
 * 但不属于任何步骤的事件**照样成行** —— 见文件头「一条不丢」。
 */
export function buildEventRows(events: RunEvent[]): EventStreamRow[] {
  const stepIdByEventId = new Map<string, string>();
  for (const group of groupEvents(events)) {
    for (const event of group.events) stepIdByEventId.set(event.event_id, group.nodeId);
  }

  const rows = [...events]
    .sort((a, b) => a.sequence - b.sequence)
    .map((event) => {
      const stepId = stepIdByEventId.get(event.event_id) ?? '';
      return {
        eventId: event.event_id,
        seq: event.sequence,
        time: hms(event.created_at),
        type: event.type,
        source: event.source,
        stepId,
        stepLabel: stepLabelOf(stepId),
        payload: formatPayload(event.payload),
      };
    });

  return collapseDriverStreams(rows);
}

/**
 * Driver 的 token/chunk 流属于一段输出，不是几十个独立流程状态。
 * 连续 chunk 合并为一行；原始 sequence 与 payload 完整保留在展开内容中。
 */
function collapseDriverStreams(rows: EventStreamRow[]): EventStreamRow[] {
  const collapsed: EventStreamRow[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const first = rows[index]!;
    if (first.type !== 'driver.stream_event') {
      collapsed.push(first);
      continue;
    }

    const group = [first];
    const streamKey = driverStreamKey(first);
    while (
      rows[index + 1]?.type === 'driver.stream_event' &&
      driverStreamKey(rows[index + 1]!) === streamKey
    ) {
      group.push(rows[index + 1]!);
      index += 1;
    }

    const last = group[group.length - 1]!;
    collapsed.push({
      ...last,
      eventId: `driver-stream:${first.eventId}:${last.eventId}`,
      type: `driver.output_stream × ${group.length}`,
      payload: formatPayload({
        event_count: group.length,
        sequence_from: first.seq,
        sequence_to: last.seq,
        events: group.map((row) => ({
          sequence: row.seq,
          time: row.time,
          payload: parseFormattedPayload(row.payload),
        })),
      }),
    });
  }
  return collapsed;
}

function driverStreamKey(row: EventStreamRow): string {
  const payload = parseFormattedPayload(row.payload);
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as Record<string, unknown>;
  return [record.session_id, record.role_id, record.agent_id]
    .filter((value): value is string => typeof value === 'string')
    .join(':');
}

function parseFormattedPayload(payload: string): unknown {
  if (!payload) return {};
  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}

/** 按步骤过滤（F3 的落点：Fold 的「原始事件 · N 条 ↗」把 stepId 送进来）。null = 不过滤。 */
export function filterRows(rows: EventStreamRow[], stepId: string | null): EventStreamRow[] {
  if (!stepId) return rows;
  return rows.filter((row) => row.stepId === stepId);
}

/** 只渲染最新的 cap 条，并如实报告省略了多少条。 */
export function capRows(
  rows: EventStreamRow[],
  cap: number = EVENT_STREAM_CAP,
): { rows: EventStreamRow[]; hidden: number } {
  if (rows.length <= cap) return { rows, hidden: 0 };
  return { rows: rows.slice(rows.length - cap), hidden: rows.length - cap };
}
