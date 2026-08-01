import { getTransport } from './transport';
import type { RunEvent } from './types/rpc';
import type { TaskCreateParams, TaskSnapshot } from './types/task';

export const taskApi = {
  create: (params: TaskCreateParams) => getTransport().call('task.create', params),
  get: (taskId: string) => getTransport().call('task.get', { task_id: taskId }),
  list: () => getTransport().call('task.list', {}),
  cancel: (taskId: string) => getTransport().call('task.cancel', { task_id: taskId }),
  resume: (taskId: string) => getTransport().call('task.resume', { task_id: taskId }),
  startCouncil: (taskId: string) => getTransport().call('task.startCouncil', { task_id: taskId }),
  unsubscribe: (taskId: string) => getTransport().call('task.unsubscribe', { task_id: taskId }),
};

export interface TaskStreamHandlers {
  onSnapshot(snapshot: TaskSnapshot): void;
  onEvent(event: RunEvent): void;
}

const taskWatchers = new Map<string, () => Promise<void>>();

export async function watchTask(
  taskId: string,
  handlers: TaskStreamHandlers,
  afterEventId?: string,
): Promise<() => Promise<void>> {
  const transport = getTransport();
  const buffered: RunEvent[] = [];
  const seen = new Set<string>();
  let live = false;

  const apply = (event: RunEvent) => {
    if (seen.has(event.event_id)) return;
    seen.add(event.event_id);
    handlers.onEvent(event);
  };

  const detach = transport.onNotification((notification) => {
    if (notification.method !== 'task.event' || notification.params.task_id !== taskId) return;
    if (live) apply(notification.params.event);
    else buffered.push(notification.params.event);
  });

  try {
    const subscribed = await transport.call('task.subscribe', {
      task_id: taskId,
      ...(afterEventId ? { after_event_id: afterEventId } : {}),
    });
    handlers.onSnapshot(subscribed.snapshot);
    for (const event of subscribed.replay_events) apply(event);
    buffered.sort((left, right) => left.sequence - right.sequence);
    for (const event of buffered) apply(event);
    live = true;
  } catch (error) {
    detach();
    throw error;
  }

  const previous = taskWatchers.get(taskId);
  const dispose = async () => {
    if (taskWatchers.get(taskId) !== dispose) return;
    taskWatchers.delete(taskId);
    detach();
    await taskApi.unsubscribe(taskId).catch(() => undefined);
  };
  if (previous) await previous();
  taskWatchers.set(taskId, dispose);
  return dispose;
}

export async function unwatchTask(taskId: string): Promise<void> {
  await taskWatchers.get(taskId)?.();
}

export async function unwatchAllTasks(): Promise<void> {
  await Promise.all([...taskWatchers.values()].map((dispose) => dispose()));
}
