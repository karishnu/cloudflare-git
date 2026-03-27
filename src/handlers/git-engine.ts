import git from "isomorphic-git";
import type { HandlerContext } from "../helpers/types.js";
import { jsonResponse } from "../helpers/git-pack.js";

// ─── HTTP transport for isomorphic-git (uses global fetch) ───────────────────

const httpClient = {
  async request({
    url,
    method,
    headers,
    body,
  }: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: AsyncIterableIterator<Uint8Array> | Uint8Array[];
  }) {
    let bodyBytes: Uint8Array | undefined;
    if (body) {
      const chunks: Uint8Array[] = [];
      for await (const chunk of body) {
        chunks.push(chunk);
      }
      let len = 0;
      for (const c of chunks) len += c.length;
      bodyBytes = new Uint8Array(len);
      let off = 0;
      for (const c of chunks) {
        bodyBytes.set(c, off);
        off += c.length;
      }
    }

    const res = await fetch(url, {
      method: method || "GET",
      headers,
      body: bodyBytes,
    });

    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      responseHeaders[k] = v;
    });

    return {
      url: res.url,
      method: method || "GET",
      statusCode: res.status,
      statusMessage: res.statusText,
      headers: responseHeaders,
      body: res.body ? iterateBody(res.body) : emptyBody(),
    };
  },
};

async function* emptyBody(): AsyncGenerator<Uint8Array> {
  // yields nothing
}

async function* iterateBody(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

// ─── Git Engine Handlers ─────────────────────────────────────────────────────

export async function handleGitCommand(
  ctx: HandlerContext,
  cmd: string,
  request: Request
): Promise<Response> {
  try {
    switch (cmd) {
      case "commit":
        return await gitCommit(ctx, request);
      case "log":
        return await gitLog(ctx);
      case "push":
        return await gitPush(ctx, request);
      case "checkout":
        return await gitCheckout(ctx, request);
      default:
        return jsonResponse({ error: `Unknown command: ${cmd}` }, 400);
    }
  } catch (e: any) {
    return jsonResponse({ error: e.message ?? String(e) }, 500);
  }
}

async function gitCommit(
  ctx: HandlerContext,
  request: Request
): Promise<Response> {
  const body = (await request.json()) as {
    message?: string;
    author?: { name: string; email: string };
  };

  const message = body.message ?? "commit";
  const author = body.author ?? {
    name: "CloudflareGit",
    email: "cloudflare-git@workers.dev",
  };

  // Stage all working_tree files via git.add
  const rows = ctx.sql.exec("SELECT path FROM working_tree").toArray();
  for (const row of rows) {
    const filePath = row.path as string;
    await git.add({ fs: ctx.fs, dir: "/", filepath: filePath });
  }

  const sha = await git.commit({
    fs: ctx.fs,
    dir: "/",
    message,
    author,
  });

  return jsonResponse({ sha });
}

async function gitLog(ctx: HandlerContext): Promise<Response> {
  const commits = await git.log({ fs: ctx.fs, dir: "/" });
  const result = commits.map((c) => ({
    oid: c.oid,
    message: c.commit.message,
    author: c.commit.author,
    committer: c.commit.committer,
    parent: c.commit.parent,
  }));
  return jsonResponse(result);
}

async function gitPush(
  ctx: HandlerContext,
  request: Request
): Promise<Response> {
  const body = (await request.json()) as {
    remote?: string;
    url: string;
    ref?: string;
    token?: string;
    username?: string;
    password?: string;
  };

  const pushOpts: any = {
    fs: ctx.fs,
    http: httpClient,
    dir: "/",
    remote: body.remote ?? "origin",
    url: body.url,
    ref: body.ref ?? "main",
  };

  // Set up auth if provided
  if (body.token) {
    pushOpts.onAuth = () => ({ username: body.token! });
  } else if (body.username && body.password) {
    pushOpts.onAuth = () => ({
      username: body.username!,
      password: body.password!,
    });
  }

  // Ensure remote is configured
  try {
    await git.addRemote({
      fs: ctx.fs,
      dir: "/",
      remote: body.remote ?? "origin",
      url: body.url,
      force: true,
    });
  } catch {
    // Ignore if remote already exists
  }

  const result = await git.push(pushOpts);
  return jsonResponse({
    ok: result.ok,
    refs: result.refs,
    error: result.error,
  });
}

async function gitCheckout(
  ctx: HandlerContext,
  request: Request
): Promise<Response> {
  const body = (await request.json()) as {
    ref: string;
    force?: boolean;
  };

  await git.checkout({
    fs: ctx.fs,
    dir: "/",
    ref: body.ref,
    force: body.force ?? false,
  });

  return jsonResponse({ ok: true, ref: body.ref });
}
