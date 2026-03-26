import type {
  CloudflareGitClientConfig,
  CommitOptions,
  CommitResult,
  CommitLogEntry,
  PushOptions,
  PushResult,
  CheckoutOptions,
  CheckoutResult,
} from "./types.js";
import { CloudflareGitError } from "./types.js";

export class GitClient {
  private baseUrl: string;
  private apiKey: string;
  private _fetch: typeof globalThis.fetch;

  constructor(config: CloudflareGitClientConfig) {
    this.baseUrl = config.url.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this._fetch = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Commit all staged working-tree files.
   *
   * @param message - Commit message
   * @param author  - Optional author info; defaults to server fallback
   */
  async commit(
    message: string,
    author?: { name: string; email: string }
  ): Promise<CommitResult> {
    const payload: CommitOptions = { message };
    if (author) payload.author = author;

    return this.postCmd<CommitResult>("commit", payload);
  }

  /**
   * Get the commit log.
   */
  async log(): Promise<CommitLogEntry[]> {
    const res = await this._fetch(`${this.baseUrl}/?cmd=log`, {
      headers: { "X-API-Key": this.apiKey },
    });

    const body = await safeJson(res);
    if (!res.ok) {
      throw new CloudflareGitError(
        body?.error ?? "log failed",
        res.status,
        body
      );
    }
    return body as CommitLogEntry[];
  }

  /**
   * Push to a remote Git repository.
   */
  async push(opts: PushOptions): Promise<PushResult> {
    return this.postCmd<PushResult>("push", opts);
  }

  /**
   * Checkout a branch or commit.
   */
  async checkout(ref: string, force?: boolean): Promise<CheckoutResult> {
    const payload: CheckoutOptions = { ref };
    if (force !== undefined) payload.force = force;

    return this.postCmd<CheckoutResult>("checkout", payload);
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private async postCmd<T>(cmd: string, payload: unknown): Promise<T> {
    const res = await this._fetch(`${this.baseUrl}/?cmd=${cmd}`, {
      method: "POST",
      headers: {
        "X-API-Key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const body = await safeJson(res);
    if (!res.ok) {
      throw new CloudflareGitError(
        body?.error ?? `${cmd} failed`,
        res.status,
        body
      );
    }
    return body as T;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function safeJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
