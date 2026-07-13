import type { DemoTask } from '@/types';
import type { LiveRunState } from '@/store/types';

/**
 * 从 liveRuns 表里摘掉若干 run。
 *
 * 任务/项目被删除时用：它们那几次 run 的实时状态没有消费方了，留着只会堆积。
 * 注意这只是**前端不再关注**，run 在后端仍会跑到底（后端没有「删任务」这个概念）。
 */
export function dropRun(
  liveRuns: Record<string, LiveRunState>,
  ...runIds: Array<string | undefined>
): Record<string, LiveRunState> {
  const drop = runIds.filter((id): id is string => !!id && id in liveRuns);
  if (drop.length === 0) return liveRuns;
  const next = { ...liveRuns };
  for (const id of drop) delete next[id];
  return next;
}

type RunLookup = {
  liveRuns: Record<string, LiveRunState>;
  tasks: DemoTask[];
};

/** 仍在跑的 run（后端还没给终态）。 */
export function runningRuns(state: RunLookup): LiveRunState[] {
  return Object.values(state.liveRuns).filter((r) => r.status === 'running');
}

/**
 * 能不能把 agent 工作区绑到 `projectId`？
 *
 * ── 这是整个应用最要命的一条不变式，只此一处 ──
 * BCD 的工作区（`ACP_WORKSPACE`）是**进程级全局状态，只在启动时读一次**。
 * 要换工作区，主进程只能重启 BCD 子进程 —— 而重启 = `process.kill(-pid)` 杀掉整个进程组，
 * **连同正在干活的 agent 一起杀**（见 electron/backendBridge.cjs 的 stop()）。
 *
 * 所以：**只要还有别的项目的 run 在跑，就绝不能改工作区。** 否则那个 run 会在半路被静默杀死 ——
 * 文件写了一半，界面上却永远显示「执行中」，没有任何报错。
 *
 * 绑到「已经有 run 在跑的那个项目」是安全的：主进程的同配置去重会认出来，根本不会重启。
 *
 * 根治要靠后端把工作区变成 per-run 参数（见 docs/并发执行现状.md 的 B2）。在那之前，
 * 前端只有一个诚实的选择：拦住会杀死正在跑的 run 的操作，并说清楚为什么。
 */
export function canBindWorkspace(
  state: RunLookup,
  projectId: string,
): { ok: true } | { ok: false; blockingTask: DemoTask } {
  for (const run of runningRuns(state)) {
    const task = state.tasks.find((t) => t.contractRunId === run.runId);
    if (task && task.projectId !== projectId) {
      return { ok: false, blockingTask: task };
    }
  }
  return { ok: true };
}
