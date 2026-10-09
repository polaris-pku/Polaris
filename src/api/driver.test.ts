import { afterEach, describe, expect, it, vi } from 'vitest';
import { driverApi } from './driver';
import { resetTransport } from './transport';
import { RPC_METHOD_SET } from './rpcMethods';
import type { DriverRoutingSnapshot } from './types/driverRouting';

const snapshot: DriverRoutingSnapshot = {
  schema_version: 'driver-routing.v1',
  revision: `sha256:${'a'.repeat(64)}`,
  scope: 'project',
  default_driver: 'acp-external',
  drivers: [
    {
      driver_id: 'acp-external',
      agent: 'claude',
      selectable: true,
      status: 'degraded',
      reason_code: 'AGENT_CLI_READINESS_NOT_VERIFIABLE',
    },
  ],
  roles: [],
  orphan_roles: [],
};

afterEach(() => {
  resetTransport();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('driver routing RPC boundary', () => {
  it('uses exact params and bare snapshot results through the shared IPC allowlist', async () => {
    const call = vi
      .fn<
        (method: string, params: unknown) => Promise<{ ok: true; result: DriverRoutingSnapshot }>
      >()
      .mockResolvedValue({ ok: true, result: snapshot });
    vi.stubGlobal('window', { desktop: { backend: { call } } });
    const update = {
      expected_revision: snapshot.revision,
      default_driver: 'acp-external',
      roles: { orphan: 'acp-external' },
    };
    expect(await driverApi.getConfig()).toEqual(snapshot);
    expect(await driverApi.updateRouting(update)).toEqual(snapshot);
    expect(await driverApi.resetRouting({ expected_revision: snapshot.revision })).toEqual(
      snapshot,
    );
    expect(call.mock.calls).toEqual([
      ['driver.getConfig', {}],
      ['driver.updateRouting', update],
      ['driver.resetRouting', { expected_revision: snapshot.revision }],
    ]);
    for (const method of [
      'driver.getConfig',
      'driver.updateRouting',
      'driver.resetRouting',
    ] as const) {
      expect(RPC_METHOD_SET.has(method)).toBe(true);
    }
  });

  it.each([-32021, -32022, -32023, -32024, -32025, -32026, -32602, -32601])(
    'preserves error %s and its structured data through IPC',
    async (code) => {
      const data = { reason: 'test', field: 'roles.reviewer', locked_driver_id: 'claude' };
      vi.stubGlobal('window', {
        desktop: { backend: { call: async () => ({ ok: false, error: 'rejected', code, data }) } },
      });
      await expect(driverApi.getConfig()).rejects.toMatchObject({
        name: 'BackendError',
        code,
        data,
      });
    },
  );

  it('uses the same methods and conflict data over the Web bridge', async () => {
    vi.stubGlobal('window', {});
    vi.stubEnv('VITE_BACKEND_WEB_URL', 'http://127.0.0.1:43127');
    const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>().mockResolvedValue(
      new Response(JSON.stringify({ result: snapshot }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    expect(await driverApi.getConfig()).toEqual(snapshot);
    const request = JSON.parse(String(fetch.mock.calls[0][1].body));
    expect(request).toMatchObject({ method: 'driver.getConfig', params: {}, id: 1 });
    fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: -32021, message: 'changed', data: { current_revision: 'new-revision' } },
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      ),
    );
    await expect(
      driverApi.resetRouting({ expected_revision: snapshot.revision }),
    ).rejects.toMatchObject({
      code: -32021,
      data: { current_revision: 'new-revision' },
    });
  });
});
