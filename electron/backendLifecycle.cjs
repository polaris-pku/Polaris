const { spawn } = require('node:child_process');

async function drainBackend(
  proc,
  rpc,
  { timeoutMs = 30_000, forceExitTimeoutMs = 5_000, forceKill = killTree } = {},
) {
  if (proc.exitCode !== null || proc.signalCode) return;
  const deadline = Date.now() + timeoutMs;
  const query = async (method, params) => {
    let timer;
    try {
      return await Promise.race([
        rpc(method, params),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`等待 ${method} 保存确认超时，结果尚未确认，保留后端进程。`)),
            Math.max(0, deadline - Date.now()),
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const { tasks } = await query('task.list', {});
  if (!Array.isArray(tasks)) throw new Error('后端未返回有效任务列表，无法确认安全关闭。');
  const savedTask = (snapshot, taskId) =>
    snapshot?.task?.task_id === taskId &&
    !snapshot.current_run &&
    ['blocked', 'completed', 'failed', 'cancelled'].includes(snapshot.task.status);
  for (const task of tasks) {
    if (!task.current_run) continue;
    try {
      const saved = await query('task.interrupt', { task_id: task.task.task_id });
      if (!savedTask(saved, task.task.task_id)) throw new Error('后端未确认任务已停止并保存。');
    } catch (error) {
      if (error.code === -32008) {
        const latest = await query('task.get', { task_id: task.task.task_id });
        if (savedTask(latest, task.task.task_id)) continue;
      }
      throw new Error(`无法停止并保存任务 ${task.task.task_id}：${error.message}`, {
        cause: error,
      });
    }
  }
  if (proc.exitCode !== null || proc.signalCode) return;
  await new Promise((resolve, reject) => {
    let timer;
    let forced = false;
    const onExit = () => {
      clearTimeout(timer);
      if (forced)
        reject(new Error('后端关闭超时，已强制终止；必须按崩溃恢复核对任务，未确认优雅保存。'));
      else resolve();
    };
    proc.once('exit', onExit);
    timer = setTimeout(
      () => {
        forced = true;
        console.error('[backend] Graceful exit timed out; forcing process-tree shutdown.');
        timer = setTimeout(() => {
          proc.off('exit', onExit);
          reject(new Error('强制终止后仍未确认旧进程退出，不会启动新后端；请按崩溃恢复处理。'));
        }, forceExitTimeoutMs);
        Promise.resolve()
          .then(() => forceKill(proc))
          .catch((error) => {
            clearTimeout(timer);
            proc.off('exit', onExit);
            reject(error);
          });
      },
      Math.max(0, deadline - Date.now()),
    );
    proc.stdin.end();
  });
}

function killTree(proc) {
  if (!proc.pid) throw new Error('无法定位后端进程，不能强制终止。');
  if (process.platform === 'win32') {
    return new Promise((resolve, reject) => {
      const killer = spawn('taskkill', ['/T', '/F', '/PID', String(proc.pid)], { stdio: 'ignore' });
      killer.once('error', reject);
      killer.once('exit', (code) =>
        code === 0 ? resolve() : reject(new Error(`taskkill failed (${code})`)),
      );
    });
  }
  try {
    process.kill(-proc.pid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

module.exports = { drainBackend };
