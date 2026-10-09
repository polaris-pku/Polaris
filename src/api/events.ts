import { BackendError, getTransport } from './transport';
import type { BackendState, BackendStatus } from './transport';
import type { Event } from './types';
import type { RunEvent, RunSnapshot } from './types/rpc';
import { latestSequence, terminalRunStatus } from '@/lib/runTimeline';

export type RunEventHandler = (event: RunEvent) => void;
export type EventHandler = (event: Event) => void;
export type EventChannelStatus = 'disconnected' | 'connecting' | 'connected';
export type RunResyncReason = 'initial' | 'refresh' | 'terminal' | 'gap' | 'reconnect';

export interface RunResync {
  run_id: string;
  reason: RunResyncReason;
  snapshot: RunSnapshot;
  eventsDuringSync: readonly RunEvent[];
}

export type RunResyncHandler = (resync: RunResync) => void;
export type RunSyncErrorHandler = (update: { run_id: string; error: string | null }) => void;

export const RUN_OBSERVATION_INTERVAL_MS = 2000;

const runHandlers = new Set<RunEventHandler>();
const legacyHandlers = new Set<EventHandler>();
const statusHandlers = new Set<(status: EventChannelStatus) => void>();
const resyncHandlers = new Set<RunResyncHandler>();
const syncErrorHandlers = new Set<RunSyncErrorHandler>();
const reconnectHandlers = new Set<() => void>();
const seen = new Set<string>();
const subscribedRunIds = new Set<string>();

interface RunCursor {
  applied: number;
  syncing: boolean;
  status: RunSnapshot['status'];
  settlePolls: number;
  retry: boolean;
  unavailable?: boolean;
  needsSubscription?: boolean;
  receivedDuringSync: RunEvent[];
  pendingReason?: RunResyncReason;
  recoveryFrom?: number;
  timer?: ReturnType<typeof setTimeout>;
}

const cursors = new Map<string, RunCursor>();
let detachTransport: (() => void) | undefined;
let lastBackendState: BackendState | null = null;

function toChannelStatus(status: BackendStatus): EventChannelStatus {
  if (status.state === 'ready') return 'connected';
  if (status.state === 'starting') return 'connecting';
  return 'disconnected';
}

function toLegacyEvent(event: RunEvent): Event {
  return {
    event_id: event.event_id,
    event_type: event.type as Event['event_type'],
    subject_id: event.run_id,
    run_id: event.run_id,
    task_id: event.task_id,
    payload: event.payload,
    created_at: event.created_at,
    schema_version: event.schema_version as Event['schema_version'],
  };
}

function deliver(event: RunEvent): void {
  if (seen.has(event.event_id)) return;
  seen.add(event.event_id);
  runHandlers.forEach((handler) => handler(event));
  const legacy = toLegacyEvent(event);
  legacyHandlers.forEach((handler) => handler(legacy));
}

