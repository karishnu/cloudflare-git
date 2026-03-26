import { DurableObject } from "cloudflare:workers";
import git from "isomorphic-git";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ErrnoError extends Error {
  code?: string;
}

interface Env {
  GIT_REPO: DurableObjectNamespace<GitRepoDO>;
  API_KEY: string;
}

interface StatResult {
  type: "file" | "dir";
  mode: number;
  size: number;
  ino: number;
  mtimeMs: number;
  ctimeMs: number;
  uid: 1;
  gid: 1;
  dev: 1;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

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

// ─── SQLite FS Shim ─────────────────────────────────────────────────────────

const GIT_DIR = ".git";
const OBJECTS_PREFIX = ".git/objects/";
const REFS_PREFIX = ".git/refs/";

function prefixEnd(s: string): string {
  return s.slice(0, -1) + String.fromCharCode(s.charCodeAt(s.length - 1) + 1);
}

class SqliteFs {
  private sql: SqlStorage;
  public promises: Record<string, Function>;

  constructor(sql: SqlStorage) {
    this.sql = sql;
    this.promises = {
      readFile: this.readFile.bind(this),
      writeFile: this.writeFile.bind(this),
      unlink: this.unlink.bind(this),
      readdir: this.readdir.bind(this),
      mkdir: this.mkdir.bind(this),
      rmdir: this.rmdir.bind(this),
      stat: this.stat.bind(this),
      lstat: this.lstat.bind(this),
      readlink: this.readlink.bind(this),
      symlink: this.symlink.bind(this),
    };
  }

  // ── helpers ──


  private normPath(p: string): string {
    // strip leading /
    if (p.startsWith("/")) p = p.slice(1);
    // remove trailing /
    if (p.endsWith("/") && p.length > 1) p = p.slice(0, -1);
    return p;
  }

  private isGitObjectPath(p: string): boolean {
    return p.startsWith(OBJECTS_PREFIX) && !p.endsWith("/");
  }

  private hashFromObjectPath(p: string): string | null {
    // .git/objects/ab/cdef1234... → abcdef1234...
    const rel = p.slice(OBJECTS_PREFIX.length);
    const parts = rel.split("/");
    if (parts.length === 2 && parts[0].length === 2) {
      return parts[0] + parts[1];
    }
    return null;
  }

  private objectPathFromHash(hash: string): string {
    return `${OBJECTS_PREFIX}${hash.slice(0, 2)}/${hash.slice(2)}`;
  }

  private isRefPath(p: string): boolean {
    return p.startsWith(REFS_PREFIX);
  }

  private refNameFromPath(p: string): string {
    // .git/refs/heads/main → refs/heads/main
    return p.slice(GIT_DIR.length + 1); // strip ".git/"
  }

  private isGitInternal(p: string): boolean {
    return p.startsWith(GIT_DIR + "/") || p === GIT_DIR;
  }

  private makeStat(
    type: "file" | "dir",
    size: number,
    mtimeMs: number
  ): StatResult {
    return {
      type,
      mode: type === "file" ? 0o100644 : 0o40000,
      size,
      ino: 0,
      mtimeMs,
      ctimeMs: mtimeMs,
      uid: 1,
      gid: 1,
      dev: 1,
      isFile: () => type === "file",
      isDirectory: () => type === "dir",
      isSymbolicLink: () => false,
    };
  }

  private enoent(p: string): Error {
    const err: ErrnoError = new Error(`ENOENT: no such file or directory, '${p}'`);
    err.code = "ENOENT";
    return err;
  }

  private eexist(p: string): Error {
    const err: ErrnoError = new Error(`EEXIST: file already exists, '${p}'`);
    err.code = "EEXIST";
    return err;
  }

  private enotdir(p: string): Error {
    const err: ErrnoError = new Error(`ENOTDIR: not a directory, '${p}'`);
    err.code = "ENOTDIR";
    return err;
  }

  // ── readFile ──

