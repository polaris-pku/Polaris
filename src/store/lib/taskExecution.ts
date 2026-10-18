import { getConnectionGeneration, watchRun } from '@/api/events';
import { taskApi } from '@/api/task';
import { BackendError, getTransport } from '@/api/transport';
import type { DemoState } from '@/store/types';
import { applyTaskSnapshot } from './taskObservation';

export async function changeTaskExecution(
  taskId: string,
  action: 'interrupt' | 'resume',
  get: () => DemoState,
  set: (update: (state: DemoState) => Partial<DemoState>) => void,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const task = get().tasks.find((item) => item.id === taskId);
  const id = task?.contractTaskId;
  if (!id) return { ok: false, error: '任务尚未被后端受理。' };
  const live = get().liveTasks[id];
  if (!live) return { ok: false, error: '请先同步任务状态。' };
  if (live.pendingAction) return { ok: false, error: '此任务的停止或恢复请求尚未完成。' };
  set((state) => ({
    liveTasks: {
      ...state.liveTasks,
      [id]: { ...state.liveTasks[id], pendingAction: action, error: undefined },
    },
  }));
  const generation = getConnectionGeneration();
  try {
    const status = await getTransport().getStatus();
    if (status.state !== 'ready') throw new Error('后端连接中断，请等待任务状态同步后再操作。');
    const before = await taskApi.get(id);
    if (generation !== getConnectionGeneration())
      throw new Error('后端连接已变化，请同步任务后再操作。');
    set((state) => applyTaskSnapshot(state, before));
    if (action === 'interrupt' && !before.current_run)
      throw new Error('任务当前没有活跃运行，已同步最新状态。');
    if (action === 'resume' && (before.current_run || before.task.status !== 'blocked'))
      throw new Error('任务已在运行或不处于等待状态，已同步最新状态。');
    const snapshot = await taskApi[action](id);
    if (generation !== getConnectionGeneration())
      throw new Error('连接已变化，请先同步任务；不要重复停止或恢复。');
    set((state) => applyTaskSnapshot(state, snapshot));
    if (snapshot.current_run)
      await watchRun(snapshot.current_run.run_id, snapshot.current_run.status);
    return { ok: true };
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error);
    if (error instanceof BackendError) {
      if (error.code === -32601)
        message = '当前后端未提供此任务接口，请同步交接版本并重新构建后端。';
      if (error.code === -32014) message = `工作区恢复不可用：${JSON.stringify(error.data ?? {})}`;
    }
    if (generation === getConnectionGeneration()) {
      try {
        const snapshot = await taskApi.get(id);
        if (generation === getConnectionGeneration())
          set((state) => applyTaskSnapshot(state, snapshot));
      } catch (syncError) {
        message += `；状态同步失败：${syncError instanceof Error ? syncError.message : String(syncError)}`;
      }
    }
    set((state) => ({
      liveTasks: { ...state.liveTasks, [id]: { ...state.liveTasks[id], error: message } },
    }));
    return { ok: false, error: message };
  } finally {
    set((state) => ({
      liveTasks: { ...state.liveTasks, [id]: { ...state.liveTasks[id], pendingAction: undefined } },
    }));
  }
}
