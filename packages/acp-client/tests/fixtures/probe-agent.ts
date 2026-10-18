import { createInterface } from "node:readline";

createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line) as { id?: number; method?: string };
  if (request.id === undefined || process.argv.includes("--hang")) return;
  const response =
    request.method === "initialize"
      ? {
          result: {
            protocolVersion: 1,
            authMethods: [],
            agentCapabilities: { loadSession: true },
            agentInfo: { name: "probe-fixture", version: "1.0.0" },
          },
        }
      : { error: { code: -32601, message: "Method not found" } };
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, ...response })}\n`);
});
