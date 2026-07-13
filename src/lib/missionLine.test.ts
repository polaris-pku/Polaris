/**
 * 主句的 7 个态 × 模板。
 *
 * 重点是 `files_written` 的**双形状**：同名两个字段，一个是 number（事件），一个是 string[]（快照）。
 * 对 number 调 `.length` 会得到 `undefined`，对 string[] 直接当数字用会得到 `[object Array] 个文件` ——
 * 两条路各有一个用例，谁也别想在重构时把它们合并掉。
 */
import { describe, expect, it } from 'vitest';
import type { RunEvent, RunSnapshot } from '@/api/types/rpc';
import type { LiveRunState } from '@/store/types';
import type { DemoTask } from '@/types';
import { missionLineOf, phaseSegments, producedFiles } from '@/lib/missionLine';

const NOW = new Date('2026-01-01T00:01:12.000Z').getTime();

let seq = 0;
function evt(type: string, payload: Record<string, unknown> = {}, at = '00:00:00'): RunEvent {
  seq += 1;
  return {
    event_id: `evt-${String(seq)}`,
    sequence: seq,
    run_id: 'run-1',
    task_id: 'btask-1',
    type,
    source: 'coordinator',
    created_at: `2026-01-01T${at}.000Z`,
    payload,
    schema_version: 'test',
  } as unknown as RunEvent;
}

function task(over: Partial<DemoTask> = {}): DemoTask {
  return {
    id: 'task-1',
    projectId: 'p1',
    title: '为 user 模块补齐单测',
    taskText: '为 user 服务补齐单测，覆盖注册与登录两条主路径。\n第二行不该出现在副句里。',
    assignedAgentIds: [],
    stage: 'idle',
    analysisReady: false,
    nodes: [],
    revealedNodeCount: 0,
    activeStepIndex: -1,
    selectedNodeId: null,
    interventionRules: [],
    confirmedCouncilOptionId: null,
    interventionFeedback: null,
    timeline: [],
    ...over,
  } as DemoTask;
}

function live(over: Partial<LiveRunState> = {}): LiveRunState {
  return {
    runId: 'run-1',
    taskId: 'btask-1',
    status: 'running',
    timeline: [],
    snapshot: null,
    error: null,
    ...over,
  };
}

