/**
 * 方向 E · 事件通道 —— 订阅 BCD 推来的 `run.event`。
 *
 * 后端各节点 emit 的流程事件（task.created / driver.session_started / gate.result /
 * council.decision / run.completed …）经此通道进入前端，是任务状态流转的唯一推送入口。
 * 传输见 ./transport.ts（桌面壳走 Electron IPC → BCD 的 stdio JSON-RPC；浏览器回落 mock）。
 *
 * ── 四个后端行为必须在这里吸收 ──
 * 1. `run.subscribe` **会先重放该 run 已发生的全部事件**，然后才推新的
 *    → 按 `event_id` 去重，否则重订阅会把时间线灌两遍。
 * 2. 事件带单调递增的 `sequence` → 排序以它为准，不要依赖到达顺序。
 * 3. 实时流的 `sequence` 是**逐 run 连续**的（后端 `app/run-registry.ts` 用
 *    `record.events.length + 1` 生成，每个 run 从 1 开始）。所以「跳号」只可能是真的丢了
 *    事件 —— 增量永远补不回来，必须重新拉一次权威状态（见 resyncRun）。
 * 4. 传输层重连（后端崩溃重启 / 切工作区重启）之后，旧的 `run.subscribe` 注册在上一个 BCD
 *    进程里，已经作废 → 每个还在关注的 run 都要重新拉快照 + 重新订阅。
 *
 * ⚠️ **快照里的 `sequence` 和实时流不是同一套编号，不能拿来对齐。** 实测后端：
 *    - 实时流来自 run-registry：`events.length + 1`，逐 run、从 1 开始、连续；
 *    - `run.getSnapshot` 优先走持久化投影，`sequence` 是 sqlite `events` 表的**全局**
 *      AUTOINCREMENT（`app/task-run-snapshot-projector.ts` 只按 run_id 过滤，编号原样带出
 *      → 单调但不连续），而且只有 `shouldPersistRuntimeEvent` 放行的事件才进表
 *      （快照时间线是实时流的**子集**）。
 *    因此：跨两条流对齐**只能按 `event_id`**；`sequence` 只在同一条实时流内部用于排序与断号。
 *
 * ── 三套消费者 ──
 * - `onRunEvent`：拿后端原样的 `RunEvent`（带 sequence/source），真实 run 的驱动源。
 * - `onEvent`：拿收敛成前端既有 `Event` 形状的同一批事件，喂给观测窗口（backendEvents）。
 *   （曾经还有一个 `emitLocalEvent` 让 mock 剧本走同一条消费链路，已随 mock 推进引擎删除；
 *   现在这条链路上的每一条事件都来自后端。）
 * - `onRunResync`：断号 / 重连时重新拉到的 `RunSnapshot`。**它是权威**，消费方应当拿它整体
 *   覆盖该 run 的本地状态，而不是往现有状态上打补丁。
 *
 * E 的职责边界：只接收与呈现，不确认、不重放、不参与事件持久化（C 负责 persist）。
 */
import { getTransport } from './transport';
import type { BackendState, BackendStatus } from './transport';
import type { Event } from './types';
import type { RunEvent, RunSnapshot } from './types/rpc';

export type RunEventHandler = (event: RunEvent) => void;
export type EventHandler = (event: Event) => void;

/** 后端通道状态（保留原词表：AppShell 的 LIVE/SYNC/OFFLINE 指示灯消费它）。 */
export type EventChannelStatus = 'disconnected' | 'connecting' | 'connected';

/** 重新与后端对齐的两种由头：实时流断号，或传输层重连。 */
export type RunResyncReason = 'gap' | 'reconnect';

/** 重新拉到的权威 run 状态。消费方应当**整体覆盖**该 run 的本地状态。 */
export interface RunResync {
  run_id: string;
  reason: RunResyncReason;
  snapshot: RunSnapshot;
}

export type RunResyncHandler = (resync: RunResync) => void;

const runHandlers = new Set<RunEventHandler>();
const legacyHandlers = new Set<EventHandler>();
const statusHandlers = new Set<(status: EventChannelStatus) => void>();
const resyncHandlers = new Set<RunResyncHandler>();
const reconnectHandlers = new Set<() => void>();

/** 已投递过的 event_id —— 吸收 run.subscribe 的历史重放。 */
const seen = new Set<string>();

/**
 * 一个 run 的实时流游标。
 *
 * `applied` 只由**实时事件**推进，绝不采信快照里的 sequence（两套编号，见文件头）。
 * `resyncing` 是在途标记：一串乱序事件只该换来一次重拉，不是每条一次。
 */
interface RunCursor {
  applied: number;
  resyncing: boolean;
}

const cursors = new Map<string, RunCursor>();

/**
 * 当前已订阅的所有 run。
 *
 * **必须是集合，不能是单槽。** 用户可以同时提交多个需求，它们在后端是并发执行的独立 run，
 * 每一个都要各自保持订阅。事件靠 payload 里的 `run_id` 分流（消费方按 run_id 寻址），
 * 而不是靠「同一时刻只订阅一个」来防串台。
 */
