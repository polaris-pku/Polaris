const assert = require('node:assert/strict');
const test = require('node:test');
const methods = require('./backend-rpc-methods.json');

const expectedGroups = {
  system: 6,
  task: 8,
  run: 7,
  memory: 32,
  mailbox: 4,
  artifact: 1,
};

test('RPC method manifest exposes the complete contract surface', () => {
  assert.equal(methods.length, 58);
  assert.equal(new Set(methods).size, 58);
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
