import { Hono, type Context } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Env } from "./helpers/types.js";
import { jsonResponse } from "./helpers/git-pack.js";
import { createServer } from "./mcp/server.js";

type AppContext = Context<{ Bindings: Env }>;

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

function isPublicReleaseRequest(url: URL): boolean {
  return url.pathname === "/release" || url.pathname.startsWith("/release/");
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

async function forwardReleaseRequest(c: AppContext, branch: string, forwardPath: string): Promise<Response> {
  const env = c.env;

  const doId = env.GIT_REPO.idFromName("repo");
  const doStub = env.GIT_REPO.get(doId);
  const deployRes = await doStub.fetch(
    new Request(`https://internal/?cmd=get_deployment&branch=${encodeURIComponent(branch)}`)
  );

  if (!deployRes.ok) {
    const err = await deployRes.json() as { error?: string };
    return c.json({ error: err.error ?? `No deployment for branch "${branch}"` }, 404);
  }

  const deployment = await deployRes.json() as {
    branch: string;
    commit_hash: string;
    main_module: string;
    modules: Record<string, string | { js: string }>;
  };

  const loaderId = `${branch}:${deployment.commit_hash}`;
  const worker = env.LOADER.get(loaderId, async () => {
    return {
      compatibilityDate: "2024-12-30",
      mainModule: deployment.main_module,
      modules: deployment.modules,
      globalOutbound: null,
    };
  });

  const originalUrl = new URL(c.req.url);
  const forwardUrl = new URL(forwardPath, originalUrl.origin);
  forwardUrl.search = originalUrl.search;

  const forwardReq = new Request(forwardUrl.toString(), {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.raw.body,
  });

  const entrypoint = worker.getEntrypoint();
  return entrypoint.fetch(forwardReq);
}

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
  const role = c.env.SPACE_ROLE ?? "workspace";
  const info: Record<string, unknown> = { name: "AgentSpace", version: "1.0.0", role };
  if (role === "management") {
    info.mcp = "/mcp";
  }
  return c.json(info);
});

// MCP endpoint — only available on management-role instances
app.all("/mcp", async (c) => {
  if (c.env.SPACE_ROLE !== "management") {
    return new Response("Not Found", { status: 404 });
  }

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

  if (isPublicReleaseRequest(url)) {
    // Public release routes — no auth required
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

// ─── Public release routing: /release/* -> /deploy/release/* ────────────────
app.all("/release/:branch/*", async (c) => {
  const branch = c.req.param("branch");
  const originalUrl = new URL(c.req.url);
  const prefixLen = `/release/${branch}`.length;
  return forwardReleaseRequest(c, branch, originalUrl.pathname.slice(prefixLen) || "/");
});

// Handle /release/:branch without trailing path
app.all("/release/:branch", async (c) => {
  const branch = c.req.param("branch");
  return forwardReleaseRequest(c, branch, "/");
});

// Handle /release with no branch — defaults to "main"
app.all("/release", async (c) => {
  return forwardReleaseRequest(c, "main", "/");
});

// Forward everything else to the singleton DO
app.all("*", async (c) => {
  const id = c.env.GIT_REPO.idFromName("repo");
  const stub = c.env.GIT_REPO.get(id);
  return stub.fetch(c.req.raw);
});

export default app;