describe('missionLineOf', () => {
  it('idle：准备执行「标题」+ 需求首行', () => {
    const m = missionLineOf({ task: task(), live: undefined, now: NOW });
    expect(m.state).toBe('idle');
    expect(m.headline).toBe('准备执行「为 user 模块补齐单测」');
    expect(m.sub).toBe('为 user 服务补齐单测，覆盖注册与登录两条主路径。');
    expect(m.retry).toBe(false);
  });

  it('unsent：未提交到后端 · 点击重试（可点，且把后端原因摆出来）', () => {
    const m = missionLineOf({
      task: task({ submitError: '连接被拒绝' }),
      live: undefined,
      now: NOW,
    });
    expect(m.state).toBe('unsent');
    expect(m.headline).toBe('未提交到后端 · 点击重试');
    expect(m.sub).toBe('连接被拒绝');
    expect(m.retry).toBe(true);
  });

  it('running：{执行者} 正在{动作} · {秒表}，执行者取 role_id 的显示名', () => {
    seq = 0;
    const timeline = [
      evt('task.created', { spec: '补齐单测' }, '00:00:00'),
      evt('agent.execution_requested', { role_id: 'role_ts_engineer' }, '00:00:30'),
    ];
    const m = missionLineOf({
      task: task({ contractRunId: 'run-1' }),
      live: live({ timeline }),
      now: NOW,
    });
    expect(m.state).toBe('running');
    // spanStartedAt = 00:00:30，now = 00:01:12 → 42.0s
    expect(m.headline).toBe('TypeScript 工程师 正在执行 · 42.0s');
  });

  it('running：拿不到 role_id → 回退「后端 Agent」，绝不显示蛇形 id', () => {
    seq = 0;
    const timeline = [evt('agent.execution_requested', {}, '00:00:30')];
    const m = missionLineOf({
      task: task({ contractRunId: 'run-1' }),
      live: live({ timeline }),
      now: NOW,
    });
    expect(m.headline).toBe('后端 Agent 正在执行 · 42.0s');
    expect(m.headline).not.toContain('role_');
  });

  it('running：受理了但一条事件都没到 —— 如实说，不假装有进度', () => {
    const m = missionLineOf({
      task: task({ contractRunId: 'run-1' }),
      live: undefined,
      now: NOW,
    });
    expect(m.state).toBe('running');
    expect(m.headline).toBe('已提交 · 等待后端第一个事件');
  });

  it('blocked：被拦下 · {原因}，副句是 required_actions[0]（只告知，不给按钮）', () => {
    seq = 0;
    const timeline = [
      evt('agent.execution_completed', { role_id: 'backend_engineer' }, '00:00:40'),
      evt(
        'gate.result',
        { decision: 'ask', reason: '需要人工确认写入范围', required_actions: ['确认 src/ 可写'] },
        '00:00:50',
      ),
    ];
    const m = missionLineOf({
      task: task({ contractRunId: 'run-1' }),
      live: live({ timeline }),
      now: NOW,
    });
    expect(m.state).toBe('blocked');
    expect(m.headline).toBe('被拦下 · 需要人工确认写入范围');
    expect(m.sub).toBe('确认 src/ 可写');
    expect(m.retry).toBe(false);
  });

  it('completed（快照未到）：files_written 是 **number**，直接当数字用', () => {
    seq = 0;
    const timeline = [
      evt('task.created', {}, '00:00:00'),
      evt(
        'worktree.materialized',
        { files_written: 3, changed_files: ['a/tests/test_user.py', 'a/src/user.py'] },
        '00:01:12',
      ),
      evt('run.completed', {}, '00:01:12'),
    ];
    const m = missionLineOf({
      task: task({ contractRunId: 'run-1' }),
      live: live({ status: 'completed', timeline }),
      now: NOW,
    });
    expect(m.state).toBe('completed');
    expect(m.headline).toBe('已交付 · 3 个文件 · 用时 1m12s');
    expect(m.sub).toBe('test_user.py · user.py');
  });

  it('completed（快照已到）：delivery_report.files_written 是 **string[]**，取 length', () => {
    seq = 0;
    const timeline = [evt('task.created', {}, '00:00:00'), evt('run.completed', {}, '00:01:12')];
    const snapshot = {
      delivery_report: {
        files_written: ['tests/test_user.py', 'src/user.py'],
        artifacts_materialized: 2,
      },
      errors: [],
    } as unknown as RunSnapshot;
    const m = missionLineOf({
      task: task({ contractRunId: 'run-1' }),
      live: live({ status: 'completed', timeline, snapshot }),
      now: NOW,
    });
    expect(m.headline).toBe('已交付 · 2 个文件 · 用时 1m12s');
    expect(m.sub).toBe('test_user.py · user.py');
  });

  it('failed：执行失败 · 人话（explainError），副句是可操作建议', () => {
    seq = 0;
    const snapshot = {
      errors: [{ code: 'ARTIFACT_NOT_SELECTED', message: 'No artifact was selected' }],
    } as unknown as RunSnapshot;
    const m = missionLineOf({
      task: task({ contractRunId: 'run-1' }),
      live: live({ status: 'failed', timeline: [evt('run.failed', {}, '00:00:10')], snapshot }),
      now: NOW,
    });
    expect(m.state).toBe('failed');
    expect(m.headline).toBe('执行失败 · agent 只给了回复，没有把文件写进工作区');
    expect(m.sub).toContain('没有产生任何文件改动');
    expect(m.retry).toBe(true);
  });

  it('failed：没有快照时用后端给的原文，不编解释', () => {
    const m = missionLineOf({
      task: task({ contractRunId: 'run-1' }),
      live: live({ status: 'failed', error: '后端进程已退出' }),
      now: NOW,
    });
    expect(m.headline).toBe('执行失败 · 后端进程已退出');
  });

  it('cancelled：已取消 + 已用时', () => {
    seq = 0;
    const timeline = [evt('task.created', {}, '00:00:00'), evt('run.cancelled', {}, '00:01:12')];
    const m = missionLineOf({
      task: task({ contractRunId: 'run-1' }),
      live: live({ status: 'cancelled', timeline }),
      now: NOW,
    });
    expect(m.state).toBe('cancelled');
    expect(m.headline).toBe('已取消');
    expect(m.sub).toBe('用时 1m12s');
  });
});

describe('producedFiles', () => {
  it('两种形状都不许崩：number 不 .length，string[] 不当数字', () => {
    seq = 0;
    const fromEvent = producedFiles(
      live({ timeline: [evt('worktree.materialized', { files_written: 5 })] }),
    );
    expect(fromEvent.count).toBe(5);

    const fromSnapshot = producedFiles(
      live({
        snapshot: {
          delivery_report: { files_written: ['a.py'], artifacts_materialized: 1 },
          errors: [],
        } as unknown as RunSnapshot,
      }),
    );
    expect(fromSnapshot.count).toBe(1);
    expect(fromSnapshot.names).toEqual(['a.py']);
  });

  it('没有 run / 没有产出事件 → 0，不猜', () => {
    expect(producedFiles(undefined)).toEqual({ count: 0, names: [] });
    expect(producedFiles(live())).toEqual({ count: 0, names: [] });
  });
});

describe('phaseSegments', () => {
  it('四段恒在，当前段带 k/n', () => {
    const nodes = [
      { id: 'step-intake|', phase: 'intake', status: 'done' },
      { id: 'step-execute|a', phase: 'execution', status: 'done' },
      { id: 'step-execute|b', phase: 'execution', status: 'active' },
      { id: 'step-review|', phase: 'review', status: 'pending' },
    ] as unknown as Parameters<typeof phaseSegments>[0];

    const segments = phaseSegments(nodes);
    expect(segments.map((s) => s.labelCn)).toEqual(['受理', '执行', '审查', '交付']);
    expect(segments[1]).toMatchObject({ done: 1, total: 2, active: true });
    expect(segments[3]).toMatchObject({ done: 0, total: 0, active: false });
  });
});
