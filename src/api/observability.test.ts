import { afterEach, describe, expect, it, vi } from 'vitest';
import { runApi } from './run';
import { BackendError, getTransport, resetTransport } from './transport';
import { RPC_METHOD_SET } from './rpcMethods';
import type { RunGetEventsResult, RunGetUsageResult } from './types/observability';
import type { RunEvent, RunSnapshot } from './types/rpc';

const event: RunEvent = {
  event_id: 'event-1',
  sequence: 4,
  run_id: 'run-1',
  task_id: 'task-1',
  type: 'driver.tool_started',
  source: 'driver',
  created_at: '2026-10-04T12:00:03.000Z',
  payload: { payload_ref: 'driver-stream.jsonl#stream_sequence=0', tool_name: 'Edit' },
  schema_version: 'v0',
};

function ipcBackend(responses: Record<string, unknown>) {
  let failure: { code: number; error: string } | undefined;
  const call = vi.fn(async (method: string, params: unknown) => {
    expect(params).toBeTypeOf('object');
    if (failure) return { ok: false as const, ...failure };
    return { ok: true as const, result: responses[method] };
  });
  vi.stubGlobal('window', { desktop: { backend: { call } } });
  return {
    call,
    fail: (code: number) => {
      failure = { code, error: 'backend rejected request' };
    },
  };
}

