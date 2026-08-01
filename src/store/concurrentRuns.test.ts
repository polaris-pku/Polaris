/**
 * 并发提交两个需求：先提交的那个不能被后提交的那个卡死。
 *
 * 复现的是一个真实出过的 bug —— 前端有**两处**「同一时刻只有一个 run」的假设：
 *   1. `api/events.ts` 只维护一个 `subscribedRunId`，`watchRun(run2)` 会把 run1 从后端退订；
 *   2. store 里 `liveRun` 是单槽，run2 的第一条事件一到就把 run1 的时间线整个顶掉（归零重建）。
 * 两者叠加：先提交的任务永远停在半路 —— 而后端其实把它跑完了，文件也落了盘。
 *
 * 这个用例走完整链路（createTask → run.create → watchRun → 后端推事件 → 泳道图投影），
 * 交错喂两个 run 的事件，断言两个任务各自独立推进。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunEvent } from '@/api/types/rpc';

type BackendEventCb = (notification: {
  method: 'task.event' | 'run.event';
  params: unknown;
}) => void;

const READY_STATUS = {
  state: 'ready' as const,
  message: '',
  workspace: '/tmp/ws',
  auth: {
    providerId: 'anthropic',
    hasKey: true,
    incomplete: false,
    hasLocalCredentials: false,
    ready: true,
    baseUrl: '',
    model: '',
    fastModel: '',
  },
  agents: [],
  providers: [],
};

/** 可编程的假后端桥（形状对齐 electron/preload.cjs 的 window.desktop.backend）。 */
function installFakeBackend() {
  const eventCbs = new Set<BackendEventCb>();
  const rpc: Array<{ method: string; params: unknown }> = [];
  let created = 0;

  const backend = {
    call: vi.fn(async (method: string, params: unknown) => {
      rpc.push({ method, params });
      if (method === 'task.create') {
        created += 1;
        const taskId = `btask-${created}`;
        const runId = `run-${created}`;
        const request = params as { spec: string; completion_criteria: string[] };
        return {
          ok: true as const,
          result: {
            contract_version: 'task-snapshot.v0',
            schema_version: 'test',
            revision: 1,
            task: {
              task_id: taskId,
              status: 'running',
              risk_level: 'medium',
              spec: request.spec,
              completion_criteria: request.completion_criteria,
              affected_paths: [],
              created_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-01T00:00:00.000Z',
              schema_version: 'test',
            },
            current_run: {
              run_id: runId,
              task_id: taskId,
              status: 'running',
              mode: 'single_agent',
              restartable: false,
            },
            run_history: [],
            warnings: [],
          },
        };
      }
      if (method === 'task.subscribe') {
        const taskId = (params as { task_id: string }).task_id;
        const index = Number(taskId.split('-')[1]);
        return {
          ok: true as const,
          result: {
            subscribed: true,
            snapshot: {
              contract_version: 'task-snapshot.v0',
              schema_version: 'test',
              revision: 1,
              task: {
                task_id: taskId,
                status: 'running',
                risk_level: 'medium',
                spec: index === 1 ? '实现贪吃蛇' : '实现俄罗斯方块',
                completion_criteria: ['游戏可运行'],
                affected_paths: [],
                created_at: '2026-01-01T00:00:00.000Z',
                updated_at: '2026-01-01T00:00:00.000Z',
                schema_version: 'test',
              },
              current_run: {
                run_id: `run-${index}`,
                task_id: taskId,
                status: 'running',
                mode: 'single_agent',
                restartable: false,
              },
              run_history: [],
              warnings: [],
            },
            replay_events: [],
          },
        };
      }
      if (method === 'run.getSnapshot') {
        // 本用例不测终态快照链路 —— 让它失败。store 会把错误记在对应 run 上，
        // 不影响已收到的事件时间线（这正是它该有的行为）。
        return { ok: false as const, error: '本用例不提供快照' };
      }
      return { ok: true as const, result: {} };
    }),
    getStatus: vi.fn(async () => READY_STATUS),
    configure: vi.fn(async () => READY_STATUS),
    restart: vi.fn(async () => READY_STATUS),
    getSettings: vi.fn(async () => ({
      provider: 'anthropic',
      bMemory: { configured: true },
      configured: {},
    })),
    saveSettings: vi.fn(async () => READY_STATUS),
    onNotification: (cb: BackendEventCb) => {
      eventCbs.add(cb);
      return () => eventCbs.delete(cb);
    },
    onStatus: vi.fn(() => () => {}),
  };

  /**
   * 终端桥的假实现。存在的唯一目的：**证明后端事件一条都碰不到它。**
   * （R3/I5：agent 会往工作区写 .py，任何事件驱动的自动执行 = agent → 宿主 RCE。）
   */
  const terminal = {
    start: vi.fn(async () => ({ ok: true as const, sessionId: 'never' })),
    write: vi.fn(async () => ({ ok: true as const })),
    signal: vi.fn(async () => ({ ok: true as const })),
    dispose: vi.fn(async () => ({ ok: true as const })),
    list: vi.fn(async () => ({ sessions: [] })),
    onEvent: vi.fn(() => () => {}),
  };

  vi.stubGlobal('window', {
    desktop: { isDesktop: true, platform: 'linux', backend, terminal },
  });

  return {
    backend,
    terminal,
    /** 模拟后端推一条 run.event 上来 */
    emit(event: RunEvent) {
      eventCbs.forEach((cb) =>
        cb({ method: 'run.event', params: { run_id: event.run_id, event } }),
      );
    },
    calls: (method: string) => rpc.filter((c) => c.method === method),
  };
}

