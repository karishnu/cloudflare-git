import { FsClient } from "./fs.js";
import { GitClient } from "./git.js";
import type { CloudflareGitClientConfig } from "./types.js";

export class CloudflareGitClient {
  /** File system operations */
  public readonly fs: FsClient;
  /** Git operations */
  public readonly git: GitClient;

  constructor(config: CloudflareGitClientConfig) {
    this.fs = new FsClient(config);
    this.git = new GitClient(config);
  }
}

// Re-export everything
export { FsClient } from "./fs.js";
export { GitClient } from "./git.js";
export { CloudflareGitError } from "./types.js";
export type {
  CloudflareGitClientConfig,
  FileEntry,
  WriteResult,
  DeleteResult,
  ReadOptions,
  CommitOptions,
  CommitResult,
  CommitLogEntry,
  PushOptions,
  PushResult,
  CheckoutOptions,
  CheckoutResult,
} from "./types.js";
