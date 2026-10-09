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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunEvent, RunSnapshot } from '@/api/types/rpc';
import type { TaskSnapshot } from '@/api/types/task';
import { runStateOf } from '@/lib/runState';
import { canBindWorkspace } from '@/store/lib/liveRuns';

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
function installFakeBackend(
  options: {
    snapshots?: Record<string, RunSnapshot>;
    taskSnapshots?: Record<string, TaskSnapshot>;
    workspace?: string;
  } = {},
) {
  const eventCbs = new Set<BackendEventCb>();
  const statusCbs = new Set<(status: unknown) => void>();
  const rpc: Array<{ method: string; params: unknown }> = [];
  const historicalRuns = new Set<string>();
  let created = 0;
  const readyStatus = { ...READY_STATUS, workspace: options.workspace ?? READY_STATUS.workspace };

  const backend = {
    call: vi.fn(async (method: string, params: unknown) => {
      rpc.push({ method, params });
      if (method === 'run.subscribe' && historicalRuns.has((params as { run_id: string }).run_id)) {
        return { ok: false as const, code: -32004, error: 'Run not found in live registry' };
      }
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
      if (method === 'task.subscribe' || method === 'task.get') {
        const taskId = (params as { task_id: string }).task_id;
        const index = Number(taskId.split('-')[1]);
        const snapshot = options.taskSnapshots?.[taskId] ?? {
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
        };
        return {
          ok: true as const,
          result:
            method === 'task.get' ? snapshot : { subscribed: true, snapshot, replay_events: [] },
        };
      }
      if (method === 'run.getSnapshot') {
        const runId = (params as { run_id: string }).run_id;
        if (options.snapshots?.[runId])
          return { ok: true as const, result: options.snapshots[runId] };
        // 本用例不测终态快照链路 —— 让它失败。store 会把错误记在对应 run 上，
        // 不影响已收到的事件时间线（这正是它该有的行为）。
        return { ok: false as const, error: '本用例不提供快照' };
      }
      if (method === 'run.getEvents') {
        const { run_id: runId, after_sequence = 0 } = params as {
          run_id: string;
          after_sequence?: number;
        };
        const events = options.snapshots?.[runId]?.timeline ?? [];
        return {
          ok: true as const,
          result: {
            events: events.filter((event) => event.sequence > after_sequence),
            after_sequence,
            latest_sequence: Math.max(0, ...events.map((event) => event.sequence)),
            has_more: false,
          },
        };
      }
      return { ok: true as const, result: {} };
    }),
    getStatus: vi.fn(async () => readyStatus),
    configure: vi.fn(async () => readyStatus),
    restart: vi.fn(async () => readyStatus),
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
    onStatus: (cb: (status: unknown) => void) => {
      statusCbs.add(cb);
      return () => statusCbs.delete(cb);
    },
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
    markHistorical: (runId: string) => historicalRuns.add(runId),
    terminal,
    /** 模拟后端推一条 run.event 上来 */
    emit(event: RunEvent) {
      eventCbs.forEach((cb) =>
        cb({ method: 'run.event', params: { run_id: event.run_id, event } }),
      );
    },
    emitTask(event: RunEvent) {
      eventCbs.forEach((cb) =>
        cb({ method: 'task.event', params: { task_id: event.task_id, event } }),
      );
    },
    calls: (method: string) => rpc.filter((c) => c.method === method),
    setStatus: (state: 'ready' | 'error' | 'stopped') => {
      statusCbs.forEach((cb) => cb({ ...readyStatus, state }));
    },
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
  afterEach(async () => {
    const { unwatchAllTasks } = await import('@/api/task');
    await unwatchAllTasks();
    const { resetEventChannel } = await import('@/api/events');
    resetEventChannel();
  });

  it('follows a Mailbox continuation to real delivery instead of freezing on the completed first Run', async () => {
    const workspace = 'C:\\Users\\tester\\Documents\\polaris-workspace\\cook';
    const taskSnapshots: Record<string, TaskSnapshot> = {
      'btask-1': {
        contract_version: 'task-snapshot.v0',
        schema_version: 'test',
        revision: 2,
        task: {
          task_id: 'btask-1',
          status: 'waiting_help',
          spec: 'Python game',
          risk_level: 'low',
          completion_criteria: ['Playable'],
          affected_paths: [],
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          schema_version: 'test',
        },
        run_history: [
          {
            run_id: 'run-1',
            task_id: 'btask-1',
            status: 'completed',
            mode: 'council',
            restartable: false,
          },
        ],
        warnings: [],
      },
    };
    const snapshots: Record<string, RunSnapshot> = {
      'run-1': {
        schema_version: 'test',
        run_id: 'run-1',
        task_id: 'btask-1',
        mode: 'council',
        status: 'completed',
        current: {
          stage: 'executing',
          active_node_code: 'N8',
          cursor: 'mailbox_wait',
          task_status: 'waiting_help',
        },
        timeline: [evt('run-1', 'run.completed', { outcome: 'mailbox_wait' })],
        agent_runs: [],
        artifacts: [],
        gates: [],
        errors: [],
      },
      'run-2': {
        schema_version: 'test',
        run_id: 'run-2',
        task_id: 'btask-1',
        mode: 'council',
        status: 'running',
        current: {
          stage: 'executing',
          active_node_code: 'N14',
          cursor: 'council',
          task_status: 'running',
        },
        timeline: [],
        agent_runs: [],
        artifacts: [],
        gates: [],
        errors: [],
      },
    };
    const fake = installFakeBackend({ snapshots, taskSnapshots, workspace });
    const { resetTransport } = await import('@/api/transport');
    resetTransport();
    const { resetEventChannel } = await import('@/api/events');
    resetEventChannel();
    const { useDemoStore } = await import('@/store/useDemoStore');
    useDemoStore.getState().resetDemo();
    useDemoStore.getState().createProject('cook', undefined, workspace);
    await useDemoStore.getState().createTask('Python game', undefined, ['Playable']);
    const taskId = useDemoStore.getState().tasks[0].id;
    const projectId = useDemoStore.getState().activeProjectId;
    expect(
      runStateOf(useDemoStore.getState().tasks[0], useDemoStore.getState().liveRuns['run-1']),
    ).toBe('waiting');
    expect(canBindWorkspace(useDemoStore.getState(), 'another-project').ok).toBe(false);
    taskSnapshots['btask-1'] = {
      ...taskSnapshots['btask-1'],
      revision: 3,
      task: { ...taskSnapshots['btask-1'].task, status: 'running' },
      current_run: {
        run_id: 'run-2',
        task_id: 'btask-1',
        status: 'running',
        mode: 'council',
        restartable: false,
      },
    };
    fake.emitTask({ ...evt('run-2', 'run.started'), task_id: 'btask-1' });
    await vi.waitFor(() => expect(useDemoStore.getState().tasks[0].contractRunId).toBe('run-2'));
    expect(useDemoStore.getState().tasks).toHaveLength(1);
    expect(useDemoStore.getState().tasks[0].id).toBe(taskId);
    expect(useDemoStore.getState().activeProjectId).toBe(projectId);
    snapshots['run-2'] = {
      ...snapshots['run-2'],
      status: 'completed',
      final_output: {
        status: 'completed',
        artifact_refs: [],
        files_written: [`${workspace}\\guess_number.py`],
        changed_files: ['guess_number.py'],
      },
    };
    taskSnapshots['btask-1'] = {
      ...taskSnapshots['btask-1'],
      revision: 4,
      task: { ...taskSnapshots['btask-1'].task, status: 'completed' },
      current_run: undefined,
      run_history: [
        {
          run_id: 'run-2',
          task_id: 'btask-1',
          status: 'completed',
          mode: 'council',
          restartable: false,
        },
        ...taskSnapshots['btask-1'].run_history,
      ],
    };
    fake.emit({ ...evt('run-2', 'run.completed'), task_id: 'btask-1' });
    fake.emitTask({ ...evt('run-2', 'task.completed'), task_id: 'btask-1' });
    await vi.waitFor(() =>
      expect(useDemoStore.getState().projects[0].files[0]?.name).toBe('guess_number.py'),
    );
    await vi.waitFor(() =>
      expect(
        runStateOf(useDemoStore.getState().tasks[0], useDemoStore.getState().liveRuns['run-2']),
      ).toBe('completed'),
    );
    expect(useDemoStore.getState().tasks[0].contractWorkspacePath).toBe(workspace);
    const { unwatchAllTasks } = await import('@/api/task');
    const { unwatchRun } = await import('@/api/events');
    const { recoverBackendTasks } = await import('@/store/lib/backendRecovery');
    await unwatchAllTasks();
    await unwatchRun();
    fake.markHistorical('run-2');
    taskSnapshots['btask-1'].task.workspace_path = workspace;
    const before = fake.calls('run.subscribe').length;
    useDemoStore.getState().resetDemo();
    useDemoStore.setState((state) => recoverBackendTasks(state, [taskSnapshots['btask-1']]));
    await useDemoStore.getState().observeTask('btask-1');
    await vi.waitFor(() =>
      expect(useDemoStore.getState().projects[0].files[0]?.name).toBe('guess_number.py'),
    );
    expect(fake.calls('run.subscribe')).toHaveLength(before);
    expect(useDemoStore.getState().activeProjectId).toBeNull();
  });

  it.each(['completed', 'failed', 'cancelled'] as const)(
    '%s 快照的交付文件进入所属项目，兼容 Windows 路径和缺少 diff/图数据',
    async (status) => {
      const workspace = 'C:\\Users\\tester\\Documents\\polaris-workspace\\天下';
      const snapshots: Record<string, RunSnapshot> = {
        'run-1': {
          schema_version: 'v0',
          run_id: 'run-1',
          task_id: 'btask-1',
          mode: 'single_agent',
          status: 'running',
          current: { stage: 'executing', active_node_code: 'N3' },
          timeline: [],
          agent_runs: [],
          artifacts: [{ artifact_id: 'result-bundle' }],
          gates: [],
          errors: [],
        },
      };
      const fake = installFakeBackend({ snapshots, workspace });
      const { resetTransport } = await import('@/api/transport');
      resetTransport();
      const { resetEventChannel } = await import('@/api/events');
      resetEventChannel();
      const { useDemoStore } = await import('@/store/useDemoStore');
      useDemoStore.getState().resetDemo();
      useDemoStore.getState().createProject('天下', '文件同步');
      const projectId = useDemoStore.getState().activeProjectId;
      await useDemoStore.getState().createTask('写一个 hello world', undefined, ['生成文件']);
      expect(useDemoStore.getState().tasks[0].contractWorkspacePath).toBe(workspace);
      expect(useDemoStore.getState().projects[0].files).toEqual([]);

      useDemoStore.getState().createProject('其他项目', '不应接收另一项目的文件');
      const files = [`${workspace}\\hello_world.py`, `${workspace}\\src\\main.py`];
      snapshots['run-1'] = {
        ...snapshots['run-1'],
        status,
        delivery_report: { files_written: files, artifacts_materialized: 1 },
        final_output: { status, files_written: files, artifact_refs: [] },
      };
      fake.emit(evt('run-1', `run.${status}`));
      const expected = [
        { name: 'hello_world.py', origin: 'live' },
        { name: 'src', children: [{ name: 'main.py', origin: 'live' }] },
      ];
      await vi.waitFor(() =>
        expect(
          useDemoStore.getState().projects.find((project) => project.id === projectId)?.files,
        ).toEqual(expected),
      );
      expect(
        useDemoStore.getState().projects.find((project) => project.id !== projectId)?.files,
      ).toEqual([]);

      useDemoStore.getState().attachLiveRun('run-1', snapshots['run-1']);
      expect(
        useDemoStore.getState().projects.find((project) => project.id === projectId)?.files,
      ).toEqual(expected);
      if (!projectId) throw new Error('Project was not created');
      useDemoStore.getState().openFile(projectId, 'src/main.py');
      expect(useDemoStore.getState().openedFile).toEqual({ projectId, path: 'src/main.py' });
    },
  );

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
    expect(useDemoStore.getState().liveRuns['run-1'].syncError).toContain('本用例不提供快照');
    expect(useDemoStore.getState().liveRuns['run-2'].syncError).toContain('本用例不提供快照');

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

  it('掉线不伪造执行失败，重连后用持久快照恢复用量和终态', async () => {
    vi.resetModules();
    const snapshots: Record<string, RunSnapshot> = {
      'run-1': {
        schema_version: 'v0',
        run_id: 'run-1',
        task_id: 'btask-1',
        mode: 'single_agent',
        status: 'running',
        current: { stage: 'executing', active_node_code: 'N3', cursor: 'select_agent' },
        timeline: [],
        agent_runs: [],
        artifacts: [],
        gates: [],
        errors: [],
        usage: {
          context: {
            metric: 'context_tokens_used',
            context_tokens_used: 42,
            complete: true,
            sessions: [],
          },
        },
      },
    };
    const fake = installFakeBackend({ snapshots });

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

    expect(
      useDemoStore.getState().liveRuns['run-1'].snapshot?.usage?.context?.context_tokens_used,
    ).toBe(42);
    fake.setStatus('error');
    expect(useDemoStore.getState().liveRuns['run-1'].status).toBe('running');
    expect(useDemoStore.getState().liveRuns['run-1'].syncError).toContain('连接中断');
    expect(fake.calls('run.unsubscribe')).toHaveLength(0);

    useDemoStore.setState((state) => ({
      liveRuns: {
        ...state.liveRuns,
        'run-1': {
          ...state.liveRuns['run-1'],
          timeline: [{ ...evt('run-1', 'run.completed'), sequence: 999 }],
        },
      },
    }));
    snapshots['run-1'] = {
      ...snapshots['run-1'],
      status: 'failed',
      current: { stage: 'delivery', active_node_code: 'N18', cursor: 'done' },
      timeline: [evt('run-1', 'run.failed')],
      usage: undefined,
    };
    fake.setStatus('ready');
    await vi.waitFor(() => expect(useDemoStore.getState().liveRuns['run-1'].status).toBe('failed'));
    await vi.waitFor(() => expect(useDemoStore.getState().liveRuns['run-1'].syncError).toBeNull());
    expect(useDemoStore.getState().liveRuns['run-1'].snapshot?.usage).toBeUndefined();
    expect(useDemoStore.getState().tasks[0].stage).toBe('delivery');
    // 已结束的持久 run 不必在新进程的内存 registry 里重新订阅。
    expect(fake.calls('run.subscribe')).toHaveLength(1);
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
