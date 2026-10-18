import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { BaseAdapter } from "../src/driver-adapter/base-adapter.js";
import { ADAPTER_REGISTRY } from "../src/driver-adapter/registry.js";
import { invalidateProbe, probeAgent } from "../src/driver-adapter/probe.js";

class ProbeAdapter extends BaseAdapter {}

const fixture = fileURLToPath(new URL("./fixtures/probe-agent.js", import.meta.url));
ADAPTER_REGISTRY.register(
  new ProbeAdapter("probe-fixture", "Probe fixture", "Test agent", "acp", process.execPath, [
    fixture,
  ])
);
ADAPTER_REGISTRY.register(
  new ProbeAdapter("probe-timeout", "Timeout fixture", "Test agent", "acp", process.execPath, [
    fixture,
    "--hang",
  ])
);
ADAPTER_REGISTRY.register(
  new ProbeAdapter(
    "probe-missing",
    "Missing fixture",
    "Uninstalled test agent",
    "acp",
    fileURLToPath(new URL("./fixtures/intentionally-uninstalled-agent", import.meta.url)),
    []
  )
);

test("probe verifies ACP initialize and caches actual launch evidence", async () => {
  const result = await probeAgent("probe-fixture", { timeoutMs: 2000, force: true });
  assert.ok(result);
  assert.equal(result.agentId, "probe-fixture");
  assert.equal(result.launch.command, process.execPath);
  assert.deepEqual(result.launch.args, [fixture]);
  assert.equal(result.initialize?.protocolVersion, 1);
  assert.equal(result.initialize?.authMethods, 0);
  assert.equal(result.initialize?.agentVersion, "1.0.0");
  assert.equal(await probeAgent("probe-fixture"), result);
  invalidateProbe("probe-fixture");
  assert.notEqual(await probeAgent("probe-fixture", { timeoutMs: 2000 }), result);
});

test("probe returns no evidence for timed-out or cancelled initialize", async () => {
  assert.equal(await probeAgent("probe-timeout", { timeoutMs: 100 }), null);
  const controller = new AbortController();
  controller.abort();
  assert.equal(await probeAgent("probe-fixture", { signal: controller.signal }), null);
});

test("probe excludes in-process mocks and rejects unknown adapter ids", async () => {
  assert.equal(await probeAgent("mock-driver"), null);
  await assert.rejects(probeAgent("unregistered-probe-fixture"), /Unknown agentId/);
});

test("probe handles an uninstalled executable without crashing the probe process", async () => {
  assert.equal(await probeAgent("probe-missing", { timeoutMs: 2000 }), null);
  assert.ok(await probeAgent("probe-fixture", { timeoutMs: 2000, force: true }));
});
