import type { ErrnoError, StatResult } from "./helpers/types.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const GIT_DIR = ".git";
const OBJECTS_PREFIX = ".git/objects/";
const REFS_PREFIX = ".git/refs/";

function prefixEnd(s: string): string {
  return s.slice(0, -1) + String.fromCharCode(s.charCodeAt(s.length - 1) + 1);
}

// ─── DOFs: Durable Object File System shim ──────────────────────────────────

export class DOFs {
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
    if (!p.startsWith(OBJECTS_PREFIX) || p.endsWith("/")) return false;
    // Exclude pack/ and info/ subdirectories — those are stored in git_internal
    const rel = p.slice(OBJECTS_PREFIX.length);
    if (rel.startsWith("pack/") || rel.startsWith("info/")) return false;
    return true;
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
          const subdir = prefix.slice(OBJECTS_PREFIX.length).replace(/\/$/, "");
          if (subdir.length === 2) {
            // Inside a 2-char subdir like .git/objects/ab/
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
          // Also scan git_internal for paths like .git/objects/pack/*, .git/objects/info/*
          const fullPrefix = prefix.startsWith(".git/") ? prefix : ".git/" + prefix;
          const intRows = this.sql
            .exec(
              "SELECT path FROM git_internal WHERE path >= ? AND path < ?",
              fullPrefix,
              prefixEnd(fullPrefix)
            )
            .toArray();
          for (const row of intRows) {
            const full = row.path as string;
            const rel = full.slice(fullPrefix.length);
            const slash = rel.indexOf("/");
            entries.add(slash === -1 ? rel : rel.slice(0, slash));
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
