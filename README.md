# CloudflareGit

A Cloudflare Worker + Durable Object that provides a **full Git repository over HTTP**. Use it two ways: as a **programmatic dev environment** (read/write files, commit, push via API), or as a standard **Git remote** that works with `git clone` and `git push`.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/karishnu/cloudflare-git)

## Quick Start

### 1. Deploy

Click the button above, or deploy manually:

```bash
git clone https://github.com/karishnu/cloudflare-git.git
cd cloudflare-git
npm install
```

Set your API key as a secret:

```bash
npx wrangler secret put API_KEY
# Enter a strong random string when prompted
```

Deploy:

```bash
npm run deploy
```

Your worker is now live at `https://YOUR_WORKER.workers.dev`.

---

## Usage

CloudflareGit supports two usage flows that share the same underlying storage. Changes made via the API are visible when you `git clone`, and changes pushed via `git push` are reflected in the API.

### Flow 1: Programmatic Dev Environment (HTTP API)

Use the HTTP API or the included TypeScript SDK to read/write files and run Git commands. This is ideal for CI pipelines, bots, code generation tools, or any programmatic workflow.

Authentication uses the `X-API-Key` header.

#### Install the SDK

```bash
cd sdk && npm install && npm run build
```

Then reference it from your project:

```bash
npm install ./path-to/cloudflare-git/sdk
```

#### File Operations

```ts
import { CloudflareGitClient } from "cloudflare-git-sdk";

const client = new CloudflareGitClient({
  url: "https://YOUR_WORKER.workers.dev",
  apiKey: "YOUR_API_KEY",
});

// Write files
await client.fs.write("src/app.ts", 'console.log("hi")');
await client.fs.write("README.md", "# My Project");

// Read a file
const content = await client.fs.read("src/app.ts");

// List files in a directory
const files = await client.fs.list("src");
// [{ path: "src/app.ts", name: "app.ts", mtime: 1711234567890 }]

// Delete a file
await client.fs.delete("README.md");
```

#### Git Operations

```ts
// Commit all working tree files
const { sha } = await client.git.commit("initial commit", {
  name: "Dev",
  email: "dev@example.com",
});

// View commit history
const log = await client.git.log();
console.log(log[0].oid, log[0].message);

// Push to an external remote (e.g. GitHub)
await client.git.push({
  url: "https://github.com/you/repo.git",
  token: "ghp_xxxx",
});

// Checkout a branch
await client.git.checkout("main");
```

> See also: **[curl API Reference](docs/curl-api.md)** for the full HTTP API with all endpoints and response formats.
>
> See also: **[SDK Error Handling](docs/error-handling.md)** for error codes, patterns, and retry strategies.

---

### Flow 2: Git Remote (Git Smart HTTP)

CloudflareGit implements the [Git Smart HTTP protocol](https://git-scm.com/docs/http-protocol), so you can use it as a standard Git remote with any Git client. This is ideal for developers who want to clone, edit locally, and push back.

The remote URL is `https://YOUR_WORKER.workers.dev/repo.git`. Authentication uses HTTP Basic auth with any username and your `API_KEY` as the password.

#### Clone

```bash
git clone https://git:YOUR_API_KEY@YOUR_WORKER.workers.dev/repo.git
```

This clones the full repository — all commits, branches, and files — to your local machine.

#### Push

Make changes locally and push them back:

```bash
cd repo
echo "new content" > file.txt
git add file.txt
git commit -m "update file"
git push origin main
```

Pushed changes are immediately reflected in the API. Files are extracted from the pushed commit into the working tree, so `client.fs.read("file.txt")` returns the updated content.

#### Fetch / Pull

Pull the latest changes (e.g. changes made via the HTTP API):

```bash
git pull origin main
```

#### Configure as a remote on an existing repo

```bash
git remote add cloud https://git:YOUR_API_KEY@YOUR_WORKER.workers.dev/repo.git
git push cloud main
```

> See also: **[Git Credential Setup](docs/git-credentials.md)** for credential helpers, CI configuration, macOS Keychain, `.netrc`, and more.

---

## How the Two Flows Interact

Both flows operate on the **same underlying Git repository**. The storage is shared:

| Action | Effect |
|---|---|
| Write files via API, then `git clone` | Cloned repo contains the API-written files (after committing) |
| `git push` new commits | Files appear in the API's working tree immediately |
| Commit via API, then `git pull` | Local repo receives the API-created commits |

This makes it possible to, for example, use the HTTP API in a CI pipeline to generate files, commit them, and then have developers `git pull` those changes locally.

## Features

- **File CRUD** — Read, write, list, and delete files via HTTP
- **Git operations** — Commit, log, checkout, and push via API
- **Git Smart HTTP** — Standard `git clone` / `git push` support
- **Persistent storage** — All data in Durable Object SQLite (no external database)
- **Single endpoint** — One Worker URL for both the API and Git remote
- **HTTP Basic auth** — Git clients authenticate with `API_KEY`
- **TypeScript SDK** — Included client library with `.fs` and `.git` interfaces
- **Zero external dependencies at runtime** — Just `isomorphic-git`

## Architecture

```
                       ┌──────────────────────────────────────┐
                       │           Worker (auth gateway)      │
                       │                                      │
  SDK / curl ──────────┤  X-API-Key ──► HTTP API routes       │
  (Flow 1)             │                                      │
                       │                         ┌────────────┤
                       │                         │ GitRepoDO  │
  git clone/push ──────┤  Basic Auth ──► Git     │ (Durable   │
  (Flow 2)             │                Smart    │  Object)   │
                       │                HTTP     │            │
                       │                routes   │ ┌────────┐ │
                       │                         │ │ SQLite │ │
                       │               ┌─────────┤ │        │ │
                       │               │FS Shim  │ │ tables:│ │
                       │               │(virtual │ │ working│ │
                       │               │ git fs) │ │ _tree  │ │
                       │               │         │ │ git_   │ │
                       │               │         │ │ objects│ │
                       │               │         │ │ refs   │ │
                       │               └─────────┤ └────────┘ │
                       │                         └────────────┤
                       └──────────────────────────────────────┘
```

## Project Structure

```
cloudflare-git/
├── src/index.ts       # Worker + Durable Object + FS shim + Git Smart HTTP
├── wrangler.toml      # Cloudflare Worker configuration
├── package.json
├── tsconfig.json
└── sdk/               # TypeScript SDK
    ├── src/
    │   ├── index.ts   # CloudflareGitClient entry point
    │   ├── fs.ts      # FsClient class
    │   ├── git.ts     # GitClient class
    │   └── types.ts   # Shared types
    ├── package.json
    └── tsconfig.json
```

## License

[MIT](LICENSE)
