import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Env } from "./helpers/types.js";
import { jsonResponse } from "./helpers/git-pack.js";
import { createServer } from "./mcp/server.js";

// Re-export the Durable Object class so wrangler can find it
export { GitRepoDO } from "./do.js";

// ─── Auth helpers ────────────────────────────────────────────────────────────

function isGitSmartHTTPRequest(url: URL): boolean {
  const p = url.pathname;
  return p.startsWith("/repo.git/") || p === "/repo.git";
}

function isMcpRequest(url: URL): boolean {
  return url.pathname === "/mcp";
}

function checkBasicAuth(request: Request, apiKey: string): boolean {
  const auth = request.headers.get("Authorization");
  if (!auth || !auth.startsWith("Basic ")) return false;
  try {
    const decoded = atob(auth.slice(6));
    const colon = decoded.indexOf(":");
    if (colon === -1) return false;
    const password = decoded.slice(colon + 1);
    return password === apiKey;
  } catch {
    return false;
  }
}

function checkBearerAuth(request: Request, apiKey: string): boolean {
  const auth = request.headers.get("Authorization");
  if (!auth) return false;
  if (auth.startsWith("Bearer ")) {
    return auth.slice(7) === apiKey;
  }
  return false;
}

// ─── Worker Entry Point ─────────────────────────────────────────────────────

const app = new Hono<{ Bindings: Env }>();

// ─── Request/Response logging middleware ────────────────────────────────────
app.use("*", async (c, next) => {
  const method = c.req.method;
  const url = c.req.url;
  const reqBody = method === "POST" || method === "PUT" || method === "PATCH"
    ? await c.req.raw.clone().text()
    : undefined;
  console.log(`→ ${method} ${url}${reqBody ? `\n  body: ${reqBody}` : ""}`);

  await next();

  const status = c.res.status;
  const resBody = await c.res.clone().text();
  console.log(`← ${status} ${method} ${url}\n  body: ${resBody}`);
});

// Health / discovery endpoint — no auth required
app.get("/api", (c) => {
  return c.json({ name: "AgentSpace", version: "1.0.0", mcp: "/mcp" });
});

// MCP endpoint — handled before other auth middleware
app.all("/mcp", async (c) => {
  if (!checkBearerAuth(c.req.raw, c.env.API_KEY)) {
    return new Response("Unauthorized", { status: 401 });
  }

  // GET opens an SSE stream that hangs forever on serverless — reject it.
  // MCP clients should use POST for all JSON-RPC calls.
  if (c.req.method === "GET") {
    return new Response("Method Not Allowed — use POST for MCP JSON-RPC\n", {
      status: 405,
      headers: { Allow: "POST, DELETE" },
    });
  }

  const server = createServer(c.env);
  const transport = new WebStandardStreamableHTTPServerTransport();
  await server.connect(transport);
  try {
    return await transport.handleRequest(c.req.raw);
  } catch (error) {
    console.error("MCP handler error:", error);
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32603, message: error instanceof Error ? error.message : "Internal server error" },
      id: null,
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// Auth middleware for non-MCP routes
app.use("*", async (c, next) => {
  const url = new URL(c.req.url);

  if (isMcpRequest(url)) {
    // Already handled above
    return next();
  }

  if (isGitSmartHTTPRequest(url)) {
    // Git Smart HTTP — use HTTP Basic auth
    if (!checkBasicAuth(c.req.raw, c.env.API_KEY)) {
      return new Response("Unauthorized\n", {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="Git"',
          "Content-Type": "text/plain",
        },
      });
    }
  } else {
    // SDK/API routes — use X-API-Key header
    const apiKey = c.req.header("X-API-Key");
    if (!apiKey || apiKey !== c.env.API_KEY) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
  }

  await next();
});

// Forward everything to the singleton DO
app.all("*", async (c) => {
  const id = c.env.GIT_REPO.idFromName("repo");
  const stub = c.env.GIT_REPO.get(id);
  return stub.fetch(c.req.raw);
});

export default app;
