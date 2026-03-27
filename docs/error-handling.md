# SDK Error Handling

All SDK methods throw `CloudflareGitError` when a request fails. This error class includes the HTTP status code and the error message returned by the server.

## CloudflareGitError

```ts
import { CloudflareGitError } from "cloudflare-git-sdk";
```

### Properties

| Property | Type | Description |
|---|---|---|
| `status` | `number` | HTTP status code (e.g. `404`, `401`, `500`) |
| `message` | `string` | Error message from the server |

## Basic Usage

```ts
import { CloudflareGitClient, CloudflareGitError } from "cloudflare-git-sdk";

const client = new CloudflareGitClient({
  url: "https://YOUR_WORKER.workers.dev",
  apiKey: "YOUR_API_KEY",
});

try {
  await client.fs.read("nonexistent.txt");
} catch (e) {
  if (e instanceof CloudflareGitError) {
    console.error(e.status);  // 404
    console.error(e.message); // "Not found"
  }
}
```

## Common Error Codes

| Status | Meaning | Typical Cause |
|---|---|---|
| `401` | Unauthorized | Missing or invalid `API_KEY` |
| `404` | Not found | File or ref doesn't exist |
| `400` | Bad request | Malformed JSON body or missing required fields |
| `500` | Internal server error | Unexpected failure in the Durable Object |

## Error Handling Patterns

### Checking if a file exists

```ts
async function fileExists(client: CloudflareGitClient, path: string): Promise<boolean> {
  try {
    await client.fs.read(path);
    return true;
  } catch (e) {
    if (e instanceof CloudflareGitError && e.status === 404) {
      return false;
    }
    throw e; // Re-throw unexpected errors
  }
}
```

### Retrying on transient failures

```ts
async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof CloudflareGitError && e.status >= 500 && i < retries - 1) {
        await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
        continue;
      }
      throw e;
    }
  }
  throw new Error("Unreachable");
}

// Usage
const content = await withRetry(() => client.fs.read("important.txt"));
```
