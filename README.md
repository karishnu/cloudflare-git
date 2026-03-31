# AgentSpace

MCP-powered filesystem & git spaces on Cloudflare Workers + Durable Objects. Gives AI agents (like [OpenCode](https://opencode.ai), Claude, Cursor, etc.) a remote workspace with **file read/write/edit/grep/glob/patch**, **git commit/log**, and the ability to **spin up new spaces** — each with its own URL.

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

Your space is live at `https://agent-space.YOUR_SUBDOMAIN.workers.dev`.

### 2. Connect from OpenCode

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

---

## MCP Tools

All tools are available at the `/mcp` endpoint via the [Model Context Protocol](https://modelcontextprotocol.io). Auth uses `Authorization: Bearer <API_KEY>`.

### Filesystem

| Tool | Description |
|------|-------------|
| `read` | Read file contents (optional `offset`/`limit` for line ranges) |
| `write` | Create or overwrite a file |
| `edit` | Find-and-replace an exact string in a file |
| `list` | List files, optionally filtered by prefix |
| `grep` | Regex search across files (optional glob `include` filter) |
| `glob` | Find files by glob pattern (e.g. `**/*.ts`) |
| `patch` | Apply a unified diff to one or more files |

### Git

| Tool | Description |
|------|-------------|
| `git_commit` | Commit all working tree files |
| `git_log` | View commit history |
| `git_status` | List files in the working tree with timestamps |

### Space Management

| Tool | Description |
|------|-------------|
| `create_space` | Deploy a new space as a separate Worker (own URL, filesystem, git) |
| `list_spaces` | List all deployed agent-spaces |
| `delete_space` | Delete a space and all its data |

---

## REST API

The HTTP API is still available for direct programmatic access. Auth uses `X-API-Key` header.

```bash
# Write a file
curl -X PUT https://agent-space.YOUR_SUBDOMAIN.workers.dev/src/app.ts \
  -H "X-API-Key: YOUR_KEY" \
  -d 'console.log("hello")'

# Read a file
curl https://agent-space.YOUR_SUBDOMAIN.workers.dev/src/app.ts \
  -H "X-API-Key: YOUR_KEY"

# List files
curl "https://agent-space.YOUR_SUBDOMAIN.workers.dev/?list" \
  -H "X-API-Key: YOUR_KEY"

# Commit
curl -X POST "https://agent-space.YOUR_SUBDOMAIN.workers.dev/?cmd=commit" \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "initial commit"}'

# Log
curl "https://agent-space.YOUR_SUBDOMAIN.workers.dev/?cmd=log" \
  -H "X-API-Key: YOUR_KEY"
```

---

## Git Remote (Smart HTTP)

Standard `git clone` / `git push` via the [Git Smart HTTP protocol](https://git-scm.com/docs/http-protocol). Auth uses HTTP Basic (any username, `API_KEY` as password).

```bash
# Clone
git clone https://git:YOUR_API_KEY@agent-space.YOUR_SUBDOMAIN.workers.dev/repo.git

# Push
cd repo && echo "hello" > file.txt && git add . && git commit -m "update"
git push origin main
```

Changes made via MCP/REST are visible when you `git pull`, and pushes are reflected in MCP/REST immediately.

---

## Architecture

```
                  ┌────────────────────────────────────────────┐
                  │              Worker (auth gateway)          │
                  │                                            │
  MCP client ─────┤  Bearer auth ──► /mcp (MCP tools)          │
  (OpenCode etc)  │                                            │
                  │                              ┌─────────────┤
  SDK / curl ─────┤  X-API-Key ──► REST routes   │  GitRepoDO  │
                  │                              │  (Durable   │
  git clone/push ─┤  Basic Auth ──► Git Smart    │   Object)   │
                  │                 HTTP routes   │             │
                  │                              │  ┌────────┐ │
                  │                              │  │ SQLite │ │
                  │                              │  └────────┘ │
                  └──────────────────────────────┴─────────────┘
```

## Project Structure

```
agent-space/
├── src/
│   ├── index.ts              # Worker entry + auth + MCP/REST/Git routing
│   ├── do.ts                 # Durable Object (GitRepoDO)
│   ├── dofs.ts               # Virtual FS shim over SQLite
│   ├── mcp/
│   │   ├── server.ts         # MCP server factory + tool definitions
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