const subscribedRunIds = new Set<string>();
let attached = false;
/** 重连探测只挂一次 transport.onStatus。 */
let reconnectWatched = false;
/** 上一次看到的后端进程状态 —— 重连 = 掉线过之后又回到 ready。 */
let lastBackendState: BackendState | null = null;

/** 后端进程状态 → 前端通道词表。 */
function toChannelStatus(status: BackendStatus): EventChannelStatus {
  if (status.state === 'ready') return 'connected';
  if (status.state === 'starting') return 'connecting';
  return 'disconnected';
}

/** RunEvent → 前端既有 Event 形状（有损：丢掉 sequence/source，观测窗口用不到）。 */
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

function cursorFor(runId: string): RunCursor {
  const existing = cursors.get(runId);
  if (existing) return existing;
  const created: RunCursor = { applied: 0, resyncing: false };
  cursors.set(runId, created);
  return created;
}

/** 投递给两套消费者，并计入去重表。 */
function deliver(event: RunEvent): void {
  seen.add(event.event_id);
  runHandlers.forEach((h) => h(event));
  const legacy = toLegacyEvent(event);
  legacyHandlers.forEach((h) => h(legacy));
}

/**
 * 收一条推上来的事件：去重 → 断号探测 → 投递。
 *
 * **断号不拦截投递。** 事件照常立刻交给消费者，重同步是「补」不是「等」——
 * 拦下来等一次 RPC 回来，界面就会在最需要实时的时候卡一拍。
 *
 * 已经投递过的重复事件也要推进游标：同一条后端事件会同时从 `task.event` 和 `run.event`
 * 两个通知里到达，先到的那条已经算「收到了」，后到的那条不能被当成新事件、更不能因为
 * 中间那些被去重掉了就误判成断号。
 */
function ingest(event: RunEvent): void {
  const known = seen.has(event.event_id);
  const cursor = cursors.get(event.run_id);
  if (cursor) {
    // applied === 0 表示这个 run 的第一条事件还没到，无从谈起「断」。
    if (!known && cursor.applied > 0 && event.sequence > cursor.applied + 1) {
      void resyncRun(event.run_id, 'gap');
    }
    if (event.sequence > cursor.applied) cursor.applied = event.sequence;
  }
  if (known) return;
  deliver(event);
}

/**
 * 重新与后端对齐一个 run。
 *
 * 两步都只搬后端的事实，不编造：
 * 1. `run.getSnapshot` 拉权威快照 → 交给 `onRunResync` 的订阅者整体覆盖本地状态；
 * 2. 重新 `run.subscribe` → registry 会把该 run 的全部实时事件**按实时流编号**重放一遍，
 *    `event_id` 去重滤掉已投递的，断掉的那一段正好补回增量流里
 *    （后端 `RunRpcMethods` 会先注册新订阅再退掉旧的，所以不会留下两个监听器）。
 *
 * 同一个 run 同时只跑一趟：`resyncing` 在途标记挡住乱序洪水，一次断号只换一次重拉。
 * 失败一律吞掉 —— 后端可能已经不认识这个 run（进程重启过），把错误抛回事件回调没有意义。
 */
async function resyncRun(runId: string, reason: RunResyncReason): Promise<void> {
  const cursor = cursorFor(runId);
  if (cursor.resyncing) return;
  cursor.resyncing = true;
  try {
    const transport = getTransport();
    const snapshot = await transport
      .call('run.getSnapshot', { run_id: runId })
      .catch(() => undefined);
    if (snapshot) {
      resyncHandlers.forEach((h) => h({ run_id: runId, reason, snapshot }));
    }
    if (subscribedRunIds.has(runId)) {
      await transport.call('run.subscribe', { run_id: runId }).catch(() => undefined);
    }
  } finally {
    cursor.resyncing = false;
  }
}

/**
 * 挂上重连探测。
 *
 * transport 层没有「重连」这个事件，只有后端进程状态流（stopped/starting/ready/error）——
 * 所以重连在这里由状态跃迁推导：**掉过线之后又回到 ready**。首次 ready 不算重连
 * （那是首次进入，首拉由调用方各自负责）。
 */
function ensureReconnectWatch(): void {
  if (reconnectWatched) return;
  reconnectWatched = true;
  getTransport().onStatus((status) => {
    const previous = lastBackendState;
    lastBackendState = status.state;
    if (status.state !== 'ready' || previous === null || previous === 'ready') return;
    reconnectHandlers.forEach((h) => h());
    // 重连后旧订阅已经作废，每个还在关注的 run 都要重新对齐一次。
    for (const runId of subscribedRunIds) void resyncRun(runId, 'reconnect');
  });
}

function attach() {
  if (attached) return;
  attached = true;
  const transport = getTransport();
  transport.onNotification((notification) => {
    ingest(notification.params.event);
  });
  void transport.getStatus().then((s) => {
    statusHandlers.forEach((h) => h(toChannelStatus(s)));
  });
  transport.onStatus((s) => {
    statusHandlers.forEach((h) => h(toChannelStatus(s)));
  });
}

