import { DurableObject } from "cloudflare:workers";
import git from "isomorphic-git";
import { Hono } from "hono";
import { DOFs } from "./dofs.js";
import type { Env, HandlerContext } from "./helpers/types.js";
import { apiRoutes } from "./routes/api.js";
import { gitHttpRoutes } from "./routes/git-http.js";

// ─── Durable Object: GitRepoDO ──────────────────────────────────────────────

export class GitRepoDO extends DurableObject<Env> {
  private sql: SqlStorage;
  private fs: DOFs;
  private initialized: boolean = false;
  private app: Hono<{ Variables: { ctx: HandlerContext } }>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.fs = new DOFs(this.sql);

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

    // Build internal Hono app with routes
    this.app = new Hono<{ Variables: { ctx: HandlerContext } }>();

    // Inject handler context into all route handlers
    this.app.use("*", async (c, next) => {
      c.set("ctx", { sql: this.sql, fs: this.fs });
      await next();
    });

    // Mount route groups
    this.app.route("/", gitHttpRoutes);
    this.app.route("/", apiRoutes);
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
    return this.app.fetch(request);
  }
}