  async readFile(
    filepath: string,
    opts?: { encoding?: string } | string
  ): Promise<Uint8Array | string> {
    const p = this.normPath(filepath);
    const encoding =
      typeof opts === "string" ? opts : opts?.encoding ?? null;

    let raw: ArrayBuffer | null = null;

    if (!this.isGitInternal(p)) {
      // working_tree
      const row = this.sql
        .exec("SELECT content FROM working_tree WHERE path = ?", p)
        .toArray();
      if (row.length === 0) throw this.enoent(p);
      raw = row[0].content as ArrayBuffer;
    } else if (this.isGitObjectPath(p)) {
      const hash = this.hashFromObjectPath(p);
      if (!hash) throw this.enoent(p);
      const row = this.sql
        .exec("SELECT content FROM git_objects WHERE hash = ?", hash)
        .toArray();
      if (row.length === 0) throw this.enoent(p);
      raw = row[0].content as ArrayBuffer;
    } else if (this.isRefPath(p)) {
      const refName = this.refNameFromPath(p);
      const row = this.sql
        .exec("SELECT hash FROM refs WHERE name = ?", refName)
        .toArray();
      if (row.length === 0) throw this.enoent(p);
      const hashStr = row[0].hash as string;
      const encoded = new TextEncoder().encode(hashStr + "\n");
      raw = encoded.buffer as ArrayBuffer;
    } else {
      // git_internal
      const row = this.sql
        .exec("SELECT content FROM git_internal WHERE path = ?", p)
        .toArray();
      if (row.length === 0) throw this.enoent(p);
      raw = row[0].content as ArrayBuffer;
    }

    if (encoding === "utf8" || encoding === "utf-8") {
      return new TextDecoder().decode(raw!);
    }
    return new Uint8Array(raw!);
  }

  // ── writeFile ──

  async writeFile(
    filepath: string,
    data: Uint8Array | string,
    opts?: { encoding?: string; mode?: number }
  ): Promise<void> {
    const p = this.normPath(filepath);
    const now = Date.now();

    let buf: Uint8Array;
    if (typeof data === "string") {
      buf = new TextEncoder().encode(data);
    } else {
      buf = data;
    }

    if (!this.isGitInternal(p)) {
      this.sql.exec(
        "INSERT OR REPLACE INTO working_tree (path, content, mtime) VALUES (?, ?, ?)",
        p,
        buf,
        now
      );
    } else if (this.isGitObjectPath(p)) {
      const hash = this.hashFromObjectPath(p);
      if (hash) {
        // Determine type from content header (blob, tree, commit, tag)
        let objType = "blob";
        try {
          const header = new TextDecoder().decode(buf.slice(0, 20));
          const spaceIdx = header.indexOf(" ");
          if (spaceIdx > 0) {
            const t = header.slice(0, spaceIdx);
            if (["blob", "tree", "commit", "tag"].includes(t)) {
              objType = t;
            }
          }
        } catch {
          // ignore
        }
        this.sql.exec(
          "INSERT OR REPLACE INTO git_objects (hash, type, content) VALUES (?, ?, ?)",
          hash,
          objType,
          buf
        );
      }
    } else if (this.isRefPath(p)) {
      const refName = this.refNameFromPath(p);
      const hashStr =
        typeof data === "string" ? data.trim() : new TextDecoder().decode(buf).trim();
      this.sql.exec(
        "INSERT OR REPLACE INTO refs (name, hash) VALUES (?, ?)",
        refName,
        hashStr
      );
    } else {
      this.sql.exec(
        "INSERT OR REPLACE INTO git_internal (path, content, mtime) VALUES (?, ?, ?)",
        p,
        buf,
        now
      );
    }
  }

  // ── unlink ──

