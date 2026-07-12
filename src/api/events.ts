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
 * - `onEvent`：拿收敛成前端既有 `Event` 形状的同一批事件，喂给观测窗口
 *   （backendEvents）。mock 剧本用 `emitLocalEvent` 走同一条消费链路 ——
 *   订阅方无需感知 mock 与否。
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
let subscribedRunId: string | null = null;
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
 * 把事件通道切到某个 run（先退订上一个，避免事件串台）。
 * 订阅成功后后端会立刻重放该 run 的历史事件 —— 去重由本模块负责。
 */
export async function watchRun(runId: string): Promise<void> {
  const transport = getTransport();
  if (subscribedRunId === runId) return;
  if (subscribedRunId) {
    // 后端可能已丢弃该 run，退订失败无害
    await transport.unsubscribe(subscribedRunId).catch(() => {});
  }
  attach();
  subscribedRunId = runId;
  await transport.subscribe(runId);
}

/** 停止关注当前 run。 */
export async function unwatchRun(): Promise<void> {
  if (!subscribedRunId) return;
  const runId = subscribedRunId;
  subscribedRunId = null;
  await getTransport()
    .unsubscribe(runId)
    .catch(() => {});
}

export function getWatchedRunId(): string | null {
  return subscribedRunId;
}

/**
 * Mock 专用：本地喂入一条同形事件（mock 剧本回放调用），
 * 让订阅方在无后端时走完全相同的消费链路。真实后端事件永远以传输层为准。
 */
export function emitLocalEvent(event: Event) {
  legacyHandlers.forEach((h) => h(event));
}
