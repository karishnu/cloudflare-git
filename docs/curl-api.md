# HTTP API Reference (curl)

All API endpoints require the `X-API-Key` header for authentication.

```bash
BASE="https://YOUR_WORKER.workers.dev"
KEY="YOUR_API_KEY"
```

## File Operations

### Write a file

```bash
curl -X PUT -H "X-API-Key: $KEY" -d 'Hello World' "$BASE/hello.txt"
```

Response:

```json
{ "ok": true, "path": "hello.txt", "mtime": 1711234567890 }
```

### Write a file in a subdirectory

```bash
curl -X PUT -H "X-API-Key: $KEY" -d 'console.log("hi")' "$BASE/src/app.ts"
```

Directories are created implicitly — no `mkdir` needed.

### Read a file

```bash
curl -H "X-API-Key: $KEY" "$BASE/hello.txt"
```

Returns the raw file content. Returns `404` if the file doesn't exist.

### Delete a file

```bash
curl -X DELETE -H "X-API-Key: $KEY" "$BASE/hello.txt"
```

### List files

```bash
# List all files
curl -H "X-API-Key: $KEY" "$BASE/?list"

# List files in a subdirectory
curl -H "X-API-Key: $KEY" "$BASE/src/?list"
```

Response:

```json
[
  { "path": "src/app.ts", "name": "app.ts", "mtime": 1711234567890 }
]
```

## Git Operations

### Commit

Commits all files currently in the working tree:

```bash
curl -X POST -H "X-API-Key: $KEY" \
  -d '{"message":"initial commit","author":{"name":"Dev","email":"dev@example.com"}}' \
  "$BASE/?cmd=commit"
```

Response:

```json
{ "sha": "abc123..." }
```

### View log

```bash
curl -H "X-API-Key: $KEY" "$BASE/?cmd=log"
```

Response:

```json
[
  {
    "oid": "abc123...",
    "message": "initial commit\n",
    "author": { "name": "Dev", "email": "dev@example.com", "timestamp": 1711234567 },
    "parent": []
  }
]
```

### Checkout a branch

```bash
curl -X POST -H "X-API-Key: $KEY" \
  -d '{"ref":"main"}' \
  "$BASE/?cmd=checkout"
```

### Push to an external remote

Push the repository to an external Git host (e.g. GitHub):

```bash
curl -X POST -H "X-API-Key: $KEY" \
  -d '{"url":"https://github.com/you/repo.git","token":"ghp_xxxx"}' \
  "$BASE/?cmd=push"
```

## Authentication

All requests must include the `X-API-Key` header:

```bash
curl -H "X-API-Key: YOUR_API_KEY" ...
```

Requests without a valid key receive a `401` response:

```json
{ "error": "Unauthorized" }
```
