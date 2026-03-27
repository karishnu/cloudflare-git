import type { HandlerContext } from "../helpers/types.js";
import { jsonResponse } from "../helpers/git-pack.js";

// ─── Utility ─────────────────────────────────────────────────────────────────

function prefixEnd(s: string): string {
  return s.slice(0, -1) + String.fromCharCode(s.charCodeAt(s.length - 1) + 1);
}

// ─── FS Handlers ─────────────────────────────────────────────────────────────

export async function fsRead(
  ctx: HandlerContext,
  filePath: string
): Promise<Response> {
  try {
    const row = ctx.sql
      .exec(
        "SELECT content, mtime FROM working_tree WHERE path = ?",
        filePath
      )
      .toArray();
    if (row.length === 0) {
      return jsonResponse({ error: "Not found" }, 404);
    }
    const content = row[0].content as ArrayBuffer;
    const mtime = row[0].mtime as number;
    return new Response(content, {
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Mtime": String(mtime),
      },
    });
  } catch (e: any) {
    if (e.code === "ENOENT") {
      return jsonResponse({ error: "Not found" }, 404);
    }
    return jsonResponse({ error: e.message ?? String(e) }, 500);
  }
}

export async function fsWrite(
  ctx: HandlerContext,
  filePath: string,
  request: Request
): Promise<Response> {
  try {
    const buf = new Uint8Array(await request.arrayBuffer());
    const now = Date.now();
    ctx.sql.exec(
      "INSERT OR REPLACE INTO working_tree (path, content, mtime) VALUES (?, ?, ?)",
      filePath,
      buf,
      now
    );
    return jsonResponse({ ok: true, path: filePath, mtime: now }, 201);
  } catch (e: any) {
    return jsonResponse({ error: e.message ?? String(e) }, 500);
  }
}

export async function fsDelete(
  ctx: HandlerContext,
  filePath: string
): Promise<Response> {
  try {
    const r = ctx.sql.exec(
      "DELETE FROM working_tree WHERE path = ?",
      filePath
    );
    if (r.rowsWritten === 0) {
      return jsonResponse({ error: "Not found" }, 404);
    }
    return jsonResponse({ ok: true, path: filePath });
  } catch (e: any) {
    return jsonResponse({ error: e.message ?? String(e) }, 500);
  }
}

export async function handleList(
  ctx: HandlerContext,
  url: URL
): Promise<Response> {
  const prefix = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  const queryPrefix = prefix ? prefix + "/" : "";
  const prefixLen = prefix ? prefix.length + 1 : 0;

  let rows;
  if (queryPrefix === "") {
    rows = ctx.sql
      .exec("SELECT path, mtime FROM working_tree")
      .toArray();
  } else {
    rows = ctx.sql
      .exec(
        "SELECT path, mtime FROM working_tree WHERE path >= ? AND path < ?",
        queryPrefix,
        prefixEnd(queryPrefix)
      )
      .toArray();
  }

  const files = rows.map((r) => ({
    path: r.path as string,
    name: (r.path as string).slice(prefixLen),
    mtime: r.mtime as number,
  }));

  return jsonResponse(files);
}
