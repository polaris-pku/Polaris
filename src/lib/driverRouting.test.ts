import { describe, expect, it, vi } from 'vitest';
import { BackendError } from '@/api/transport';
import type {
  DriverRoutingSnapshot,
  ResetDriverRoutingInput,
  UpdateDriverRoutingInput,
} from '@/api/types/driverRouting';
import {
  createDriverRoutingEditor,
  rebaseRoutingDraft,
  routingDraft,
  routingIssue,
  routingUpdate,
} from './driverRouting';

function snapshot(revision = 'a'): DriverRoutingSnapshot {
  return {
    schema_version: 'driver-routing.v1',
    revision: `sha256:${revision.repeat(64)}`,
    scope: 'project',
    default_driver: 'claude',
    drivers: ['claude', 'codex'].map((driver_id) => ({
      driver_id,
      agent: driver_id,
      selectable: true,
      status: 'degraded' as const,
      reason_code: 'AGENT_CLI_READINESS_NOT_VERIFIABLE',
    })),
    roles: [
      {
        role_id: 'engineer',
        driver_id: 'claude',
        effective_driver_id: 'claude',
        source: 'default',
        known_role: true,
      },
      {
        role_id: 'reviewer',
        driver_id: 'codex',
        effective_driver_id: 'codex',
        source: 'role_override',
        known_role: true,
      },
      {
        role_id: 'old-role',
        driver_id: 'codex',
        effective_driver_id: 'codex',
        source: 'role_override',
        known_role: false,
      },
    ],
    orphan_roles: [
      {
        role_id: 'old-role',
        driver_id: 'codex',
        effective_driver_id: 'codex',
        source: 'role_override',
        known_role: false,
      },
    ],
  };
}

function fixture() {
  const initial = snapshot();
  const api = {
    getConfig: vi.fn(async () => initial),
    updateRouting: vi
      .fn<(input: UpdateDriverRoutingInput) => Promise<DriverRoutingSnapshot>>()
      .mockResolvedValue(snapshot('b')),
    resetRouting: vi
      .fn<(input: ResetDriverRoutingInput) => Promise<DriverRoutingSnapshot>>()
      .mockResolvedValue(snapshot('c')),
  };
  return { api, initial, editor: createDriverRoutingEditor(api) };
}

