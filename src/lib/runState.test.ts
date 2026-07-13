import { describe, expect, it } from 'vitest';
import { RUN_STATE_LABEL, RUN_STATE_TONE, runStateOf, type RunState } from '@/lib/runState';
import type { RunEvent } from '@/api/types/rpc';
import type { LiveRunState } from '@/store/types';
import type { DemoTask } from '@/types';

function task(patch: Partial<DemoTask> = {}): DemoTask {
  return {
    id: 't1',
    projectId: 'p1',
    title: '为 user 模块补齐单测',
    taskText: '为 user 服务补齐单测',
    assignedAgentIds: [],
    stage: 'idle',
    analysisReady: false,
    nodes: [],
    revealedNodeCount: 0,
    activeStepIndex: 0,
    selectedNodeId: null,
    interventionRules: [],
    confirmedCouncilOptionId: null,
    interventionFeedback: null,
    timeline: [],
    ...patch,
  };
}

function gateEvent(sequence: number, decision: string): RunEvent {
  return {
    event_id: `e${String(sequence)}`,
    sequence,
    run_id: 'run-1',
    task_id: 'task-1',
    type: 'gate.result',
    source: 'gate',
    created_at: '2026-07-13T00:00:00Z',
    payload: { decision, reason: '需要人工确认写入范围' },
    schema_version: '1',
  };
}

function live(patch: Partial<LiveRunState> = {}): LiveRunState {
  return {
    runId: 'run-1',
    taskId: 'task-1',
    status: 'running',
    timeline: [],
    snapshot: null,
    error: null,
    ...patch,
  };
}

describe('runStateOf —— 全应用唯一的状态判定', () => {
  it('没有任务 → 未开始', () => {
    expect(runStateOf(undefined, undefined)).toBe<RunState>('idle');
  });

  it('没有 contractRunId 且没有提交错误 → 未开始', () => {
    expect(runStateOf(task(), undefined)).toBe<RunState>('idle');
  });

  it('提交失败（有 submitError、没有 runId）→ 未提交到后端，这是一个错误而不是中性状态', () => {
    expect(runStateOf(task({ submitError: '后端未启动' }), undefined)).toBe<RunState>('unsent');
  });

  it('后端已受理但实时状态还没到 → 执行中（绝不能显示成「未开始」，否则会被重复提交）', () => {
    expect(runStateOf(task({ contractRunId: 'run-1' }), undefined)).toBe<RunState>('running');
  });

  it('run 在跑且没有 Gate 拦截 → 执行中', () => {
    expect(runStateOf(task({ contractRunId: 'run-1' }), live())).toBe<RunState>('running');
  });

  it.each([['ask'], ['defer']])('Gate 判 %s → 需要你', (decision) => {
    const state = runStateOf(
      task({ contractRunId: 'run-1' }),
      live({ timeline: [gateEvent(1, decision)] }),
    );
    expect(state).toBe<RunState>('blocked');
  });

  it('Gate 放行（allow）→ 仍是执行中', () => {
    const state = runStateOf(
      task({ contractRunId: 'run-1' }),
      live({ timeline: [gateEvent(1, 'allow')] }),
    );
    expect(state).toBe<RunState>('running');
  });

  it('只看最后一次 Gate 结论：先 defer 后 allow → 已经放行了', () => {
    const state = runStateOf(
      task({ contractRunId: 'run-1' }),
      live({ timeline: [gateEvent(1, 'defer'), gateEvent(2, 'allow')] }),
    );
    expect(state).toBe<RunState>('running');
  });

  it('终态压过 Gate：run 已完成 → 已交付', () => {
    const state = runStateOf(
      task({ contractRunId: 'run-1' }),
      live({ status: 'completed', timeline: [gateEvent(1, 'ask')] }),
    );
    expect(state).toBe<RunState>('completed');
  });

  it('run 失败 → 失败', () => {
    expect(runStateOf(task({ contractRunId: 'run-1' }), live({ status: 'failed' }))).toBe<RunState>(
      'failed',
    );
  });

  it('run 被取消 → 已取消', () => {
    expect(
      runStateOf(task({ contractRunId: 'run-1' }), live({ status: 'cancelled' })),
    ).toBe<RunState>('cancelled');
  });
});

describe('词表', () => {
  const ALL: RunState[] = [
    'idle',
    'running',
    'blocked',
    'completed',
    'failed',
    'cancelled',
    'unsent',
  ];

  it('7 个状态各有唯一中文名，且没有双语注音、没有英文枚举前缀', () => {
    for (const state of ALL) {
      const label = RUN_STATE_LABEL[state];
      expect(label).toBeTruthy();
      expect(label).not.toMatch(/[a-zA-Z·]/);
    }
    expect(new Set(Object.values(RUN_STATE_LABEL)).size).toBe(ALL.length);
  });

  it('7 个状态各有一个色调，且只用 4 个强调色 + 中性', () => {
    for (const state of ALL) {
      expect(['muted', 'command', 'human', 'ok', 'danger']).toContain(RUN_STATE_TONE[state]);
    }
    expect(RUN_STATE_TONE.blocked).toBe('human');
    expect(RUN_STATE_TONE.unsent).toBe('danger');
  });
});
