import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { startCredentiallessProxyRelay } from "../src/driver/credentialless-proxy-relay.js";

test("local relay preserves account route and query string without forwarding credentials", async () => {
  let seenUrl: string | undefined;
  let seenAuth: string | undefined;
  let seenKey: string | string[] | undefined;
  const upstream = createServer((request, response) => {
    seenUrl = request.url;
    seenAuth = request.headers.authorization;
    seenKey = request.headers["x-api-key"];
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const relay = await startCredentiallessProxyRelay(
    `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/accounts/test`
  );
  try {
    const response = await fetch(`${relay.baseUrl}/v1/messages?beta=true`, {
      method: "POST",
      headers: { authorization: "test-credential", "x-api-key": "test-credential" },
      body: "{}",
    });
    assert.equal(response.status, 200);
    assert.equal(seenUrl, "/accounts/test/v1/messages?beta=true");
    assert.equal(seenAuth, undefined);
    assert.equal(seenKey, undefined);
  } finally {
    await relay.close();
    await new Promise<void>((resolve, reject) =>
      upstream.close((error) => (error ? reject(error) : resolve()))
    );
  }
});