  async unlink(filepath: string): Promise<void> {
    const p = this.normPath(filepath);

    if (!this.isGitInternal(p)) {
      const r = this.sql.exec("DELETE FROM working_tree WHERE path = ?", p);
      if (r.rowsWritten === 0) throw this.enoent(p);
    } else if (this.isGitObjectPath(p)) {
      const hash = this.hashFromObjectPath(p);
      if (hash) this.sql.exec("DELETE FROM git_objects WHERE hash = ?", hash);
    } else if (this.isRefPath(p)) {
      const refName = this.refNameFromPath(p);
      this.sql.exec("DELETE FROM refs WHERE name = ?", refName);
    } else {
      const r = this.sql.exec("DELETE FROM git_internal WHERE path = ?", p);
      if (r.rowsWritten === 0) throw this.enoent(p);
    }
  }

  // ── readdir ──

  async readdir(filepath: string): Promise<string[]> {
    const p = this.normPath(filepath);
    const prefix = p === "" || p === "." ? "" : p + "/";
    const entries = new Set<string>();

    if (prefix === "" || !this.isGitInternal(prefix)) {
      // List from working_tree
      const wtPrefix = prefix === "" ? "" : prefix;
      let rows;
      if (wtPrefix === "") {
        rows = this.sql.exec("SELECT path FROM working_tree").toArray();
      } else {
        rows = this.sql
          .exec(
            "SELECT path FROM working_tree WHERE path >= ? AND path < ?",
            wtPrefix,
            prefixEnd(wtPrefix)
          )
          .toArray();
      }
      for (const row of rows) {
        const full = row.path as string;
        const rel = full.slice(wtPrefix.length);
        const slash = rel.indexOf("/");
        entries.add(slash === -1 ? rel : rel.slice(0, slash));
      }
    }

    if (prefix === "" || prefix === ".git/" || prefix.startsWith(".git/")) {
      // At root level, include .git as a directory entry
      if (prefix === "") {
        // Check if any git data exists
        const hasRefs = this.sql.exec("SELECT COUNT(*) as c FROM refs").one()
          .c as number;
        const hasInternal = this.sql
          .exec("SELECT COUNT(*) as c FROM git_internal")
          .one().c as number;
        const hasObjects = this.sql
          .exec("SELECT COUNT(*) as c FROM git_objects")
          .one().c as number;
        if (hasRefs > 0 || hasInternal > 0 || hasObjects > 0) {
          entries.add(".git");
        }
      }

      // Inside .git/
      if (prefix === ".git/" || prefix === "") {
        const gitPrefix = ".git/";
        // git_internal paths
        const intRows = this.sql
          .exec("SELECT path FROM git_internal")
          .toArray();
        for (const row of intRows) {
          const full = row.path as string;
          if (full.startsWith(gitPrefix)) {
            const rel = full.slice(gitPrefix.length);
            const slash = rel.indexOf("/");
            if (prefix === ".git/") {
              entries.add(slash === -1 ? rel : rel.slice(0, slash));
            }
          }
        }

        // objects dir
        const hasObj =
          this.sql.exec("SELECT COUNT(*) as c FROM git_objects").one()
            .c as number;
        if (hasObj > 0 && prefix === ".git/") {
          entries.add("objects");
        }

        // refs dir
        const hasRef =
          this.sql.exec("SELECT COUNT(*) as c FROM refs").one().c as number;
        if (hasRef > 0 && prefix === ".git/") {
          entries.add("refs");
        }
      }

      // Inside .git/objects/
      if (prefix.startsWith(OBJECTS_PREFIX) || prefix === ".git/objects/") {
        if (prefix === ".git/objects/" || prefix === OBJECTS_PREFIX) {
          // List 2-char subdirectories
          const rows = this.sql
            .exec("SELECT DISTINCT substr(hash, 1, 2) as prefix FROM git_objects")
            .toArray();
          for (const row of rows) {
            entries.add(row.prefix as string);
          }
          // Also include pack/ and info/ from git_internal if they exist
          const packRows = this.sql
            .exec(
              "SELECT path FROM git_internal WHERE path >= ? AND path < ?",
              OBJECTS_PREFIX,
              prefixEnd(OBJECTS_PREFIX)
            )
            .toArray();
          for (const row of packRows) {
            const full = row.path as string;
            const rel = full.slice(OBJECTS_PREFIX.length);
            const slash = rel.indexOf("/");
            entries.add(slash === -1 ? rel : rel.slice(0, slash));
          }
        } else {
          // Inside a 2-char subdir like .git/objects/ab/
          const subdir = prefix.slice(OBJECTS_PREFIX.length).replace(/\/$/, "");
          if (subdir.length === 2) {
            const rows = this.sql
              .exec(
                "SELECT substr(hash, 3) as suffix FROM git_objects WHERE substr(hash, 1, 2) = ?",
                subdir
              )
              .toArray();
            for (const row of rows) {
              entries.add(row.suffix as string);
            }
          }
        }
      }

      // Inside .git/refs/
      if (prefix.startsWith(REFS_PREFIX) || prefix === ".git/refs/") {
        const refsPrefix = prefix === ".git/refs/" ? "refs/" : prefix.slice(GIT_DIR.length + 1);
        const rows = this.sql
          .exec("SELECT name FROM refs WHERE name >= ? AND name < ?", refsPrefix, prefixEnd(refsPrefix))
          .toArray();
        for (const row of rows) {
          const full = row.name as string;
          const rel = full.slice(refsPrefix.length);
          const slash = rel.indexOf("/");
          entries.add(slash === -1 ? rel : rel.slice(0, slash));
        }
      }
    }

    if (entries.size === 0 && p !== "" && p !== ".") {
      // Check if this directory actually "exists"
      const exists = await this.dirExists(p);
      if (!exists) throw this.enoent(filepath);
    }

    return [...entries];
  }

