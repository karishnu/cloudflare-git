import { Hono } from "hono";
import type { Env } from "./helpers/types.js";
import { jsonResponse } from "./helpers/git-pack.js";

// Re-export the Durable Object class so wrangler can find it
export { GitRepoDO } from "./do.js";

// ─── Auth helpers ────────────────────────────────────────────────────────────

function isGitSmartHTTPRequest(url: URL): boolean {
  const p = url.pathname;
  return p.startsWith("/repo.git/") || p === "/repo.git";
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

// ─── Worker Entry Point ─────────────────────────────────────────────────────

const app = new Hono<{ Bindings: Env }>();

// Auth middleware
app.use("*", async (c, next) => {
  const url = new URL(c.req.url);

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
