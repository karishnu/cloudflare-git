# AgentSpace

Remote filesystem & git workspaces on Cloudflare Workers + Durable Objects. Gives AI agents a remote workspace with **file read/write/edit/grep/glob/patch**, **git commit/log**, and the ability to **spin up new spaces** — each with its own URL.

There are two layers:

1. **Management MCP** — an MCP server on the main deployment for provisioning spaces (`create_space`, `list_spaces`, `delete_space`)
2. **Workspace tools** — [OpenCode custom tools](https://opencode.ai/docs/custom-tools) in `.opencode/tools/` that call the space's REST API. Each tool takes `space_url` + `api_key` as parameters so agents can target any space dynamically.

Agent spaces themselves do **not** expose MCP. They only serve the REST API, Git Smart HTTP, and Dynamic Worker routes.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/karishnu/agent-space)

## Quick Start

### 1. Deploy

```bash
git clone https://github.com/karishnu/agent-space.git
cd agent-space
npm install
```

Set secrets:

```bash
npx wrangler secret put API_KEY          # Auth for MCP / REST / Git
npx wrangler secret put CF_API_TOKEN     # Cloudflare API (for create_space)
npx wrangler secret put CF_ACCOUNT_ID    # Your Cloudflare account ID
```

Deploy:

```bash
npm run deploy
```

Your management instance is live at `https://agent-space.YOUR_SUBDOMAIN.workers.dev`.

### 2. Configure OpenCode

#### Management MCP (space provisioning)

Add to your `opencode.json`:

```json
{
  "mcp": {
    "agent-space": {
      "type": "remote",
      "url": "https://agent-space.YOUR_SUBDOMAIN.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

This gives the agent three MCP tools: `create_space`, `list_spaces`, `delete_space`.

#### Workspace tools (file/git operations)

Copy the `.opencode/tools/` directory into your project (or `~/.config/opencode/tools/` for global access). These custom tools override OpenCode's built-in `read`, `write`, `edit`, `glob`, and `grep` and add `list`, `patch`, `git_commit`, `git_log`, and `git_status`.

Every workspace tool takes `space_url` and `api_key` as parameters. The agent gets these values from the management MCP's `create_space` or `list_spaces` responses, then passes them to each tool call.

### 3. Example Agent Workflow

```
1. Agent calls create_space(name: "my-project") via MCP
   → returns { url: "https://agent-space-my-project.xxx.workers.dev", api_key: "..." }

2. Agent calls write(space_url: url, api_key: key, path: "index.ts", content: "...")
   → creates a file in the remote space

3. Agent calls git_commit(space_url: url, api_key: key, message: "init")
   → commits all files