  private async dirExists(p: string): Promise<boolean> {
    const prefix = p + "/";
    if (!this.isGitInternal(p)) {
      const c = this.sql
        .exec(
          "SELECT COUNT(*) as c FROM working_tree WHERE path >= ? AND path < ?",
          prefix,
          prefixEnd(prefix)
        )
        .one().c as number;
      if (c > 0) return true;
    }
    if (p === GIT_DIR || p.startsWith(GIT_DIR + "/")) {
      const c1 = this.sql
        .exec(
          "SELECT COUNT(*) as c FROM git_internal WHERE path >= ? AND path < ?",
          prefix,
          prefixEnd(prefix)
        )
        .one().c as number;
      if (c1 > 0) return true;

      if (p === GIT_DIR) {
        const c2 = this.sql.exec("SELECT COUNT(*) as c FROM refs").one()
          .c as number;
        const c3 = this.sql.exec("SELECT COUNT(*) as c FROM git_objects").one()
          .c as number;
        if (c2 > 0 || c3 > 0) return true;
      }
      if (p.startsWith(OBJECTS_PREFIX) || p === ".git/objects") {
        const sub = p.slice(OBJECTS_PREFIX.length);
        if (sub.length === 0 || sub.length === 2) {
          return true; // objects dir or 2-char subdir
        }
      }
      if (p.startsWith(REFS_PREFIX) || p === ".git/refs") {
        return true;
      }
    }
    return false;
  }

  // ── mkdir ──

  async mkdir(filepath: string): Promise<void> {
    // Directories are virtual, nothing to store.
    // But we should throw EEXIST if it's a file
    const p = this.normPath(filepath);
    if (!this.isGitInternal(p)) {
      const c = this.sql
        .exec("SELECT COUNT(*) as c FROM working_tree WHERE path = ?", p)
        .one().c as number;
      if (c > 0) throw this.eexist(p);
    }
    // Otherwise silently succeed
  }

  // ── rmdir ──

  async rmdir(filepath: string): Promise<void> {
    // Virtual dirs — just check if non-empty
    const p = this.normPath(filepath);
    const children = await this.readdir(filepath);
    if (children.length > 0) {
      const err: ErrnoError = new Error(
        `ENOTEMPTY: directory not empty, '${p}'`
      );
      err.code = "ENOTEMPTY";
      throw err;
    }
  }

  // ── stat ──

