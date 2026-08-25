/**
 * task.* 门面 + task 事件流的订阅语义。
 *
 * ── 快照是权威，事件只是增量 ──
 * 首次进入、重连、以及**实时流断号**时，都必须重新走一次 `task.subscribe`：它一次给回
 * 权威 `TaskSnapshot` + 该 task 的全部重放事件，本地状态以它为准整体覆盖。
 *
 * 断号只能按**实时**编号判断，而且要逐 run 看：
 * - 实时 `task.event` 来自后端 run-registry（`events.length + 1`，逐 run 从 1 开始、连续）；
 * - `task.subscribe` 回来的 `replay_events` 来自持久化事件表（全局 AUTOINCREMENT，单调但不
 *   连续，且只收录 `shouldPersistRuntimeEvent` 放行的那部分）。
 * 两套编号不通用 —— 跨流对齐只能按 `event_id`，`sequence` 只在同一条实时流内部使用。
 * 一个 task 还可能跑过多个 run，各自的 sequence 都从 1 起，所以游标必须按 run_id 分开记。
 */
import { onTransportReconnect } from './events';
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

interface TaskWatcher {
  dispose: () => Promise<void>;
}

const taskWatchers = new Map<string, TaskWatcher>();

export async function watchTask(
  taskId: string,
  handlers: TaskStreamHandlers,
  afterEventId?: string,
): Promise<() => Promise<void>> {
  const transport = getTransport();
  const buffered: RunEvent[] = [];
  const seen = new Set<string>();
  /** 每个 run 已应用到的最大**实时** sequence（重放事件不参与，编号不同源）。 */
  const applied = new Map<string, number>();
  let live = false;
  let resyncing = false;

  const apply = (event: RunEvent) => {
    if (seen.has(event.event_id)) return;
    seen.add(event.event_id);
    handlers.onEvent(event);
  };

  /**
   * 收一条实时事件：断号探测 + 投递。
   *
   * 断号**不拦截投递** —— 重同步是「补」不是「等」，拦下来等一次 RPC 回来只会让界面卡一拍。
   * 已经投递过的重复事件也要推进游标（同一条后端事件会同时从 `task.event` 与 `run.event`
   * 到达），否则被去重掉的那几条会被误判成断号。
   */
  const ingest = (event: RunEvent) => {
    const known = seen.has(event.event_id);
    const last = applied.get(event.run_id);
    if (!known && last !== undefined && event.sequence > last + 1) void resync();
    if (last === undefined || event.sequence > last) applied.set(event.run_id, event.sequence);
    apply(event);
  };

  const subscribe = async (after?: string) => {
    const subscribed = await transport.call('task.subscribe', {
      task_id: taskId,
      ...(after ? { after_event_id: after } : {}),
    });
    handlers.onSnapshot(subscribed.snapshot);
    for (const event of subscribed.replay_events) apply(event);
    return subscribed;
  };

  /**
   * 重新与后端对齐：再走一次 `task.subscribe`（不带游标 —— 断掉的那段在游标**之前**）。
   *
   * 后端 `TaskRpcMethods` 会先注册新订阅再退掉旧的，所以重订阅不会留下两个监听器。
   * 在途标记保证一串乱序事件只换来一次重拉。失败一律吞掉：后端可能已经不认识这个 task
   * （进程重启过），把错误抛回事件回调没有意义。
   */
  const resync = async () => {
    if (resyncing) return;
    resyncing = true;
    await subscribe().catch(() => undefined);
    resyncing = false;
  };

  const detach = transport.onNotification((notification) => {
    if (notification.method !== 'task.event' || notification.params.task_id !== taskId) return;
    if (live) ingest(notification.params.event);
    else buffered.push(notification.params.event);
  });

  try {
    await subscribe(afterEventId);
    buffered.sort((left, right) => left.sequence - right.sequence);
    for (const event of buffered) ingest(event);
    buffered.length = 0;
    live = true;
  } catch (error) {
    detach();
    throw error;
  }

  // 重连后旧的 task.subscribe 注册在上一个 BCD 进程里，已经作废 —— 不重订阅的话，
  // 这个任务从此再也收不到任何事件（界面表现为永远卡在某一步）。
  const stopReconnectWatch = onTransportReconnect(() => {
    void resync();
  });

  const previous = taskWatchers.get(taskId);
  const dispose = async () => {
    if (taskWatchers.get(taskId)?.dispose !== dispose) return;
    taskWatchers.delete(taskId);
    stopReconnectWatch();
    detach();
    await taskApi.unsubscribe(taskId).catch(() => undefined);
  };
  if (previous) await previous.dispose();
  taskWatchers.set(taskId, { dispose });
  return dispose;
}

export async function unwatchTask(taskId: string): Promise<void> {
  await taskWatchers.get(taskId)?.dispose();
}

export async function unwatchAllTasks(): Promise<void> {
  await Promise.all([...taskWatchers.values()].map((watcher) => watcher.dispose()));
}
