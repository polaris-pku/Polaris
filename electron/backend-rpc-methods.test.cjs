const assert = require('node:assert/strict');
const test = require('node:test');
const methods = require('./backend-rpc-methods.json');

const expectedGroups = {
  system: 6,
  task: 8,
  run: 7,
  memory: 7,
  mailbox: 4,
};

test('RPC method manifest exposes the complete contract surface', () => {
  assert.equal(methods.length, 32);
  assert.equal(new Set(methods).size, 32);
  for (const [prefix, count] of Object.entries(expectedGroups)) {
    assert.equal(methods.filter((method) => method.startsWith(`${prefix}.`)).length, count);
  }
  assert.equal(methods.some((method) => method.startsWith('council.')), false);
  assert.equal(methods.some((method) => method.startsWith('session.')), false);
});