let seq = 0;
/** 造一条后端事件。sequence 全局单调递增 —— 与真实后端一致。 */
function evt(runId: string, type: string, payload: Record<string, unknown> = {}): RunEvent {
  seq += 1;
  return {
    event_id: `evt-${runId}-${seq}`,
    sequence: seq,
    run_id: runId,
    task_id: `btask-${runId.split('-')[1]}`,
    type,
    source: 'coordinator',
    created_at: `2026-01-01T00:00:${String(seq).padStart(2, '0')}.000Z`,
    payload,
    schema_version: 'test',
  } as unknown as RunEvent;
}

describe('并发跑两个需求', () => {
  beforeEach(() => {
    seq = 0;
    vi.unstubAllGlobals();
  });

  it('第二个需求不会把第一个卡死：两个 run 各自独立推进', async () => {
    const fake = installFakeBackend();

    const { resetTransport } = await import('@/api/transport');
    resetTransport();
    const { resetEventChannel } = await import('@/api/events');
    resetEventChannel();
    const { useDemoStore } = await import('@/store/useDemoStore');

    const store = useDemoStore.getState();
    store.resetDemo();
    store.createProject('P1', '并发用例');

    // ── 两个需求先后提交 ──
    await useDemoStore.getState().createTask('实现贪吃蛇', undefined, ['游戏可运行']);
    await vi.waitFor(() => expect(useDemoStore.getState().tasks[0].contractRunId).toBe('run-1'));

    await useDemoStore.getState().createTask('实现俄罗斯方块', undefined, ['游戏可运行']);
    await vi.waitFor(() => expect(useDemoStore.getState().tasks[1].contractRunId).toBe('run-2'));

    // 两个 run 都必须处于订阅状态，且一个都没被退订。
    expect(fake.calls('run.subscribe').map((c) => c.params)).toEqual([
      { run_id: 'run-1' },
      { run_id: 'run-2' },
    ]);
    expect(fake.calls('run.unsubscribe')).toHaveLength(0);

    // ── 交错喂事件（真实后端就是这么交错推的）──
    fake.emit(evt('run-1', 'task.created', { spec: '实现贪吃蛇' }));
    fake.emit(evt('run-2', 'task.created', { spec: '实现俄罗斯方块' }));
    fake.emit(evt('run-1', 'driver.session_started', { driver_id: 'acp-external' }));
    fake.emit(evt('run-2', 'driver.session_started', { driver_id: 'acp-external' }));
    fake.emit(evt('run-1', 'run.completed', {}));

    const state = useDemoStore.getState();

    // 每个 run 只累积自己的事件 —— 不再互相顶掉。
    expect(state.liveRuns['run-1'].timeline.map((e) => e.type)).toEqual([
      'task.created',
      'driver.session_started',
      'run.completed',
    ]);
    expect(state.liveRuns['run-2'].timeline.map((e) => e.type)).toEqual([
      'task.created',
      'driver.session_started',
    ]);
    expect(state.liveRuns['run-1'].timeline.every((e) => e.run_id === 'run-1')).toBe(true);
    expect(state.liveRuns['run-2'].timeline.every((e) => e.run_id === 'run-2')).toBe(true);

    // run-1 先跑完；run-2 还在跑。互不影响。
    expect(state.liveRuns['run-1'].status).toBe('completed');
    expect(state.liveRuns['run-2'].status).toBe('running');

    // 两个任务各自被后端事件推进过（泳道图有节点 = applyLiveProgress 真的落到了它头上）。
    const task1 = state.tasks.find((t) => t.contractRunId === 'run-1')!;
    const task2 = state.tasks.find((t) => t.contractRunId === 'run-2')!;
    expect(task1.nodes.length).toBeGreaterThan(0);
    expect(task2.nodes.length).toBeGreaterThan(0);

    // 这一条是 bug 的正脸：run-1 跑完了，它的任务必须落到交付态 ——
    // 旧实现里它会永远停在 executing（事件根本到不了）。
    expect(task1.stage).toBe('delivery');
    expect(task2.stage).toBe('executing');
  });

  it('别的项目还有 run 在跑时，跨项目提交被拒 —— 绝不重启后端（重启会杀掉那个 agent）', async () => {
    const fake = installFakeBackend();

    const { resetTransport } = await import('@/api/transport');
    resetTransport();
    const { resetEventChannel } = await import('@/api/events');
    resetEventChannel();
    const { useDemoStore } = await import('@/store/useDemoStore');

    useDemoStore.getState().resetDemo();
    useDemoStore.getState().createProject('P1', '项目一');
    const p1 = useDemoStore.getState().activeProjectId!;

    // P1 里提一个需求，并让它进入 running
    await expect(
      useDemoStore.getState().createTask('实现贪吃蛇', undefined, ['游戏可运行']),
    ).resolves.toEqual({ ok: true });
    await vi.waitFor(() => expect(useDemoStore.getState().tasks[0].contractRunId).toBe('run-1'));
    fake.emit(evt('run-1', 'task.created', { spec: '实现贪吃蛇' }));
    expect(useDemoStore.getState().liveRuns['run-1'].status).toBe('running');

    // 切到 P2 —— 光是浏览项目绝不能重启后端
    const configureCallsBefore = fake.backend.configure.mock.calls.length;
    useDemoStore.getState().createProject('P2', '项目二');
    expect(useDemoStore.getState().activeProjectId).not.toBe(p1);
    expect(fake.backend.configure.mock.calls.length).toBe(configureCallsBefore);

    // 在 P2 提需求 → 必须被拒，且不能碰后端
    const result = await useDemoStore
      .getState()
      .createTask('实现俄罗斯方块', undefined, ['游戏可运行']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('实现贪吃蛇');
    expect(fake.backend.configure.mock.calls.length).toBe(configureCallsBefore);
    expect(fake.calls('task.create')).toHaveLength(1); // 只有 P1 那一次

    // run-1 依旧活着，没被谁掐断
    expect(useDemoStore.getState().liveRuns['run-1'].status).toBe('running');
    expect(fake.calls('run.unsubscribe')).toHaveLength(0);
  });

  it('后端进程掉线 → 在跑的 run 如实标成失败，而不是永远转圈', async () => {
    const fake = installFakeBackend();

    const { resetTransport } = await import('@/api/transport');
    resetTransport();
    const { resetEventChannel } = await import('@/api/events');
    resetEventChannel();
    const { useDemoStore } = await import('@/store/useDemoStore');

    useDemoStore.getState().resetDemo();
    useDemoStore.getState().createProject('P1', '项目一');
    await useDemoStore.getState().createTask('实现贪吃蛇', undefined, ['游戏可运行']);
    await vi.waitFor(() => expect(useDemoStore.getState().tasks[0].contractRunId).toBe('run-1'));
    fake.emit(evt('run-1', 'task.created', { spec: '实现贪吃蛇' }));
    expect(useDemoStore.getState().liveRuns['run-1'].status).toBe('running');

    // 后端进程没了（崩溃 / 被重启杀掉）
    useDemoStore.getState().failLiveRuns('后端进程已重启或退出，该 run 已中断。');

    const run = useDemoStore.getState().liveRuns['run-1'];
    expect(run.status).toBe('failed');
    expect(run.error).toContain('中断');
    // 任务被推到终态 —— 不会再挂着「执行中」等一个永远不来的事件
    expect(useDemoStore.getState().tasks[0].stage).toBe('delivery');
  });

  it('后端事件永远不会启动终端进程（R3/I5 硬红线）', async () => {
    const fake = installFakeBackend();

    const { resetTransport } = await import('@/api/transport');
    resetTransport();
    const { resetEventChannel } = await import('@/api/events');
    resetEventChannel();
    const { resetTerminalChannel } = await import('@/api/terminal');
    resetTerminalChannel();
    const { useDemoStore } = await import('@/store/useDemoStore');

    useDemoStore.getState().resetDemo();
    useDemoStore.getState().createProject('P1', '项目一');
    await useDemoStore.getState().createTask('写一个贪吃蛇', undefined, ['游戏可运行']);
    await vi.waitFor(() => expect(useDemoStore.getState().tasks[0].contractRunId).toBe('run-1'));

    // agent 干活时会往工作区写 .py —— 后端把这件事作为事件推上来。
    // 这些事件里的任何一条都不能变成一次执行：那就是 agent → 宿主的静默 RCE 通道。
    fake.emit(evt('run-1', 'task.created', { spec: '写一个贪吃蛇' }));
    fake.emit(evt('run-1', 'driver.session_started', { driver_id: 'acp-external' }));
    fake.emit(
      evt('run-1', 'artifact.registered', {
        type: 'diff',
        path: 'snake.py',
        run_cmd: 'python snake.py',
      }),
    );
    fake.emit(evt('run-1', 'worktree.materialized', { files_written: 1 }));
    fake.emit(evt('run-1', 'run.completed', {}));

    expect(fake.terminal.start).not.toHaveBeenCalled();
    // 运行意图令牌同理：它只能由用户那一次点击写入。
    expect(useDemoStore.getState().pendingRunIntent).toBeNull();
    expect(useDemoStore.getState().termSessions).toEqual([]);
  });

  it('删除任务会退订它那次 run，并清掉 liveRuns 里的条目', async () => {
    const fake = installFakeBackend();

    const { resetTransport } = await import('@/api/transport');
    resetTransport();
    const { resetEventChannel } = await import('@/api/events');
    resetEventChannel();
    const { useDemoStore } = await import('@/store/useDemoStore');

    useDemoStore.getState().resetDemo();
    useDemoStore.getState().createProject('P1', '并发用例');

    await useDemoStore.getState().createTask('实现贪吃蛇', undefined, ['游戏可运行']);
    await vi.waitFor(() => expect(useDemoStore.getState().tasks[0].contractRunId).toBe('run-1'));
    fake.emit(evt('run-1', 'task.created', { spec: '实现贪吃蛇' }));
    expect(useDemoStore.getState().liveRuns['run-1']).toBeDefined();

    const taskId = useDemoStore.getState().tasks[0].id;
    useDemoStore.getState().deleteTask(taskId);

    expect(useDemoStore.getState().liveRuns['run-1']).toBeUndefined();
    await vi.waitFor(() =>
      expect(fake.calls('run.unsubscribe').map((c) => c.params)).toEqual([{ run_id: 'run-1' }]),
    );
  });
});
