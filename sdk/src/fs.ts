import type {
  CloudflareGitClientConfig,
  FileEntry,
  WriteResult,
  DeleteResult,
  ReadOptions,
} from "./types.js";
import { CloudflareGitError } from "./types.js";

export class FsClient {
  private baseUrl: string;
  private apiKey: string;
  private _fetch: typeof globalThis.fetch;

  constructor(config: CloudflareGitClientConfig) {
    this.baseUrl = config.url.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this._fetch = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Read a file's contents.
   * Returns a string by default, or ArrayBuffer with `{ encoding: "binary" }`.
   */
  async read(path: string, opts?: ReadOptions): Promise<string>;
  async read(
    path: string,
    opts: ReadOptions & { encoding: "binary" }
  ): Promise<ArrayBuffer>;
  async read(
    path: string,
    opts?: ReadOptions
  ): Promise<string | ArrayBuffer> {
    const res = await this._fetch(`${this.baseUrl}/${encodePath(path)}`, {
      headers: { "X-API-Key": this.apiKey },
    });

    if (!res.ok) {
      const body = await safeJson(res);
      throw new CloudflareGitError(
        body?.error ?? `GET /${path} failed`,
        res.status,
        body
      );
    }

    if (opts?.encoding === "binary") {
      return res.arrayBuffer();
    }
    return res.text();
  }

  /**
   * Write or overwrite a file.
   */
  async write(
    path: string,
    content: string | ArrayBuffer | Uint8Array
  ): Promise<WriteResult> {
    const res = await this._fetch(`${this.baseUrl}/${encodePath(path)}`, {
      method: "PUT",
      headers: { "X-API-Key": this.apiKey },
      body: content as BodyInit,
    });

    const body = await safeJson(res);
    if (!res.ok) {
      throw new CloudflareGitError(
        body?.error ?? `PUT /${path} failed`,
        res.status,
        body
      );
    }
    return body as WriteResult;
  }

  /**
   * Delete a file.
   */
  async delete(path: string): Promise<DeleteResult> {
    const res = await this._fetch(`${this.baseUrl}/${encodePath(path)}`, {
      method: "DELETE",
      headers: { "X-API-Key": this.apiKey },
    });

    const body = await safeJson(res);
    if (!res.ok) {
      throw new CloudflareGitError(
        body?.error ?? `DELETE /${path} failed`,
        res.status,
        body
      );
    }
    return body as DeleteResult;
  }

  /**
   * List files under a path prefix.
   * Pass an empty string or omit to list all files.
   */
  async list(path: string = ""): Promise<FileEntry[]> {
    const encoded = path ? `/${encodePath(path)}` : "";
    const res = await this._fetch(`${this.baseUrl}${encoded}?list`, {
      headers: { "X-API-Key": this.apiKey },
    });

    const body = await safeJson(res);
    if (!res.ok) {
      throw new CloudflareGitError(
        body?.error ?? `LIST ${path || "/"} failed`,
        res.status,
        body
      );
    }
    return body as FileEntry[];
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function encodePath(path: string): string {
  return path
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
}

async function safeJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
