import { describe, expect, it } from 'vitest';
import type { RunEvent, RunSnapshot } from '@/api/types/rpc';
import { buildLiveProgressReplay, buildLiveRunReplay } from '@/lib/liveReplay';

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
    created_at: `2026-07-20T09:00:${String(seq).padStart(2, '0')}.000Z`,
    payload,
    schema_version: 'v0.1',
  };
};

const META = { runId: 'run-1', taskId: 'task-1', mode: 'single_agent', status: 'running' };

const snapshotWith = (spec: string): RunSnapshot =>
  ({
    contract_version: 'frontend-workflow.v0.1',
    schema_version: 'v0.1',
    run_id: 'run-1',
    task_id: 'task-1',
    mode: 'single_agent',
    status: 'completed',
    current: { stage: 'delivery', active_node_code: '' },
    task: {
      task_id: 'task-1',
      status: 'completed',
      spec,
      completion_criteria: [],
      risk_level: 'low',
      affected_paths: [],
      created_at: '',
      updated_at: '',
      schema_version: 'v0.1',
    },
    run: {
      run_id: 'run-1',
      task_id: 'task-1',
      status: 'completed',
      mode: 'single_agent',
      event_ids: [],
    },
    flow: { active_node_code: '', node_statuses: [] },
    delivery_report: { worktree_path: '/w/x', files_written: [], artifacts_materialized: 0 },
    links: {},
    timeline: [],
    agent_runs: [],
    artifacts: [],
    gates: [],
    errors: [],
  }) as RunSnapshot;

/**
 * `meta.spec` 是**任务标题的唯一来源**（taskSlice.applyLiveProgress 拿它写 taskText）。
 * 它以前藏在一个叫 `scenario.subject` 的字段里，那个 scenario 的其余十几个字段全是
 * 写了没人读的演示内容，已随 data/scenario.ts 一起删除 —— 这组用例钉住搬家后的行为。
 */
describe('liveReplay · meta.spec 是任务标题的来源', () => {
  it('实时路径：取 task.created 的 spec 原文', () => {
    const replay = buildLiveProgressReplay(
      [event('run.created'), event('task.created', { spec: '为订单接口增加权限校验' })],
      META,
    );
    expect(replay.meta.spec).toBe('为订单接口增加权限校验');
  });

  it('实时路径：task.created 还没到 → 退回 taskId，绝不是空串', () => {
    const replay = buildLiveProgressReplay([event('run.created')], META);
    expect(replay.meta.spec).toBe('task-1');
  });

  it('实时路径：spec 为空串时同样退回 taskId（空标题在界面上是一片空白）', () => {
    const replay = buildLiveProgressReplay([event('task.created', { spec: '' })], META);
    expect(replay.meta.spec).toBe('task-1');
  });

  it('终态路径：以快照的 task.spec 为权威（后端可能规范化过需求正文）', () => {
    const replay = buildLiveRunReplay(snapshotWith('后端规范化后的需求正文'));
    expect(replay?.meta.spec).toBe('后端规范化后的需求正文');
  });

  it('其余 meta 字段不受影响', () => {
    const replay = buildLiveProgressReplay(
      [
        event('task.created', { spec: 'x' }),
        event('driver.session_started', { driver_id: 'acp-external' }),
      ],
      META,
    );
    expect(replay.meta).toMatchObject({
      runId: 'run-1',
      taskId: 'task-1',
      mode: 'single_agent',
      status: 'running',
      driverId: 'acp-external',
    });
  });
});
