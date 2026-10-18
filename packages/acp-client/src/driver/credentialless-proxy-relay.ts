import { createServer } from "node:http";
import { Readable } from "node:stream";

export interface CredentiallessProxyRelay {
  baseUrl: string;
  close(): Promise<void>;
}

export async function startCredentiallessProxyRelay(
  targetBaseUrl: string
): Promise<CredentiallessProxyRelay> {
  const target = new URL(targetBaseUrl);
  const server = createServer(async (request, response) => {
    try {
      const requested = new URL(request.url || "/", "http://relay.invalid");
      const upstream = new URL(target.toString());
      upstream.pathname = `${target.pathname.replace(/\/$/, "")}/${requested.pathname.replace(/^\//, "")}`;
      upstream.search = requested.search;
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (
          value === undefined ||
          ["authorization", "x-api-key", "host", "content-length"].includes(name.toLowerCase())
        ) {
          continue;
        }
        headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
      const result = await fetch(upstream, {
        method: request.method,
        headers,
        ...(body ? { body } : {}),
      });
      response.statusCode = result.status;
      for (const [name, value] of result.headers) {
        if (!["content-encoding", "content-length", "transfer-encoding"].includes(name)) {
          response.setHeader(name, value);
        }
      }
      if (result.body) Readable.fromWeb(result.body as never).pipe(response);
      else response.end();
    } catch (error) {
      response.writeHead(502, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ error: error instanceof Error ? error.message : String(error) })
      );
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Credentialless proxy relay failed to bind");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
