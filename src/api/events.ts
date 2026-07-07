/**
 * 方向 E · 事件通道 —— 订阅后端 WS `/events`（全流程图 §8 第一阶段事件清单）。
 *
 * 后端各节点 emit 的流程事件（task.created / task.claimed / lifecycle.human_gate /
 * council.decision …）经此通道进入前端，是任务状态流转的唯一推送入口。
 * `Event` 结构见 ./types/core.ts（🟢 frozen）。
 *
 * Mock 边界：`apiConfig.useMock` 时不建 WS 连接，改由 client.ts 的 mock 路径
 * 通过 `emitLocalEvent` 在本地喂入同形事件 —— 订阅方无需感知 mock 与否。
 *
 * E 职责边界：只接收与呈现，不确认、不重放、不参与事件持久化（C 负责 persist）。
 */
import { apiConfig } from './config';
import type { Event } from './types';

export type EventHandler = (event: Event) => void;
export type EventChannelStatus = 'disconnected' | 'connecting' | 'connected';

const handlers = new Set<EventHandler>();
const statusHandlers = new Set<(status: EventChannelStatus) => void>();

let ws: WebSocket | null = null;
let status: EventChannelStatus = 'disconnected';
let retryCount = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function setStatus(next: EventChannelStatus) {
  if (status === next) return;
  status = next;
  statusHandlers.forEach((h) => h(next));
}

export function getEventChannelStatus(): EventChannelStatus {
  return status;
}

export function onEventChannelStatus(handler: (s: EventChannelStatus) => void): () => void {
  statusHandlers.add(handler);
  return () => statusHandlers.delete(handler);
}

function dispatch(event: Event) {
  handlers.forEach((h) => h(event));
}

/** 形状哨兵：只放行携带最低限度冻结字段的载荷，坏消息丢弃并告警。 */
function isEventShaped(value: unknown): value is Event {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.event_id === 'string' &&
    typeof v.event_type === 'string' &&
    typeof v.created_at === 'string'
  );
}

function connect() {
  if (apiConfig.useMock || ws) return;
  setStatus('connecting');
  ws = new WebSocket(apiConfig.wsUrl);
  ws.onopen = () => {
    retryCount = 0;
    setStatus('connected');
  };
  ws.onmessage = (msg) => {
    try {
      const parsed: unknown = JSON.parse(String(msg.data));
      if (isEventShaped(parsed)) {
        dispatch(parsed);
      } else {
        console.warn('[events] 丢弃形状不符的事件载荷：', parsed);
      }
    } catch {
      console.warn('[events] 丢弃非 JSON 消息');
    }
  };
  ws.onclose = () => {
    ws = null;
    setStatus('disconnected');
    // 仍有订阅者时指数退避重连（1s 起，封顶 30s）
    if (handlers.size > 0) {
      const delay = Math.min(1000 * 2 ** retryCount, 30_000);
      retryCount += 1;
      retryTimer = setTimeout(connect, delay);
    }
  };
  ws.onerror = () => {
    ws?.close();
  };
}

function disconnect() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  ws?.close();
  ws = null;
  setStatus('disconnected');
}

/**
 * 订阅流程事件。首个订阅者触发建连，最后一个退订时断开。
 * 返回退订函数。
 */
export function onEvent(handler: EventHandler): () => void {
  handlers.add(handler);
  connect();
  return () => {
    handlers.delete(handler);
    if (handlers.size === 0) disconnect();
  };
}

/**
 * Mock 专用：本地喂入一条同形事件（client.ts mock 路径调用），
 * 让订阅方在无后端时走完全相同的消费链路。真连接模式下同样生效
 * （用于将来 E 本地合成的展示性事件），但后端事件永远以 WS 为准。
 */
export function emitLocalEvent(event: Event) {
  dispatch(event);
}
