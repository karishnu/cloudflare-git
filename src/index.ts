import { Hono } from "hono";
import { createMcpHandler } from "agents/mcp";
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

// MCP endpoint — handled before other auth middleware
app.all("/mcp", async (c) => {
  if (!checkBearerAuth(c.req.raw, c.env.API_KEY)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const server = createServer(c.env);
  const handler = createMcpHandler(server, { route: "/mcp" });
  return handler(c.req.raw, c.env, c.executionCtx);
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
