import assert from "node:assert/strict";
import test from "node:test";
import { AcpConnection } from "../src/connection/acp-connection.js";

test("gateway authentication metadata is sent at the ACP request top level", async () => {
  const fixture = `
    const { createInterface } = require("node:readline");
    createInterface({ input: process.stdin }).on("line", line => {
      const request = JSON.parse(line);
      let result = {};
      if (request.method === "initialize") {
        result = { protocolVersion: 1, agentCapabilities: {}, authMethods: [{id:"gateway",name:"Gateway"}] };
      } else if (request.method === "authenticate") {
        if (request.params._meta?.gateway?.baseUrl !== "http://127.0.0.1:4143") {
          process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:request.id,error:{code:-32602,message:"Missing top-level gateway metadata"}}) + "\\n");
          return;
        }
      }
      process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:request.id,result}) + "\\n");
    });
  `;
  const connection = new AcpConnection();
  try {
    await connection.connect({
      command: process.execPath,
      args: ["-e", fixture],
      cwd: process.cwd(),
    });
    await connection.initialize({ protocolVersion: 1, clientCapabilities: {} });
    await connection.authenticate("gateway", {
      _meta: { gateway: { baseUrl: "http://127.0.0.1:4143", headers: {} } },
    });
    assert.equal(connection.isConnected, true);
  } finally {
    await connection.disconnect();
  }
});
