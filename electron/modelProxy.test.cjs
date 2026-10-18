const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const test = require('node:test');
const { readModelProxyConfig, resolveModelProxyConfig } = require('./modelProxy.cjs');

test('local testing is absent or explicitly disabled without changing official authentication', () => {
  assert.equal(readModelProxyConfig({ provider: 'deepseek' }), undefined);
  assert.equal(
    readModelProxyConfig({ modelProxy: { enabled: false, baseUrl: 'invalid' } }),
    undefined,
  );
  assert.throws(() => readModelProxyConfig({ modelProxy: { baseUrl: 'http://localhost:4143' } }));
});

test('local testing rejects remote endpoints and embedded credentials', () => {
  for (const baseUrl of [
    'http://example.test',
    'http://key@127.0.0.1',
    'http://localhost/?key=value',
  ]) {
    assert.throws(() => readModelProxyConfig({ modelProxy: { baseUrl, model: 'test-model' } }));
  }
});

test('model discovery allows proxy catalog warmup beyond five seconds', async () => {
  const server = createServer(async (_request, response) => {
    await new Promise((resolve) => setTimeout(resolve, 5500));
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ data: [{ id: 'test-model' }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const started = Date.now();
    const result = await resolveModelProxyConfig({
      modelProxy: {
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        model: 'test-model',
      },
    });
    assert.equal(result.model, 'test-model');
    assert.ok(Date.now() - started >= 5000);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('model discovery preserves account prefixes, sends no credentials, and rejects missing models', async () => {
  const seen = [];
  const server = createServer((request, response) => {
    seen.push(request);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ data: [{ id: 'test-model', served_on: ['/v1/messages'] }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const root = `http://127.0.0.1:${server.address().port}/accounts/test`;
    const result = await resolveModelProxyConfig({
      providers: { deepseek: { key: 'do-not-send-this-key' } },
      modelProxy: { baseUrl: `${root}/v1`, model: 'test-model' },
    });
    assert.equal(result.root, root);
    assert.equal(result.model, 'test-model');
    assert.equal(seen[0].url, '/accounts/test/v1/models');
    assert.equal(seen[0].headers.authorization, undefined);
    assert.equal(seen[0].headers['x-api-key'], undefined);
    await assert.rejects(
      resolveModelProxyConfig({ modelProxy: { baseUrl: root, model: 'missing-model' } }),
      /unavailable/,
    );
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
