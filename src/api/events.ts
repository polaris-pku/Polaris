/**
 * 方向 E · 事件通道 —— 订阅 BCD 推来的 `run.event`。
 *
 * 后端各节点 emit 的流程事件（task.created / driver.session_started / gate.result /
 * council.decision / run.completed …）经此通道进入前端，是任务状态流转的唯一推送入口。
 * 传输见 ./transport.ts（桌面壳走 Electron IPC → BCD 的 stdio JSON-RPC；浏览器回落 mock）。
 *
 * ── 两个后端行为必须在这里吸收 ──
 * 1. `run.subscribe` **会先重放该 run 已发生的全部事件**，然后才推新的
 *    → 按 `event_id` 去重，否则重订阅会把时间线灌两遍。
 * 2. 事件带单调递增的 `sequence` → 排序以它为准，不要依赖到达顺序。
 *
 * ── 两套消费者 ──
 * - `onRunEvent`：拿后端原样的 `RunEvent`（带 sequence/source），真实 run 的驱动源。
 * - `onEvent`：拿收敛成前端既有 `Event` 形状的同一批事件，喂给观测窗口（backendEvents）。
 *   （曾经还有一个 `emitLocalEvent` 让 mock 剧本走同一条消费链路，已随 mock 推进引擎删除；
 *   现在这条链路上的每一条事件都来自后端。）
 *
 * E 的职责边界：只接收与呈现，不确认、不重放、不参与事件持久化（C 负责 persist）。
 */
import { getTransport } from './transport';
import type { BackendStatus } from './transport';
import type { Event } from './types';
import type { RunEvent } from './types/rpc';

export type RunEventHandler = (event: RunEvent) => void;
export type EventHandler = (event: Event) => void;

/** 后端通道状态（保留原词表：AppShell 的 LIVE/SYNC/OFFLINE 指示灯消费它）。 */
export type EventChannelStatus = 'disconnected' | 'connecting' | 'connected';

const runHandlers = new Set<RunEventHandler>();
const legacyHandlers = new Set<EventHandler>();
const statusHandlers = new Set<(status: EventChannelStatus) => void>();

/** 已投递过的 event_id —— 吸收 run.subscribe 的历史重放。 */
const seen = new Set<string>();
/**
 * 当前已订阅的所有 run。
 *
 * **必须是集合，不能是单槽。** 用户可以同时提交多个需求，它们在后端是并发执行的独立 run，
 * 每一个都要各自保持订阅。事件靠 payload 里的 `run_id` 分流（消费方按 run_id 寻址），
 * 而不是靠「同一时刻只订阅一个」来防串台。
 */
const subscribedRunIds = new Set<string>();
let attached = false;

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

function attach() {
  if (attached) return;
  attached = true;
  const transport = getTransport();
  transport.onEvent((event) => {
    if (seen.has(event.event_id)) return;
    seen.add(event.event_id);
    runHandlers.forEach((h) => h(event));
    const legacy = toLegacyEvent(event);
    legacyHandlers.forEach((h) => h(legacy));
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
  subscribedRunIds.add(runId);
  try {
    await getTransport().subscribe(runId);
  } catch (err) {
    // 订阅失败不能把它留在集合里 —— 否则后续重试会被当成「已订阅」直接跳过，永远收不到事件。
    subscribedRunIds.delete(runId);
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
  for (const id of targets) subscribedRunIds.delete(id);
  await Promise.all(targets.map((id) => transport.unsubscribe(id).catch(() => {})));
}

/** 当前正在关注的所有 run。 */
export function getWatchedRunIds(): string[] {
  return [...subscribedRunIds];
}

/** 测试用：清空通道的模块级状态（去重表 / 订阅集 / 传输层挂载标记）。 */
export function resetEventChannel(): void {
  seen.clear();
  subscribedRunIds.clear();
  attached = false;
}
