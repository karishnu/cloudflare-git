// ─── Client Config ───────────────────────────────────────────────────────────

export interface CloudflareGitClientConfig {
  /** Base URL of the deployed CloudflareGit worker (e.g. "https://cloudflare-git.example.workers.dev") */
  url: string;
  /** API key for authentication (sent as X-API-Key header) */
  apiKey: string;
  /** Optional custom fetch implementation */
  fetch?: typeof globalThis.fetch;
}

// ─── FS Types ────────────────────────────────────────────────────────────────

export interface FileEntry {
  path: string;
  name: string;
  mtime: number;
}

export interface WriteResult {
  ok: boolean;
  path: string;
  mtime: number;
}

export interface DeleteResult {
  ok: boolean;
  path: string;
}

export interface ReadOptions {
  /** Return raw ArrayBuffer instead of decoded string */
  encoding?: "utf-8" | "binary";
}

// ─── Git Types ───────────────────────────────────────────────────────────────

export interface CommitOptions {
  message: string;
  author?: { name: string; email: string };
}

export interface CommitResult {
  sha: string;
}

export interface CommitLogEntry {
  oid: string;
  message: string;
  author: {
    name: string;
    email: string;
    timestamp: number;
    timezoneOffset: number;
  };
  committer: {
    name: string;
    email: string;
    timestamp: number;
    timezoneOffset: number;
  };
  parent: string[];
}

export interface PushOptions {
  url: string;
  remote?: string;
  ref?: string;
  token?: string;
  username?: string;
  password?: string;
}

export interface PushResult {
  ok: boolean;
  refs: Record<string, unknown>;
  error: string | null;
}

export interface CheckoutOptions {
  ref: string;
  force?: boolean;
}

export interface CheckoutResult {
  ok: boolean;
  ref: string;
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class CloudflareGitError extends Error {
  public readonly status: number;
  public readonly body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "CloudflareGitError";
    this.status = status;
    this.body = body;
  }
}
