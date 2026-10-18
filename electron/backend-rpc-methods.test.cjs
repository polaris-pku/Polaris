const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const methods = require('./backend-rpc-methods.json');

const expectedGroups = {
  system: 6,
  driver: 6,
  task: 9,
  run: 10,
  memory: 43,
  mailbox: 4,
  artifact: 1,
};

test('RPC method manifest exposes the complete contract surface', () => {
  assert.equal(methods.length, 79);
  assert.equal(new Set(methods).size, 79);
  for (const method of ['driver.getConfig', 'driver.updateRouting', 'driver.resetRouting']) {
    assert.ok(methods.includes(method));
  }
  for (const method of ['driver.refresh', 'driver.list', 'driver.probe', 'task.interrupt']) {
    assert.ok(methods.includes(method));
  }
  for (const method of ['run.getUsage', 'run.getEvents', 'run.getPayload']) {
    assert.ok(methods.includes(method));
  }
  for (const [prefix, count] of Object.entries(expectedGroups)) {
    assert.equal(methods.filter((method) => method.startsWith(`${prefix}.`)).length, count);
  }
  assert.equal(
    methods.some((method) => method.startsWith('council.')),
    false,
  );
  assert.equal(
    methods.some((method) => method.startsWith('session.')),
    false,
  );
});

test('RPC allowlist matches concrete backend registrations', () => {
  const rpcDir = path.join(__dirname, '../packages/newide-bcd/src/rpc');
  const registered = new Set();
  for (const file of fs.readdirSync(rpcDir).filter((name) => name.endsWith('-methods.ts'))) {
    const source = fs.readFileSync(path.join(rpcDir, file), 'utf8');
    for (const match of source.matchAll(/dispatcher\.register\('([^']+)'/g)) {
      registered.add(match[1]);
    }
  }
  assert.deepEqual([...registered].sort(), [...methods].sort());
});
