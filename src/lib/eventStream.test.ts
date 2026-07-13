import { describe, expect, it } from 'vitest';
import type { RunEvent, RunEventSource } from '@/api/types/rpc';
import {
  EVENT_STREAM_CAP,
  buildEventRows,
  capRows,
  filterRows,
  formatPayload,
  stepLabelOf,
} from '@/lib/eventStream';

/** 造一条真实形状的后端事件（字段与 api/types/rpc.ts 的 RunEvent 一一对应）。 */
function ev(
  seq: number,
  type: string,
  source: RunEventSource,
  payload: Record<string, unknown> = {},
  createdAt = '2026-07-13T09:15:04.000Z',
): RunEvent {
  return {
    event_id: `evt-${String(seq)}`,
    sequence: seq,
    run_id: 'run-1',
    task_id: 'task-1',
    type,
    source,
    created_at: createdAt,
    payload,
    schema_version: '0.1',
  };
}

describe('buildEventRows', () => {
  it('按后端的 sequence 升序排列（后端是权威顺序，前端不按时间戳猜）', () => {
    const rows = buildEventRows([
      ev(3, 'agent.execution_completed', 'agent'),
      ev(1, 'task.created', 'coordinator'),
      ev(2, 'agent.execution_requested', 'agent'),
    ]);

    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.type)).toEqual([
      'task.created',
      'agent.execution_requested',
      'agent.execution_completed',
    ]);
  });

  it('时间戳取事件自带的 created_at → HH:MM:SS', () => {
    const [row] = buildEventRows([
      ev(1, 'task.created', 'coordinator', {}, '2026-07-13T09:15:04.512Z'),
    ]);
    expect(row.time).toBe('09:15:04');
  });

  it('给每一行标出它归属的语义步骤（与步骤轨同一个真值源）', () => {
    const rows = buildEventRows([
      ev(1, 'task.created', 'coordinator'),
      ev(2, 'agent.execution_requested', 'agent', { role_id: 'role_ts_engineer' }),
    ]);

    expect(rows[0].stepId).toBe('step-intake|');
    expect(rows[0].stepLabel).toBe('需求受理');
    expect(rows[1].stepLabel).toBe('Agent 执行');
  });

  it('未登记的事件类型一条不丢（eventGraph 把它们收进「审查」步骤，原文照渲染）', () => {
    const rows = buildEventRows([
      ev(1, 'task.created', 'coordinator'),
      ev(2, 'some.unmapped_event', 'driver', { note: 'x' }),
    ]);

    // stepOf() 的 default 分支把未登记类型归到 review —— 不丢弃、不编造。
    expect(rows).toHaveLength(2);
    expect(rows[1].type).toBe('some.unmapped_event');
    expect(rows[1].stepLabel).toBe('审查');
    expect(rows[1].payload).toContain('"note"');
  });

  it('保留后端原文的 source 与 type（协议词在 L3 里是合法的）', () => {
    const [row] = buildEventRows([ev(1, 'mailbox.message_sent', 'coordinator')]);
    expect(row.source).toBe('coordinator');
    expect(row.type).toBe('mailbox.message_sent');
  });
});

describe('filterRows（F3：Fold 的「原始事件」入口把 stepId 送进来）', () => {
  const rows = buildEventRows([
    ev(1, 'task.created', 'coordinator'),
    ev(2, 'agent.execution_requested', 'agent'),
    ev(3, 'agent.execution_completed', 'agent'),
  ]);

  it('null = 不过滤，全量返回', () => {
    expect(filterRows(rows, null)).toHaveLength(3);
  });

  it('按 stepId 过滤到该步骤的事件组', () => {
    const executeStepId = rows.find((r) => r.type === 'agent.execution_requested')?.stepId ?? '';
    const filtered = filterRows(rows, executeStepId);

    expect(filtered.map((r) => r.seq)).toEqual([2, 3]);
    expect(filtered.every((r) => r.stepId === executeStepId)).toBe(true);
  });

  it('过滤到一个没有事件的步骤 → 空数组（而不是回退成全量）', () => {
    expect(filterRows(rows, 'step-council|')).toEqual([]);
  });
});

describe('formatPayload', () => {
  it('序列化成缩进 JSON 原文', () => {
    expect(formatPayload({ decision: 'defer', reason: '需要人工确认' })).toBe(
      '{\n  "decision": "defer",\n  "reason": "需要人工确认"\n}',
    );
  });

  it('空 payload → 空串（该行不可展开）', () => {
    expect(formatPayload({})).toBe('');
    expect(formatPayload(null)).toBe('');
    expect(formatPayload(undefined)).toBe('');
  });

  it('序列化失败不抛 —— 日志区域永远不能因为一条脏数据白屏', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(formatPayload(circular)).toBe('（payload 无法序列化为 JSON）');
  });

  it('嵌套 payload 完整保留（L3 说协议，不做人话化）', () => {
    expect(formatPayload({ files_written: 3, changed_files: ['a.py'] })).toContain('"a.py"');
  });
});

describe('stepLabelOf', () => {
  it('步骤节点 id → 中文名', () => {
    expect(stepLabelOf('step-execute|role_ts_engineer')).toBe('Agent 执行');
    expect(stepLabelOf('step-deliver|')).toBe('交付');
  });

  it('未知 / 非步骤 id → 空串', () => {
    expect(stepLabelOf('')).toBe('');
    expect(stepLabelOf('step-nope|')).toBe('');
    expect(stepLabelOf('node-7')).toBe('');
  });
});

describe('capRows', () => {
  const many = buildEventRows(
    Array.from({ length: 12 }, (_, i) => ev(i + 1, 'run.progress', 'coordinator')),
  );

  it('不超上限 → 原样返回，hidden 为 0', () => {
    expect(capRows(many, 20)).toEqual({ rows: many, hidden: 0 });
  });

  it('超上限 → 保留最新的，并如实报告省略了多少条', () => {
    const { rows, hidden } = capRows(many, 5);
    expect(hidden).toBe(7);
    expect(rows.map((r) => r.seq)).toEqual([8, 9, 10, 11, 12]);
  });

  it('默认上限是 EVENT_STREAM_CAP', () => {
    expect(capRows(many).rows).toHaveLength(12);
    expect(EVENT_STREAM_CAP).toBeGreaterThan(0);
  });
});
