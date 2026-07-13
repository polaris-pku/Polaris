/**
 * 已用时 —— **全屏唯一每秒都在变的字**。
 *
 * 它存在的理由：agent 执行那十几秒里后端**一个事件都不发**。没有这个秒表，界面在最关键的
 * 那段时间完全是死的，用户会以为卡住了。数据源是后端给的开始时刻（`spanStartedAt`），不是编的。
 *
 * 算法只有这一份：泳道图节点卡（`components/workflow/nodes.tsx`）与主句（`MissionLine`）
 * import 同一个函数 —— 两处秒表读数不一致，比没有秒表更糟。
 */
import { useEffect, useState } from 'react';

/**
 * 毫秒 → 人读的时长：`0.6s` / `42.1s` / `1m12s`。
 *
 * 一分钟以内保留一位小数（秒表在跳，用户看得见它在动）；超过一分钟改成分秒，
 * 秒补零成两位 —— 主句每秒重排一次，宽度不能来回跳。
 */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${String(minutes)}m${String(rest).padStart(2, '0')}s`;
}

/** ISO 时刻 → 距 `now` 的毫秒数（时刻无效或在未来时按 0 处理，绝不给出负数秒表）。 */
export function elapsedSince(iso: string | undefined, now: number): number {
  if (!iso) return 0;
  const started = new Date(iso).getTime();
  if (Number.isNaN(started)) return 0;
  return Math.max(0, now - started);
}

/** 两个 ISO 时刻之间的毫秒数（闭合跨度的真实耗时）。 */
export function durationBetween(startIso: string | undefined, endIso: string | undefined): number {
  if (!startIso || !endIso) return 0;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, end - start);
}

/**
 * 每 `intervalMs` 自走一次的当前时刻。
 *
 * `enabled` 为假时不起定时器 —— run 已经进终态还每秒重渲染整块运行屏，是白烧电。
 */
export function useNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [intervalMs, enabled]);
  return now;
}
