import type { RunEvent, RunSnapshot, RunStatus } from '@/api/types/rpc';

export function terminalRunStatus(type: string): Exclude<RunStatus, 'running'> | undefined {
  switch (type) {
    case 'run.completed':
      return 'completed';
    case 'run.failed':
      return 'failed';
    case 'run.cancelled':
      return 'cancelled';
    default:
      return undefined;
  }
}

export function latestSequence(events: readonly RunEvent[]): number {
  return events.reduce((latest, event) => Math.max(latest, event.sequence), 0);
}

export function snapshotRunStatus(snapshot: RunSnapshot, live: readonly RunEvent[]): RunStatus {
  const watermark = latestSequence(snapshot.timeline);
  const ids = new Set(snapshot.timeline.map((event) => event.event_id));
  for (let index = live.length - 1; index >= 0; index -= 1) {
    const event = live[index];
    if (event.sequence <= watermark || ids.has(event.event_id)) continue;
    const status = terminalRunStatus(event.type);
    if (status) return status;
  }
  return snapshot.status;
}

/** Equal sequences are distinct events; preserve their source order. */
export function appendRunEvents(
  timeline: readonly RunEvent[],
  events: readonly RunEvent[],
): RunEvent[] {
  const next = [...timeline];
  const known = new Set(next.map((event) => event.event_id));
  for (const event of events) {
    if (known.has(event.event_id)) continue;
    known.add(event.event_id);
    const index = next.findIndex((current) => current.sequence > event.sequence);
    if (index === -1) next.push(event);
    else next.splice(index, 0, event);
  }
  return next;
}

/** Snapshot order wins, without losing pushes received while its RPC was in flight. */
export function mergeRunSnapshot(
  snapshot: readonly RunEvent[],
  live: readonly RunEvent[],
): RunEvent[] {
  const ids = new Set(snapshot.map((event) => event.event_id));
  return appendRunEvents(
    snapshot,
    live.filter((event) => !ids.has(event.event_id)),
  );
}