  async stat(filepath: string): Promise<StatResult> {
    const p = this.normPath(filepath);

    // Check as file first
    if (!this.isGitInternal(p)) {
      const row = this.sql
        .exec("SELECT length(content) as size, mtime FROM working_tree WHERE path = ?", p)
        .toArray();
      if (row.length > 0) {
        return this.makeStat("file", row[0].size as number, row[0].mtime as number);
      }
    } else if (this.isGitObjectPath(p)) {
      const hash = this.hashFromObjectPath(p);
      if (hash) {
        const row = this.sql
          .exec("SELECT length(content) as size FROM git_objects WHERE hash = ?", hash)
          .toArray();
        if (row.length > 0) {
          return this.makeStat("file", row[0].size as number, 0);
        }
      }
    } else if (this.isRefPath(p)) {
      const refName = this.refNameFromPath(p);
      const row = this.sql
        .exec("SELECT hash FROM refs WHERE name = ?", refName)
        .toArray();
      if (row.length > 0) {
        return this.makeStat("file", (row[0].hash as string).length + 1, 0);
      }
    } else if (this.isGitInternal(p)) {
      const row = this.sql
        .exec("SELECT length(content) as size, mtime FROM git_internal WHERE path = ?", p)
        .toArray();
      if (row.length > 0) {
        return this.makeStat("file", row[0].size as number, row[0].mtime as number);
      }
    }

    // Check as directory
    const isDir = await this.dirExists(p);
    if (isDir) {
      return this.makeStat("dir", 0, 0);
    }

    // Root directory always exists
    if (p === "" || p === "." || p === "/") {
      return this.makeStat("dir", 0, 0);
    }

    throw this.enoent(filepath);
  }

  // ── lstat ──

  async lstat(filepath: string): Promise<StatResult> {
    return this.stat(filepath);
  }

  // ── readlink / symlink (stubs) ──

  async readlink(_filepath: string): Promise<string> {
    throw this.enoent(_filepath);
  }

  async symlink(_target: string, _filepath: string): Promise<void> {
    // Not supported; silently ignore
  }
}

// ─── Durable Object: GitRepoDO ──────────────────────────────────────────────

export class GitRepoDO extends DurableObject<Env> {
  private sql: SqlStorage;
  private fs: SqliteFs;
  private initialized: boolean = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.fs = new SqliteFs(this.sql);

