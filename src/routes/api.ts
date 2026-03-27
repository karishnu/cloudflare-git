import { Hono } from "hono";
import type { HandlerContext } from "../helpers/types.js";
import { jsonResponse } from "../helpers/git-pack.js";
import { handleGitCommand } from "../handlers/git-engine.js";
import { fsRead, fsWrite, fsDelete, handleList } from "../handlers/fs-engine.js";

type ApiEnv = { Variables: { ctx: HandlerContext } };

export const apiRoutes = new Hono<ApiEnv>();

// ── Git commands via ?cmd= ──

apiRoutes.get("/", async (c) => {
  const ctx = c.get("ctx");
  const cmd = c.req.query("cmd");
  const list = c.req.query("list");

  if (cmd) {
    return handleGitCommand(ctx, cmd, c.req.raw);
  }

  if (list !== undefined) {
    return handleList(ctx, new URL(c.req.url));
  }

  return jsonResponse({ error: "Path required" }, 400);
});

apiRoutes.post("/", async (c) => {
  const ctx = c.get("ctx");
  const cmd = c.req.query("cmd");

  if (cmd) {
    return handleGitCommand(ctx, cmd, c.req.raw);
  }

  return jsonResponse({ error: "Path required" }, 400);
});

// ── File CRUD ──

apiRoutes.get("/:path{.+}", async (c) => {
  const ctx = c.get("ctx");
  const url = new URL(c.req.url);

  if (c.req.query("list") !== undefined) {
    return handleList(ctx, url);
  }

  const filePath = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  return fsRead(ctx, filePath);
});

apiRoutes.put("/:path{.+}", async (c) => {
  const ctx = c.get("ctx");
  const url = new URL(c.req.url);
  const filePath = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  return fsWrite(ctx, filePath, c.req.raw);
});

apiRoutes.delete("/:path{.+}", async (c) => {
  const ctx = c.get("ctx");
  const url = new URL(c.req.url);
  const filePath = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  return fsDelete(ctx, filePath);
});