afterEach(() => {
  resetTransport();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('run observability RPC boundary', () => {
  it('forwards all new methods through the shared IPC allowlist without changing their envelopes', async () => {
    const events: RunGetEventsResult = {
      events: [event, { ...event, event_id: 'same-sequence' }],
      after_sequence: 0,
      latest_sequence: 9,
      has_more: true,
    };
    const usage: RunGetUsageResult = {
      history: {
        scope: 'system',
        as_of: event.created_at,
        runs_counted: 0,
        runs_without_usage: 0,
        complete: false,
        billed: {
          totals: {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            total_input_tokens: 0,
            total_tokens: 0,
            call_count: 0,
          },
          by_source: {},
        },
      },
    };
    const payload = {
      payload_ref: 'driver-stream.jsonl#stream_sequence=0',
      event: { event_type: 'driver.tool_started', payload: { raw_input: 'full content' } },
    };
    const backend = ipcBackend({
      'run.getEvents': events,
      'run.getUsage': usage,
      'run.getPayload': payload,
      'run.subscribe': { subscribed: true },
    });
    for (const method of ['run.getEvents', 'run.getUsage', 'run.getPayload'] as const) {
      expect(RPC_METHOD_SET.has(method)).toBe(true);
    }
    expect(await runApi.getEvents('run-1', { after_sequence: 0, limit: 500 })).toEqual(events);
    expect(await runApi.getUsage({ scope: 'system', run_id: 'run-1' })).toEqual(usage);
    expect(await runApi.getPayload('run-1', payload.payload_ref)).toEqual(payload);
    await runApi.subscribe('run-1', 0);
    expect(backend.call.mock.calls).toEqual([
      ['run.getEvents', { run_id: 'run-1', after_sequence: 0, limit: 500 }],
      ['run.getUsage', { scope: 'system', run_id: 'run-1' }],
      ['run.getPayload', { run_id: 'run-1', payload_ref: payload.payload_ref }],
      ['run.subscribe', { run_id: 'run-1', after_sequence: 0 }],
    ]);
    expect(usage.usage).toBeUndefined();
  });

  it.each(['task', 'role', 'run'] as const)(
    'preserves the %s scope and its required identity',
    async (scope) => {
      const backend = ipcBackend({ 'run.getUsage': {} });
      await runApi.getUsage({ scope, scope_id: 'scope-1', run_id: 'run-1' });
      expect(backend.call).toHaveBeenCalledWith('run.getUsage', {
        scope,
        scope_id: 'scope-1',
        run_id: 'run-1',
      });
    },
  );

  it('retains usage, activity, cursor, and invocation metadata in snapshots', async () => {
    const snapshot: RunSnapshot = {
      schema_version: 'v0',
      run_id: 'run-1',
      task_id: 'task-1',
      mode: 'single_agent',
      status: 'running',
      current: {
        stage: 'executing',
        active_node_code: 'N8',
        cursor: 'execute_agent',
        invocation_id: 'invoke-1',
        stage_started_at: event.created_at,
      },
      usage: {
        context: {
          metric: 'context_tokens_used',
          context_tokens_used: 0,
          complete: false,
          sessions: [],
        },
      },
      activity: {
        subject: 'agent',
        agents: [
          {
            role_id: 'role-1',
            state: 'delegating',
            since: event.created_at,
            seq: 1,
            stale: false,
            tool_name: 'invoke_driver',
            driver: {
              state: 'tool_running',
              since: event.created_at,
              last_event_at: event.created_at,
              stale: true,
              tool_name: 'Edit',
            },
          },
        ],
      },
      timeline: [event],
      agent_runs: [],
      artifacts: [],
      gates: [],
      errors: [],
    };
    ipcBackend({ 'run.getSnapshot': snapshot });
    expect(await runApi.getSnapshot('run-1')).toEqual(snapshot);
  });

  it.each([-32601, -32602, -32004, -32017])('preserves backend error code %s', async (code) => {
    const backend = ipcBackend({});
    backend.fail(code);
    await expect(
      runApi.getPayload('run-1', 'driver-stream.jsonl#sequence=0'),
    ).rejects.toMatchObject({ name: 'BackendError', code });
  });
});

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  close = vi.fn();
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
}

describe('Web observability transport', () => {
  it('keeps the RPC version error from an older bridge HTTP rejection', async () => {
    vi.stubGlobal('window', {});
    vi.stubEnv('VITE_BACKEND_WEB_URL', 'http://127.0.0.1:43127');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { code: -32601, message: 'Unauthorized RPC method: run.getUsage' },
            }),
            { status: 403, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );
    await expect(runApi.getUsage({ scope: 'system' })).rejects.toMatchObject({ code: -32601 });
  });
  it('shares one SSE connection and reports reconnection so run subscriptions can be restored', async () => {
    FakeEventSource.instances = [];
    vi.stubGlobal('window', {});
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubEnv('VITE_BACKEND_WEB_URL', 'http://127.0.0.1:43127');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ result: { ok: true } }))),
    );
    const transport = getTransport();
    const states: string[] = [];
    const notifications: unknown[] = [];
    const offStatus = transport.onStatus((status) => states.push(status.state));
    const offFirst = transport.onNotification((notification) => notifications.push(notification));
    const offSecond = transport.onNotification(() => undefined);
    expect(FakeEventSource.instances).toHaveLength(1);
    const source = FakeEventSource.instances[0];
    await vi.waitFor(() => expect(states[states.length - 1]).toBe('ready'));
    source.onerror?.();
    expect(states[states.length - 1]).toBe('error');
    source.onopen?.();
    await vi.waitFor(() => expect(states[states.length - 1]).toBe('ready'));
    const notification = { method: 'run.event', params: { run_id: 'run-1', event } };
    source.onmessage?.(new MessageEvent('message', { data: JSON.stringify(notification) }));
    expect(notifications).toEqual([notification]);
    offFirst();
    offSecond();
    expect(source.close).not.toHaveBeenCalled();
    offStatus();
    expect(source.close).toHaveBeenCalledOnce();
  });

  it('preserves payload errors through the HTTP JSON-RPC envelope', async () => {
    vi.stubGlobal('window', {});
    vi.stubEnv('VITE_BACKEND_WEB_URL', 'http://127.0.0.1:43127');
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: -32017, message: 'Payload ref unavailable', data: { run_id: 'run-1' } },
          }),
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = runApi.getPayload('run-1', 'driver-stream.jsonl#stream_sequence=0');
    await expect(result).rejects.toBeInstanceOf(BackendError);
    await expect(result).rejects.toMatchObject({ code: -32017, data: { run_id: 'run-1' } });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:43127/rpc',
      expect.objectContaining({
        body: expect.stringContaining('"payload_ref":"driver-stream.jsonl#stream_sequence=0"'),
      }),
    );
  });
});
