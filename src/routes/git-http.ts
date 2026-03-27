import { Hono } from "hono";
import type { HandlerContext } from "../helpers/types.js";
import {
  handleInfoRefs,
  handleUploadPack,
  handleReceivePack,
  handleHead,
} from "../handlers/git-smart-http.js";

type GitHttpEnv = { Variables: { ctx: HandlerContext } };

export const gitHttpRoutes = new Hono<GitHttpEnv>();

// ── info/refs ──

gitHttpRoutes.get("/repo.git/info/refs", async (c) => {
  const ctx = c.get("ctx");
  const service = c.req.query("service");

  if (service === "git-upload-pack" || service === "git-receive-pack") {
    return handleInfoRefs(ctx, service);
  }
  return new Response("Unsupported service\n", { status: 403 });
});

// ── upload-pack (clone/fetch) ──

gitHttpRoutes.post("/repo.git/git-upload-pack", async (c) => {
  const ctx = c.get("ctx");
  return handleUploadPack(ctx, c.req.raw);
});

// ── receive-pack (push) ──

gitHttpRoutes.post("/repo.git/git-receive-pack", async (c) => {
  const ctx = c.get("ctx");
  return handleReceivePack(ctx, c.req.raw);
});

// ── HEAD ──

gitHttpRoutes.get("/repo.git/HEAD", async (c) => {
  const ctx = c.get("ctx");
  return handleHead(ctx);
});