4. Agent can switch to a different space at any time by using a different space_url
```

---

## Management MCP Tools

Available at `/mcp` on the **management instance only**. Auth uses `Authorization: Bearer <API_KEY>`.

| Tool | Description |
|------|-------------|
| `create_space` | Deploy a new space as a separate Worker (own URL, filesystem, git). Returns `url` + `api_key`. |
| `list_spaces` | List all deployed agent-spaces |
| `delete_space` | Delete a space and all its data |

---

## Workspace Tools (OpenCode Custom Tools)

Located in `.opencode/tools/`. Each tool takes `space_url` + `api_key` as parameters and calls the space's REST API.

### Filesystem

| Tool | Overrides | Description |
|------|-----------|-------------|
| `read` | built-in `read` | Read file contents (optional `offset`/`limit` for line ranges) |
| `write` | built-in `write` | Create or overwrite a file |
| `edit` | built-in `edit` | Find-and-replace an exact string in a file |
| `glob` | built-in `glob` | Find files by glob pattern (e.g. `**/*.ts`) |
| `grep` | built-in `grep` | Regex search across files (optional glob `include` filter) |
| `list` | — | List files, optionally filtered by prefix |
| `patch` | — | Apply a unified diff to one or more files |

### Git

| Tool | Description |
|------|-------------|
| `git_commit` | Commit all working tree files |
| `git_log` | View commit history |
| `git_status` | List files in the working tree with timestamps |

---

## Dynamic Worker Deployments

Deploy code from any git branch as an isolated, sandboxed [Dynamic Worker](https://developers.cloudflare.com/dynamic-workers/). The parent worker reads files from the branch, bundles TypeScript + npm dependencies via `@cloudflare/worker-bundler`, and serves the result at `/deploy/{branch}/`.

- **Sandboxed**: Dynamic Workers have no outbound network access (`globalOutbound: null`)
- **Cached**: Workers are cached by `{branch}:{commitHash}` — redeploying after new commits busts the cache automatically
- **Pre-bundled**: Bundling happens at deploy time, not per-request

```bash
# Deploy a branch (via REST API)
curl -X POST "https://agent-space-my-project.YOUR_SUBDOMAIN.workers.dev/?cmd=deploy" \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"branch": "feature/api"}'

# Access the deployed worker
curl https://agent-space-my-project.YOUR_SUBDOMAIN.workers.dev/deploy/feature/api/

# List deployments
curl "https://agent-space-my-project.YOUR_SUBDOMAIN.workers.dev/?cmd=list_deployments" \
  -H "X-API-Key: YOUR_KEY"

# Undeploy
curl -X POST "https://agent-space-my-project.YOUR_SUBDOMAIN.workers.dev/?cmd=undeploy" \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"branch": "feature/api"}'
```

---

## REST API

The HTTP API is available on every space for direct programmatic access. Auth uses `X-API-Key` header.

```bash
# Write a file
curl -X PUT https://agent-space-my-project.YOUR_SUBDOMAIN.workers.dev/src/app.ts \
  -H "X-API-Key: YOUR_KEY" \
  -d 'console.log("hello")'

# Read a file
curl https://agent-space-my-project.YOUR_SUBDOMAIN.workers.dev/src/app.ts \
  -H "X-API-Key: YOUR_KEY"

# List files
curl "https://agent-space-my-project.YOUR_SUBDOMAIN.workers.dev/?list" \
  -H "X-API-Key: YOUR_KEY"

# Commit
curl -X POST "https://agent-space-my-project.YOUR_SUBDOMAIN.workers.dev/?cmd=commit" \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "initial commit"}'

# Log
curl "https://agent-space-my-project.YOUR_SUBDOMAIN.workers.dev/?cmd=log" \
  -H "X-API-Key: YOUR_KEY"
```

---

## Git Remote (Smart HTTP)

Standard `git clone` / `git push` via the [Git Smart HTTP protocol](https://git-scm.com/docs/http-protocol). Auth uses HTTP Basic (any username, `API_KEY` as password).

```bash
# Clone
git clone https://git:YOUR_API_KEY@agent-space-my-project.YOUR_SUBDOMAIN.workers.dev/repo.git

# Push
cd repo && echo "hello" > file.txt && git add . && git commit -m "update"
git push origin main
```

Changes made via REST are visible when you `git pull`, and pushes are reflected in REST immediately.

---

## Architecture

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                    Management Instance                              │
  │                    (SPACE_ROLE=management)                          │
  │                                                                     │
  │  MCP client ──► Bearer auth ──► /mcp (create/list/delete spaces)   │
  └─────────────────────────────────────────────────────────────────────┘
                           │ deploys
                           ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │                    Agent Space (child worker)                       │
  │                    (SPACE_ROLE=workspace, no MCP)                   │
  │                                                                     │
  │  OpenCode tools ──► X-API-Key ──► REST routes ──┐                  │
  │                                                  │  GitRepoDO       │
  │  git clone/push ──► Basic Auth ──► Git Smart     │  (Durable       │
  │                                    HTTP routes   │   Object)        │
  │                                                  │  ┌────────┐     │
  │                                                  │  │ SQLite │     │
  │                                                  │  └────────┘     │
  └──────────────────────────────────────────────────┴─────────────────┘
```

## Project Structure

```
agent-space/
├── .opencode/
│   └── tools/               # OpenCode custom tools (workspace interaction)
│       ├── _space.ts         # Shared fetch helper (not registered as tool)
│       ├── read.ts           # Overrides built-in read
│       ├── write.ts          # Overrides built-in write
│       ├── edit.ts           # Overrides built-in edit
│       ├── glob.ts           # Overrides built-in glob
│       ├── grep.ts           # Overrides built-in grep
│       ├── list.ts           # List files
│       ├── patch.ts          # Apply unified diffs
│       ├── git_commit.ts     # Commit files
│       ├── git_log.ts        # View commit history
│       └── git_status.ts     # Working tree status
├── src/
│   ├── index.ts              # Worker entry + auth + routing
│   ├── do.ts                 # Durable Object (GitRepoDO)
│   ├── dofs.ts               # Virtual FS shim over SQLite
│   ├── mcp/
│   │   ├── server.ts         # Management MCP (create/list/delete spaces only)
│   │   └── spaces.ts         # Cloudflare API helpers for space CRUD
│   ├── handlers/
│   │   ├── fs-engine.ts      # File read/write/delete/list
│   │   ├── git-engine.ts     # Git commit/log/push/checkout
│   │   └── git-smart-http.ts # Git Smart HTTP protocol
│   ├── routes/
│   │   ├── api.ts            # REST API routes
│   │   └── git-http.ts       # Git HTTP routes
│   └── helpers/
│       ├── types.ts          # Shared types (Env, HandlerContext)
│       └── git-pack.ts       # Git pack/protocol helpers
├── test/
│   ├── unit/                 # Unit tests
│   └── integration/          # Integration tests
├── wrangler.toml
├── vitest.config.ts
└── package.json
```

## License

[MIT](LICENSE)