    // Create tables
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS working_tree (
        path TEXT PRIMARY KEY,
        content BLOB NOT NULL,
        mtime INTEGER NOT NULL
      )
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS git_objects (
        hash TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content BLOB NOT NULL
      )
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS refs (
        name TEXT PRIMARY KEY,
        hash TEXT NOT NULL
      )
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS git_internal (
        path TEXT PRIMARY KEY,
        content BLOB NOT NULL,
        mtime INTEGER NOT NULL
      )
    `);
  }

  private async ensureInit(): Promise<void> {
    if (this.initialized) return;
    // Check if repo is already initialized
    const headExists = this.sql
      .exec("SELECT COUNT(*) as c FROM git_internal WHERE path = '.git/HEAD'")
      .one().c as number;
    if (headExists === 0) {
      await git.init({ fs: this.fs, dir: "/", defaultBranch: "main" });
    }
    this.initialized = true;
  }

  async fetch(request: Request): Promise<Response> {
    await this.ensureInit();

    const url = new URL(request.url);
    const cmd = url.searchParams.get("cmd");

    if (cmd) {
      return this.handleGit(cmd, request, url);
    }

    const list = url.searchParams.has("list");
    if (list) {
      return this.handleList(url);
    }

    return this.handleFs(request, url);
  }

  // ── Git Engine ──

  private async handleGit(
    cmd: string,
    request: Request,
    _url: URL
  ): Promise<Response> {
    try {
      switch (cmd) {
        case "commit":
          return await this.gitCommit(request);
        case "log":
          return await this.gitLog();
        case "push":
          return await this.gitPush(request);
        case "checkout":
          return await this.gitCheckout(request);
        default:
          return jsonResponse({ error: `Unknown command: ${cmd}` }, 400);
      }
    } catch (e: any) {
      return jsonResponse({ error: e.message ?? String(e) }, 500);
    }
  }

  private async gitCommit(request: Request): Promise<Response> {
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
    const rows = this.sql.exec("SELECT path FROM working_tree").toArray();
    for (const row of rows) {
      const filePath = row.path as string;
      await git.add({ fs: this.fs, dir: "/", filepath: filePath });
    }

    const sha = await git.commit({
      fs: this.fs,
      dir: "/",
      message,
      author,
    });

    return jsonResponse({ sha });
  }

  private async gitLog(): Promise<Response> {
    const commits = await git.log({ fs: this.fs, dir: "/" });
    const result = commits.map((c) => ({
      oid: c.oid,
      message: c.commit.message,
      author: c.commit.author,
      committer: c.commit.committer,
      parent: c.commit.parent,
    }));
    return jsonResponse(result);
  }

  private async gitPush(request: Request): Promise<Response> {
    const body = (await request.json()) as {
      remote?: string;
      url: string;
      ref?: string;
      token?: string;
      username?: string;
      password?: string;
    };

    const pushOpts: any = {
      fs: this.fs,
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
        fs: this.fs,
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

  private async gitCheckout(request: Request): Promise<Response> {
    const body = (await request.json()) as {
      ref: string;
      force?: boolean;
    };

    await git.checkout({
      fs: this.fs,
      dir: "/",
      ref: body.ref,
      force: body.force ?? false,
    });

    return jsonResponse({ ok: true, ref: body.ref });
  }

  // ── FS Engine ──

  private async handleFs(request: Request, url: URL): Promise<Response> {
    const filePath = decodeURIComponent(url.pathname.replace(/^\/+/, ""));

    if (!filePath) {
      return jsonResponse({ error: "Path required" }, 400);
    }

    try {
      switch (request.method) {
        case "GET":
          return await this.fsRead(filePath);
        case "PUT":
          return await this.fsWrite(filePath, request);
        case "DELETE":
          return await this.fsDelete(filePath);
        default:
          return jsonResponse({ error: "Method not allowed" }, 405);
      }
    } catch (e: any) {
      if (e.code === "ENOENT") {
        return jsonResponse({ error: "Not found" }, 404);
      }
      return jsonResponse({ error: e.message ?? String(e) }, 500);
    }
  }

  private async fsRead(filePath: string): Promise<Response> {
    const row = this.sql
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
  }

  private async fsWrite(
    filePath: string,
    request: Request
  ): Promise<Response> {
    const buf = new Uint8Array(await request.arrayBuffer());
    const now = Date.now();
    this.sql.exec(
      "INSERT OR REPLACE INTO working_tree (path, content, mtime) VALUES (?, ?, ?)",
      filePath,
      buf,
      now
    );
    return jsonResponse({ ok: true, path: filePath, mtime: now }, 201);
  }

  private async fsDelete(filePath: string): Promise<Response> {
    const r = this.sql.exec(
      "DELETE FROM working_tree WHERE path = ?",
      filePath
    );
    if (r.rowsWritten === 0) {
      return jsonResponse({ error: "Not found" }, 404);
    }
    return jsonResponse({ ok: true, path: filePath });
  }

  private async handleList(url: URL): Promise<Response> {
    const prefix = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    const queryPrefix = prefix ? prefix + "/" : "";
    const prefixLen = prefix ? prefix.length + 1 : 0;

    let rows;
    if (queryPrefix === "") {
      rows = this.sql
        .exec("SELECT path, mtime FROM working_tree")
        .toArray();
    } else {
      rows = this.sql
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
}

// ─── Worker Entry Point ─────────────────────────────────────────────────────

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    // Auth check
    const apiKey = request.headers.get("X-API-Key");
    if (!apiKey || apiKey !== env.API_KEY) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    // Forward everything to the singleton DO
    const id = env.GIT_REPO.idFromName("repo");
    const stub = env.GIT_REPO.get(id);
    return stub.fetch(request);
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
