import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@/api/types/rpc';
import { activeProtocolNode, projectProtocolFlow } from '@/lib/protocolFlow';

let seq = 0;
const event = (type: string, payload: Record<string, unknown> = {}): RunEvent => {
  seq += 1;
  return {
    event_id: `evt-${String(seq)}`,
    sequence: seq,
    run_id: 'run-1',
    task_id: 'task-1',
    type,
    source: 'coordinator',
    created_at: `2026-07-13T09:00:${String(seq).padStart(2, '0')}.000Z`,
    payload,
    schema_version: 'v0.1',
  };
};

const statusOf = (nodes: ReturnType<typeof projectProtocolFlow>, code: string) =>
  nodes.find((n) => n.code === code)?.status;

describe('protocolFlow · 事件驱动的 N0–N18 投影', () => {
  it('单 agent 全程点亮 N2/N3/N5/N6/N8/N9/N10/N11/N13/N16/N18；无事件的节点保持 pending', () => {
    const timeline = [
      event('task.created'),
      event('run.created'),
      event('memory.context_pack_built'),
      event('driver.session_started'),
      event('driver.run_result'),
      event('artifact.registered'),
      event('task.completed'),
      event('hook.matched'),
      event('gate.result'),
      event('checkpoint.saved'),
      event('run.completed'),
    ];
    const nodes = projectProtocolFlow(timeline, 'completed');
    expect(nodes).toHaveLength(19);
    for (const code of ['N2', 'N3', 'N5', 'N6', 'N8', 'N9', 'N10', 'N11', 'N13', 'N16', 'N18']) {
      expect(statusOf(nodes, code)).toBe('done');
    }
    // 后端两套映射都没有事件的节点：老实 pending，且标记为不可达
    for (const code of ['N0', 'N1', 'N4', 'N7', 'N12', 'N15', 'N17']) {
      expect(statusOf(nodes, code)).toBe('pending');
      expect(nodes.find((n) => n.code === code)?.reachable).toBe(false);
    }
  });

  it('run 进行中：最近一次点亮事件所在节点是 active，其余已点亮节点是 done', () => {
    const timeline = [
      event('task.created'),
      event('run.created'),
      event('memory.context_pack_built'),
      event('driver.session_started'),
    ];
    const nodes = projectProtocolFlow(timeline, 'running');
    expect(statusOf(nodes, 'N6')).toBe('active');
    expect(statusOf(nodes, 'N5')).toBe('done');
    expect(activeProtocolNode(nodes)?.code).toBe('N6');
  });

  it('N6/N11/N14 这些 registry 表的空洞由前端补全表覆盖（用户可见即后端事件可证）', () => {
    const timeline = [
      event('driver.session_started'),
      event('hook.matched'),
      event('council.completed'),
    ];
    const nodes = projectProtocolFlow(timeline, 'completed');
    expect(statusOf(nodes, 'N6')).toBe('done');
    expect(statusOf(nodes, 'N11')).toBe('done');
    expect(statusOf(nodes, 'N14')).toBe('done');
  });

  it('失败事件把节点标 blocked：run.failed → N18，council.failed → N14，payload.status=failed → N8', () => {
    const nodes = projectProtocolFlow(
      [
        event('driver.run_result', { status: 'failed' }),
        event('council.failed', { code: 'X' }),
        event('run.failed'),
      ],
      'failed',
    );
    expect(statusOf(nodes, 'N8')).toBe('blocked');
    expect(statusOf(nodes, 'N14')).toBe('blocked');
    expect(statusOf(nodes, 'N18')).toBe('blocked');
  });

  it('终态没有 active；activeProtocolNode 落在最后点亮的节点上', () => {
    const timeline = [event('task.created'), event('run.completed')];
    const nodes = projectProtocolFlow(timeline, 'completed');
    expect(nodes.every((n) => n.status !== 'active')).toBe(true);
    expect(activeProtocolNode(nodes)?.code).toBe('N18');
  });

  it('表外事件（mailbox / agent.execution）不点亮任何节点', () => {
    const nodes = projectProtocolFlow(
      [event('mailbox.message_sent'), event('agent.execution_completed')],
      'running',
    );
    expect(nodes.every((n) => n.status === 'pending')).toBe(true);
  });
});