/** 订阅后端原样的流程事件（真实 run 的驱动源）。返回退订函数。 */
export function onRunEvent(handler: RunEventHandler): () => void {
  attach();
  runHandlers.add(handler);
  return () => runHandlers.delete(handler);
}

/** 订阅收敛成前端 Event 形状的流程事件（观测窗口）。返回退订函数。 */
export function onEvent(handler: EventHandler): () => void {
  attach();
  legacyHandlers.add(handler);
  return () => legacyHandlers.delete(handler);
}

/**
 * 订阅「重新拉到的权威 run 快照」。返回退订函数。
 *
 * 什么时候会来：实时流断号，或传输层重连。拿到就**整体覆盖**该 run 的本地状态 ——
 * 快照是权威，事件只是增量。别把 `snapshot.timeline` 与实时事件按 `sequence` 混排：
 * 两者编号体系不同（见文件头），要合并只能按 `event_id`。
 */
export function onRunResync(handler: RunResyncHandler): () => void {
  ensureReconnectWatch();
  resyncHandlers.add(handler);
  return () => resyncHandlers.delete(handler);
}

/**
 * 订阅传输层重连（后端重启 / 切工作区之后重新 ready）。返回退订函数。
 *
 * 给 task 通道用：它的 `task.subscribe` 注册在上一个 BCD 进程里，重连后必须重订阅，
 * 否则那个任务从此再也收不到事件。
 */
export function onTransportReconnect(handler: () => void): () => void {
  ensureReconnectWatch();
  reconnectHandlers.add(handler);
  return () => reconnectHandlers.delete(handler);
}

/**
 * 订阅通道状态。返回退订函数。
 *
 * 后端可能在订阅之前就已经 ready（主进程一启动就拉起 BCD），所以这里必须**为每个新订阅者
 * 单独补一次当前状态** —— 只依赖 attach() 里那一次 getStatus 的话，晚注册的订阅者会永远
 * 停在 disconnected。
 */
export function onEventChannelStatus(handler: (status: EventChannelStatus) => void): () => void {
  attach();
  statusHandlers.add(handler);
  void getTransport()
    .getStatus()
    .then((s) => handler(toChannelStatus(s)));
  return () => statusHandlers.delete(handler);
}

/** 订阅后端进程原始状态（带错误详情，用于给用户看「后端为什么没起来」）。 */
export function onBackendStatus(handler: (status: BackendStatus) => void): () => void {
  const transport = getTransport();
  void transport.getStatus().then(handler);
  return transport.onStatus(handler);
}

/**
 * 关注一个 run 的事件流。**不会退订其他 run。**
 *
 * 订阅成功后后端会立刻重放该 run 的历史事件 —— 去重由本模块负责（按 event_id）。
 *
 * ── 为什么强调「不退订其他 run」──
 * 这里曾经只维护一个 `subscribedRunId`，`watchRun` 会先把上一个 run 退订掉。
 * 于是并发提交第二个需求时，第一个 run 在后端照常跑到底（文件也照常落盘），
 * 前端却再也收不到它的任何事件 —— 界面上表现为**第一个任务永远卡在某个节点**，
 * 既不前进也不报错。后端的 `run.subscribe` 本就是按 run_id 多路复用的
 * （newide-bcd `RunRpcMethods` 内部是 `Map<run_id, unsubscribe>`），完全支持并发订阅。
 */
export async function watchRun(runId: string): Promise<void> {
  if (subscribedRunIds.has(runId)) return;
  attach();
  ensureReconnectWatch();
  subscribedRunIds.add(runId);
  cursorFor(runId);
  try {
    await getTransport().call('run.subscribe', { run_id: runId });
  } catch (err) {
    // 订阅失败不能把它留在集合里 —— 否则后续重试会被当成「已订阅」直接跳过，永远收不到事件。
    subscribedRunIds.delete(runId);
    cursors.delete(runId);
    throw err;
  }
}

/**
 * 停止关注某个 run（任务被删除 / 项目关闭时调用）。不传 runId = 全部退订。
 * 后端可能已丢弃该 run，退订失败无害。
 */
export async function unwatchRun(runId?: string): Promise<void> {
  const targets = runId ? (subscribedRunIds.has(runId) ? [runId] : []) : [...subscribedRunIds];
  if (targets.length === 0) return;
  const transport = getTransport();
  for (const id of targets) {
    subscribedRunIds.delete(id);
    cursors.delete(id);
  }
  await Promise.all(
    targets.map((id) => transport.call('run.unsubscribe', { run_id: id }).catch(() => {})),
  );
}

/** 当前正在关注的所有 run。 */
export function getWatchedRunIds(): string[] {
  return [...subscribedRunIds];
}

/** 测试用：清空通道的模块级状态（去重表 / 订阅集 / 游标 / 传输层挂载标记）。 */
export function resetEventChannel(): void {
  seen.clear();
  subscribedRunIds.clear();
  cursors.clear();
  attached = false;
  reconnectWatched = false;
  lastBackendState = null;
}