describe('driver routing editor', () => {
  it('saves a complete role map, including orphan roles, when only the default is edited', async () => {
    const { api, initial, editor } = fixture();
    await editor.getState().load();
    editor.getState().changeDefault('codex');
    await editor.getState().save();
    expect(api.updateRouting).toHaveBeenCalledTimes(1);
    expect(api.updateRouting).toHaveBeenCalledWith({
      expected_revision: initial.revision,
      default_driver: 'codex',
      roles: { engineer: 'claude', reviewer: 'codex', 'old-role': 'codex' },
    });
    expect(editor.getState().snapshot).toEqual(snapshot('b'));
    expect(editor.getState().draft).toEqual(routingDraft(snapshot('b')));
  });

  it('builds idempotent requests without filtering degraded drivers or unconfirmed roles', () => {
    const initial = snapshot();
    expect(routingUpdate(initial, routingDraft(initial))).toEqual({
      expected_revision: initial.revision,
      ...routingDraft(initial),
    });
    expect(
      routingUpdate(initial, { default_driver: 'claude', roles: { engineer: 'codex' } }).roles,
    ).toEqual({ engineer: 'codex', reviewer: 'codex', 'old-role': 'codex' });
  });

  it('keeps edits on conflict, fetches the current revision and never silently retries', async () => {
    const { api, initial, editor } = fixture();
    const latest = snapshot('b');
    latest.roles[1] = { ...latest.roles[1], driver_id: 'claude', effective_driver_id: 'claude' };
    latest.roles.push({ ...latest.roles[2], role_id: 'new-orphan' });
    api.getConfig.mockResolvedValueOnce(initial).mockResolvedValue(latest);
    api.updateRouting.mockRejectedValueOnce(
      new BackendError('conflict', 'driver.updateRouting', -32021),
    );
    await editor.getState().load();
    editor.getState().changeRole('engineer', 'codex');
    await editor.getState().save();
    expect(api.updateRouting).toHaveBeenCalledTimes(1);
    expect(api.getConfig).toHaveBeenCalledTimes(2);
    expect(editor.getState().draft?.roles.engineer).toBe('codex');
    expect(editor.getState().snapshot?.revision).toBe(initial.revision);
    await editor.getState().save();
    expect(api.updateRouting).toHaveBeenCalledTimes(1);
    editor.getState().resolveConflict(true);
    expect(editor.getState().draft?.roles).toEqual({
      engineer: 'codex',
      reviewer: 'claude',
      'old-role': 'codex',
      'new-orphan': 'codex',
    });
    expect(api.updateRouting).toHaveBeenCalledTimes(1);
    await editor.getState().save();
    expect(api.updateRouting.mock.calls[1][0]).toMatchObject({
      expected_revision: latest.revision,
    });
  });

  it('can explicitly discard edits in favor of the conflicting snapshot', async () => {
    const { api, editor } = fixture();
    await editor.getState().load();
    editor.getState().changeRole('engineer', 'codex');
    api.updateRouting.mockRejectedValueOnce(
      new BackendError('conflict', 'driver.updateRouting', -32021),
    );
    api.getConfig.mockResolvedValue(snapshot('b'));
    await editor.getState().save();
    editor.getState().resolveConflict(false);
    expect(editor.getState().draft).toEqual(routingDraft(snapshot('b')));
    expect(api.updateRouting).toHaveBeenCalledTimes(1);
  });

  it('retries a busy save with exactly the original request and revision', async () => {
    const { api, editor } = fixture();
    await editor.getState().load();
    editor.getState().changeRole('engineer', 'codex');
    api.updateRouting.mockRejectedValueOnce(
      new BackendError('busy', 'driver.updateRouting', -32026),
    );
    await editor.getState().save();
    const first = api.updateRouting.mock.calls[0][0];
    expect(editor.getState().issue?.kind).toBe('busy');
    expect(api.updateRouting).toHaveBeenCalledTimes(1);
    await editor.getState().retry();
    expect(api.updateRouting.mock.calls[1][0]).toEqual(first);
  });

  it('does not replay an obsolete busy request after further edits', async () => {
    const { api, editor } = fixture();
    await editor.getState().load();
    api.updateRouting.mockRejectedValueOnce(
      new BackendError('busy', 'driver.updateRouting', -32026),
    );
    await editor.getState().save();
    editor.getState().changeRole('engineer', 'codex');
    await editor.getState().retry();
    expect(api.updateRouting).toHaveBeenCalledTimes(1);
  });

  it('restores a deployment-locked default while retaining edited roles', async () => {
    const { api, initial, editor } = fixture();
    await editor.getState().load();
    editor.getState().changeDefault('codex');
    editor.getState().changeRole('engineer', 'codex');
    api.updateRouting.mockRejectedValueOnce(
      new BackendError('locked', 'driver.updateRouting', -32025, {
        field: 'default_driver',
        locked_driver_id: 'claude',
      }),
    );
    await editor.getState().save();
    expect(editor.getState().draft).toEqual({
      default_driver: 'claude',
      roles: { ...routingDraft(initial).roles, engineer: 'codex' },
    });
    expect(editor.getState().lockedDriverId).toBe('claude');
    editor.getState().changeDefault('codex');
    expect(editor.getState().draft?.default_driver).toBe('claude');
    await editor.getState().save();
    expect(api.updateRouting).toHaveBeenCalledTimes(2);
  });

  it('resets only with the last snapshot revision and accepts the returned snapshot', async () => {
    const { api, initial, editor } = fixture();
    await editor.getState().load();
    await editor.getState().reset();
    expect(api.resetRouting).toHaveBeenCalledTimes(1);
    expect(api.resetRouting).toHaveBeenCalledWith({ expected_revision: initial.revision });
    expect(editor.getState().snapshot).toEqual(snapshot('c'));
  });

  it('applies conflict protection and exact-request retry to resets as well', async () => {
    const { api, initial, editor } = fixture();
    await editor.getState().load();
    api.resetRouting.mockRejectedValueOnce(new BackendError('busy', 'driver.resetRouting', -32026));
    await editor.getState().reset();
    await editor.getState().retry();
    expect(api.resetRouting.mock.calls.map((call) => call[0])).toEqual([
      { expected_revision: initial.revision },
      { expected_revision: initial.revision },
    ]);
    api.resetRouting.mockRejectedValueOnce(
      new BackendError('conflict', 'driver.resetRouting', -32021),
    );
    await editor.getState().reset();
    expect(editor.getState().issue?.kind).toBe('conflict');
    expect(editor.getState().conflict).not.toBeNull();
  });

  it('does not drop unsaved edits when refreshing an unchanged revision', async () => {
    const { editor } = fixture();
    await editor.getState().load();
    editor.getState().changeRole('engineer', 'codex');
    await editor.getState().load();
    expect(editor.getState().draft?.roles.engineer).toBe('codex');
  });

  it('ignores responses from a closed or superseded editor', async () => {
    const { api, editor } = fixture();
    let resolve!: (snapshot: DriverRoutingSnapshot) => void;
    api.getConfig.mockReturnValueOnce(
      new Promise((value) => {
        resolve = value;
      }),
    );
    const first = editor.getState().load();
    editor.getState().cancel();
    api.getConfig.mockResolvedValue(snapshot('b'));
    await editor.getState().load();
    resolve(snapshot('a'));
    await first;
    expect(editor.getState().snapshot?.revision).toBe(snapshot('b').revision);
  });

  it('preserves arbitrary role keys and remote mappings when rebasing', () => {
    const initial = snapshot();
    const draft = {
      ...routingDraft(initial),
      roles: { ...routingDraft(initial).roles, ['__proto__']: 'codex' },
    };
    expect(
      Object.prototype.hasOwnProperty.call(
        rebaseRoutingDraft(initial, draft, snapshot('b')).roles,
        '__proto__',
      ),
    ).toBe(true);
  });

  it.each([-32022, -32023, -32024, -32601, -32602])(
    'surfaces %s without claiming a successful save',
    async (code) => {
      const { api, initial, editor } = fixture();
      await editor.getState().load();
      api.updateRouting.mockRejectedValueOnce(
        new BackendError('rejected', 'driver.updateRouting', code, {
          field: 'roles.engineer',
          driver_id: 'missing',
          error_summary: 'EACCES',
          limitations: ['Needs a configured runner'],
        }),
      );
      await editor.getState().save();
      expect(editor.getState().snapshot).toEqual(initial);
      expect(editor.getState().notice).toBeNull();
      expect(editor.getState().issue).toMatchObject(
        routingIssue(
          new BackendError('rejected', 'driver.updateRouting', code, {
            field: 'roles.engineer',
            driver_id: 'missing',
            error_summary: 'EACCES',
            limitations: ['Needs a configured runner'],
          }),
        ),
      );
      expect(editor.getState().busy).toBe(false);
    },
  );
});
