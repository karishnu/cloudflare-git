# CloudflareGit

A Cloudflare Worker + Durable Object that exposes a **unified Git & File API**. Store files, commit changes, view history, and push to remote repositories — all through a single HTTP endpoint.

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

### 2. Install the SDK

A zero-dependency TypeScript SDK is included in the `sdk/` directory.

```bash
cd sdk && npm install && npm run build
```

Then reference it from your project (or publish to npm):

```bash
npm install ./path-to/cloudflare-git/sdk
```

### 3. Use the SDK

```ts
import { CloudflareGitClient } from "cloudflare-git-sdk";

const client = new CloudflareGitClient({
  url: "https://YOUR_WORKER.workers.dev",
  apiKey: "YOUR_API_KEY",
});

// ── Write files ──
await client.fs.write("src/app.ts", 'console.log("hi")');
await client.fs.write("README.md", "# My Project");

// ── Read a file ──
const content = await client.fs.read("src/app.ts");

// ── List files in a directory ──
const files = await client.fs.list("src");
// [{ path: "src/app.ts", name: "app.ts", mtime: 1711234567890 }]

// ── Delete a file ──
await client.fs.delete("README.md");

// ── Commit all working tree files ──
const { sha } = await client.git.commit("initial commit", {
  name: "Dev",
  email: "dev@example.com",
});

// ── View commit history ──
const log = await client.git.log();
console.log(log[0].oid, log[0].message);

// ── Push to a remote ──
await client.git.push({
  url: "https://github.com/you/repo.git",
  token: "ghp_xxxx",
});

// ── Checkout a branch ──
await client.git.checkout("main");
```

### Error Handling

All SDK methods throw `CloudflareGitError` on failure:

```ts
import { CloudflareGitError } from "cloudflare-git-sdk";

try {
  await client.fs.read("nonexistent.txt");
} catch (e) {
  if (e instanceof CloudflareGitError) {
    console.error(e.status); // 404
    console.error(e.message); // "Not found"
  }
}
```

## Features

- **File CRUD** — Read, write, list, and delete files via simple HTTP methods
- **Git operations** — Commit, log, checkout, and push using [isomorphic-git](https://isomorphic-git.org/) under the hood
- **Persistent storage** — All data persisted in Durable Object storage (no external database needed)
- **Single endpoint** — One Worker URL handles everything
- **TypeScript SDK** — Included client library with `.fs` and `.git` interfaces
- **Zero external dependencies at runtime** — Just `isomorphic-git`

## Architecture

```
┌──────────────┐         ┌──────────────────┐         ┌─────────────────────────┐
│   Client     │  HTTP   │   Worker         │  stub   │   GitRepoDO             │
│  (SDK/curl)  │ ──────► │  (auth gateway)  │ ──────► │  (Durable Object)       │
│              │         │                  │         │                         │
│              │         │  X-API-Key check │         │  ┌─────────────────┐    │
│              │         │                  │         │  │  Storage        │    │
│              │         │                  │         │  │  ├ working_tree │    │
│              │         │                  │         │  │  ├ git_objects  │    │
│              │         │                  │         │  │  ├ refs         │    │
│              │         │                  │         │  │  └ git_internal │    │
│              │         │                  │         │  └─────────────────┘    │
└──────────────┘         └──────────────────┘         └─────────────────────────┘
```

## Project Structure

```
CloudflareGit/
├── src/index.ts       # Worker + Durable Object + FS shim
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

## How It Works

The system uses a **Cloudflare Durable Object** as a single Git repository. [isomorphic-git](https://isomorphic-git.org/) operates on a custom filesystem shim backed by the Durable Object's built-in storage. All Git operations (commit, checkout, push) work against the same data as the File API.

## License

[MIT](LICENSE)
