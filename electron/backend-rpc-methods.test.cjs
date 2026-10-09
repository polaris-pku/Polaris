const assert = require('node:assert/strict');
const test = require('node:test');
const methods = require('./backend-rpc-methods.json');

const expectedGroups = {
  system: 6,
  driver: 3,
  task: 8,
  run: 10,
  memory: 34,
  mailbox: 4,
  artifact: 1,
};

test('RPC method manifest exposes the complete contract surface', () => {
  assert.equal(methods.length, 66);
  assert.equal(new Set(methods).size, 66);
  for (const method of ['driver.getConfig', 'driver.updateRouting', 'driver.resetRouting']) {
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
