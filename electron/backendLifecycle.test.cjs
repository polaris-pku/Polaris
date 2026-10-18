const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { drainBackend } = require('./backendLifecycle.cjs');

function processFixture() {
  const proc = new EventEmitter();
  proc.pid = 12345;
  proc.exitCode = null;
  proc.signalCode = null;
  proc.stdin = {
    end() {
      setImmediate(() => {
        proc.exitCode = 0;
        proc.emit('exit', 0);
      });
    },
  };
  return proc;
}

test('saves every active Task before closing stdin and waits for the old process to exit', async () => {
  const proc = processFixture();
  const order = [];
  const rpc = async (method, params) => {
    order.push([method, params]);
    if (method === 'task.list')
      return {
        tasks: [
          { task: { task_id: 'one' }, current_run: { run_id: 'old' } },
          { task: { task_id: 'done' } },
          { task: { task_id: 'two' }, current_run: { run_id: 'other' } },
        ],
      };
    assert.equal(proc.exitCode, null);
    return { task: { task_id: params.task_id, status: 'blocked' } };
  };
  await drainBackend(proc, rpc);
  assert.deepEqual(order, [
    ['task.list', {}],
    ['task.interrupt', { task_id: 'one' }],
    ['task.interrupt', { task_id: 'two' }],
  ]);
  assert.equal(proc.exitCode, 0);
});

test('refuses unsafe shutdown when the embedded backend lacks task.interrupt', async () => {
  const proc = processFixture();
  let closed = false;
  proc.stdin.end = () => {
    closed = true;
  };
  await assert.rejects(
    drainBackend(proc, async (method) => {
      if (method === 'task.list') return { tasks: [{ task: { task_id: 'one' }, current_run: {} }] };
      throw Object.assign(new Error('Method not found'), { code: -32601 });
    }),
    /无法停止并保存任务/,
  );
  assert.equal(closed, false);
});

test('accepts completion racing with interruption only after authoritative readback', async () => {
  const proc = processFixture();
  await drainBackend(proc, async (method) => {
    if (method === 'task.list') return { tasks: [{ task: { task_id: 'one' }, current_run: {} }] };
    if (method === 'task.get') return { task: { task_id: 'one', status: 'completed' } };
    throw Object.assign(new Error('not running'), { code: -32008 });
  });
  assert.equal(proc.exitCode, 0);
});

test('reports forced exit as crash recovery, not graceful persistence', async () => {
  const proc = processFixture();
  proc.stdin.end = () => {};
  let killed = false;
  await assert.rejects(
    drainBackend(proc, async () => ({ tasks: [] }), {
      timeoutMs: 5,
      forceKill(target) {
        assert.equal(target, proc);
        killed = true;
        proc.emit('exit', 1);
      },
    }),
    /未确认优雅保存/,
  );
  assert.equal(killed, true);
});

test('bounds persistence waiting and preserves a process whose save outcome is unknown', async () => {
  const proc = processFixture();
  let closed = false;
  proc.stdin.end = () => {
    closed = true;
  };
  await assert.rejects(
    drainBackend(proc, () => new Promise(() => {}), {
      timeoutMs: 5,
      forceKill: assert.fail,
    }),
    /保存确认超时/,
  );
  assert.equal(closed, false);
});

test('rejects an interrupt reply that does not confirm persistence', async () => {
  const proc = processFixture();
  proc.stdin.end = assert.fail;
  await assert.rejects(
    drainBackend(proc, async (method) => {
      if (method === 'task.list') return { tasks: [{ task: { task_id: 'one' }, current_run: {} }] };
      return {};
    }),
    /未确认任务已停止并保存/,
  );
});

test('bounds waiting after force-kill and rejects synchronous kill failures', async () => {
  for (const forceKill of [
    () => {},
    () => {
      throw new Error('kill failed');
    },
  ]) {
    const proc = processFixture();
    proc.stdin.end = () => {};
    await assert.rejects(
      drainBackend(proc, async () => ({ tasks: [] }), {
        timeoutMs: 1,
        forceExitTimeoutMs: 1,
        forceKill,
      }),
      /未确认旧进程退出|kill failed/,
    );
    assert.equal(proc.listenerCount('exit'), 0);
  }
});