function reportSyncError(runId: string, error: string | null): void {
  syncErrorHandlers.forEach((handler) => handler({ run_id: runId, error }));
  if (error) console.warn(`[run observation] ${runId}: ${error}`);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function scheduleRefresh(runId: string, cursor: RunCursor): void {
  clearTimeout(cursor.timer);
  if (cursors.get(runId) !== cursor || !subscribedRunIds.has(runId)) return;
  if (cursor.unavailable) return;
  if (lastBackendState !== null && lastBackendState !== 'ready') return;
  if (cursor.status !== 'running' && cursor.settlePolls === 0 && !cursor.retry) return;
  cursor.timer = setTimeout(() => {
    void syncRun(runId, 'refresh');
  }, RUN_OBSERVATION_INTERVAL_MS);
}

/**
 * Snapshots provide activity even when no state event is emitted. Recovery additionally
 * backfills events, then replaces the connection-scoped subscription at the snapshot watermark.
 */
async function syncRun(runId: string, reason: RunResyncReason): Promise<void> {
  const cursor = cursors.get(runId);
  if (!cursor || !subscribedRunIds.has(runId)) return;
  if (cursor.syncing) {
    if (reason !== 'refresh') {
      if (cursor.pendingReason !== 'reconnect') cursor.pendingReason = reason;
      cursor.recoveryFrom = Math.min(cursor.recoveryFrom ?? cursor.applied, cursor.applied);
    }
    return;
  }
  cursor.syncing = true;
  cursor.receivedDuringSync = [];
  clearTimeout(cursor.timer);
  const transport = getTransport();
  const active = () => cursors.get(runId) === cursor && subscribedRunIds.has(runId);
  const after = reason === 'reconnect' ? 0 : (cursor.recoveryFrom ?? cursor.applied);
  cursor.recoveryFrom = undefined;
  if (reason === 'reconnect') cursor.applied = 0;
  if (reason === 'gap' || reason === 'reconnect') cursor.needsSubscription = true;
  let warning: string | null = null;

  try {
    if (reason === 'gap' || reason === 'reconnect') {
      try {
        // No limit: a page boundary may split events sharing a sequence.
        const result = await transport.call('run.getEvents', {
          run_id: runId,
          after_sequence: after,
        });
        if (!active()) return;
        result.events.forEach(deliver);
        if (!result.has_more) cursor.applied = Math.max(cursor.applied, result.latest_sequence);
      } catch (error) {
        warning =
          error instanceof BackendError && error.code === -32601
            ? '后端版本不支持增量事件，已改用完整快照；请更新后端。'
            : `事件补拉失败：${errorText(error)}`;
      }
    }

    const snapshot = await transport.call('run.getSnapshot', { run_id: runId });
    if (!active()) return;
    cursor.unavailable = false;
    const watermark = latestSequence(snapshot.timeline);
    snapshot.timeline.forEach(deliver);
    if (cursor.pendingReason === 'gap' && watermark >= cursor.applied) {
      cursor.pendingReason = undefined;
      cursor.recoveryFrom = undefined;
    }
    cursor.applied = Math.max(cursor.applied, watermark);
    if (cursor.status === 'running' && snapshot.status !== 'running') cursor.settlePolls = 2;
    else if (snapshot.status !== 'running' && reason === 'refresh') {
      cursor.settlePolls = Math.max(0, cursor.settlePolls - 1);
    }
    cursor.status = snapshot.status;
    cursor.retry = (snapshot.usage?.billed?.pending_sources?.length ?? 0) > 0;
    resyncHandlers.forEach((handler) =>
      handler({
        run_id: runId,
        reason,
        snapshot,
        eventsDuringSync: [...cursor.receivedDuringSync],
      }),
    );

    if (cursor.needsSubscription && snapshot.status === 'running') {
      try {
        await transport.call('run.subscribe', { run_id: runId, after_sequence: watermark });
      } catch (error) {
        if (error instanceof BackendError && error.code === -32602) {
          await transport.call('run.subscribe', { run_id: runId });
          warning = '后端版本不支持订阅水位，已改用全量重放；请更新后端。';
        } else {
          throw error;
        }
      }
    }
    cursor.needsSubscription = false;
    if (active()) reportSyncError(runId, warning);
  } catch (error) {
    if (active()) {
      cursor.retry = !(error instanceof BackendError && error.code === -32004);
      cursor.unavailable = !cursor.retry;
      reportSyncError(runId, `运行状态同步失败：${errorText(error)}`);
    }
  } finally {
    cursor.syncing = false;
    if (active()) {
      const pending = cursor.pendingReason;
      cursor.pendingReason = undefined;
      if (pending) void syncRun(runId, pending);
      else scheduleRefresh(runId, cursor);
    }
  }
}

function ingest(event: RunEvent): void {
  const cursor = cursors.get(event.run_id);
  const known = seen.has(event.event_id);
  if (cursor) {
    if (!known && cursor.applied > 0 && event.sequence > cursor.applied + 1) {
      void syncRun(event.run_id, 'gap');
    }
    cursor.applied = Math.max(cursor.applied, event.sequence);
    if (cursor.syncing) cursor.receivedDuringSync.push(event);
  }
  deliver(event);
  if (cursor?.unavailable) {
    cursor.unavailable = false;
    void syncRun(event.run_id, 'refresh');
  }
  if (!known && terminalRunStatus(event.type)) {
    void syncRun(event.run_id, 'terminal');
  }
}

function receiveStatus(status: BackendStatus): void {
  const previous = lastBackendState;
  lastBackendState = status.state;
  statusHandlers.forEach((handler) => handler(toChannelStatus(status)));
  if (status.state !== 'ready') {
    for (const cursor of cursors.values()) clearTimeout(cursor.timer);
    return;
  }
  if (previous !== null && previous !== 'ready') {
    reconnectHandlers.forEach((handler) => handler());
    for (const runId of subscribedRunIds) void syncRun(runId, 'reconnect');
  }
}

function attach(): void {
  if (detachTransport) return;
  const transport = getTransport();
  const offNotification = transport.onNotification((notification) =>
    ingest(notification.params.event),
  );
  const offStatus = transport.onStatus(receiveStatus);
  let active = true;
  detachTransport = () => {
    active = false;
    offNotification();
    offStatus();
  };
  void transport.getStatus().then((status) => {
    if (active && lastBackendState === null) receiveStatus(status);
  });
}

export function onRunEvent(handler: RunEventHandler): () => void {
  attach();
  runHandlers.add(handler);
  return () => runHandlers.delete(handler);
}

export function onEvent(handler: EventHandler): () => void {
  attach();
  legacyHandlers.add(handler);
  return () => legacyHandlers.delete(handler);
}

export function onRunResync(handler: RunResyncHandler): () => void {
  attach();
  resyncHandlers.add(handler);
  return () => resyncHandlers.delete(handler);
}

export function onRunSyncError(handler: RunSyncErrorHandler): () => void {
  syncErrorHandlers.add(handler);
  return () => syncErrorHandlers.delete(handler);
}

export function onTransportReconnect(handler: () => void): () => void {
  attach();
  reconnectHandlers.add(handler);
  return () => reconnectHandlers.delete(handler);
}

export function onEventChannelStatus(handler: (status: EventChannelStatus) => void): () => void {
  attach();
  statusHandlers.add(handler);
  void getTransport()
    .getStatus()
    .then((status) => {
      if (statusHandlers.has(handler)) handler(toChannelStatus(status));
    });
  return () => statusHandlers.delete(handler);
}

export function onBackendStatus(handler: (status: BackendStatus) => void): () => void {
  const transport = getTransport();
  let active = true;
  void transport.getStatus().then((status) => {
    if (active) handler(status);
  });
  const detach = transport.onStatus(handler);
  return () => {
    active = false;
    detach();
  };
}

export async function watchRun(
  runId: string,
  initialStatus: RunSnapshot['status'] = 'running',
): Promise<void> {
  if (subscribedRunIds.has(runId)) return;
  attach();
  subscribedRunIds.add(runId);
  const cursor: RunCursor = {
    applied: 0,
    syncing: false,
    status: initialStatus,
    settlePolls: 0,
    retry: false,
    receivedDuringSync: [],
  };
  cursors.set(runId, cursor);
  try {
    if (initialStatus === 'running') {
      await getTransport().call('run.subscribe', { run_id: runId });
    } else {
      // Terminal history can exist on disk without a live subscription registry entry.
      cursor.needsSubscription = true;
    }
    await syncRun(runId, 'initial');
  } catch (error) {
    if (cursors.get(runId) === cursor) {
      reportSyncError(runId, `运行事件订阅失败：${errorText(error)}`);
      clearTimeout(cursor.timer);
      subscribedRunIds.delete(runId);
      cursors.delete(runId);
    }
    throw error;
  }
}

export async function unwatchRun(runId?: string): Promise<void> {
  const targets = runId ? (subscribedRunIds.has(runId) ? [runId] : []) : [...subscribedRunIds];
  for (const id of targets) {
    clearTimeout(cursors.get(id)?.timer);
    subscribedRunIds.delete(id);
    cursors.delete(id);
  }
  await Promise.all(
    targets.map(async (id) => {
      try {
        await getTransport().call('run.unsubscribe', { run_id: id });
      } catch (error) {
        console.warn(`[run observation] ${id}: 退订失败：${errorText(error)}`);
      }
    }),
  );
}

export function getWatchedRunIds(): string[] {
  return [...subscribedRunIds];
}

export function resetEventChannel(): void {
  detachTransport?.();
  detachTransport = undefined;
  for (const cursor of cursors.values()) clearTimeout(cursor.timer);
  seen.clear();
  subscribedRunIds.clear();
  cursors.clear();
  lastBackendState = null;
}
