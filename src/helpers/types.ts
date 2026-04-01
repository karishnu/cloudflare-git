import type { DOFs } from "../dofs.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ErrnoError extends Error {
  code?: string;
}

export interface Env {
  GIT_REPO: DurableObjectNamespace;
  LOADER: WorkerLoader;
  API_KEY: string;
  CF_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
  SPACE_ROLE?: string;
}

export interface HandlerContext {
  sql: SqlStorage;
  fs: DOFs;
}

export interface StatResult {
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
