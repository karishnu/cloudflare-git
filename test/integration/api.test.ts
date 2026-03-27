import { env, SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const API_KEY = "test-api-key";
const headers = { "X-API-Key": API_KEY };

// ── Auth ──

describe("API auth", () => {
  it("rejects requests without X-API-Key", async () => {
    const res = await SELF.fetch("https://fake.host/test.txt");
    expect(res.status).toBe(401);
    const body = await res.json() as any;
    expect(body.error).toBe("Unauthorized");
  });

  it("rejects requests with wrong X-API-Key", async () => {
    const res = await SELF.fetch("https://fake.host/test.txt", {
      headers: { "X-API-Key": "wrong-key" },
    });
    expect(res.status).toBe(401);
  });

  it("accepts requests with valid X-API-Key", async () => {
    const res = await SELF.fetch("https://fake.host/?list", { headers });
    expect(res.status).toBe(200);
  });
});

// ── File CRUD ──

describe("File operations", () => {
  it("PUT creates a file and returns 201", async () => {
    const res = await SELF.fetch("https://fake.host/hello.txt", {
      method: "PUT",
      headers,
      body: "Hello, world!",
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.path).toBe("hello.txt");
    expect(body.mtime).toBeTypeOf("number");
  });

  it("GET retrieves the file content", async () => {
    // Ensure file exists
    await SELF.fetch("https://fake.host/read-test.txt", {
      method: "PUT",
      headers,
      body: "read me",
    });

    const res = await SELF.fetch("https://fake.host/read-test.txt", { headers });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    const text = await res.text();
    expect(text).toBe("read me");
  });

  it("GET returns 404 for missing file", async () => {
    const res = await SELF.fetch("https://fake.host/nonexistent.txt", { headers });
    expect(res.status).toBe(404);
  });

  it("DELETE removes a file", async () => {
    await SELF.fetch("https://fake.host/to-delete.txt", {
      method: "PUT",
      headers,
      body: "delete me",
    });

    const delRes = await SELF.fetch("https://fake.host/to-delete.txt", {
      method: "DELETE",
      headers,
    });
    expect(delRes.status).toBe(200);
    const body = await delRes.json() as any;
    expect(body.ok).toBe(true);

    // Verify it's gone
    const getRes = await SELF.fetch("https://fake.host/to-delete.txt", { headers });
    expect(getRes.status).toBe(404);
  });

  it("DELETE returns 404 for missing file", async () => {
    const res = await SELF.fetch("https://fake.host/no-such-file.txt", {
      method: "DELETE",
      headers,
    });
    expect(res.status).toBe(404);
  });
});

// ── List ──

describe("List files", () => {
  it("lists all files", async () => {
    // Create a couple of files
    await SELF.fetch("https://fake.host/list-a.txt", {
      method: "PUT",
      headers,
      body: "a",
    });
    await SELF.fetch("https://fake.host/list-b.txt", {
      method: "PUT",
      headers,
      body: "b",
    });

    const res = await SELF.fetch("https://fake.host/?list", { headers });
    expect(res.status).toBe(200);
    const files = await res.json() as any[];
    const names = files.map((f) => f.path);
    expect(names).toContain("list-a.txt");
    expect(names).toContain("list-b.txt");
  });

  it("lists files with prefix", async () => {
    await SELF.fetch("https://fake.host/sub/file1.txt", {
      method: "PUT",
      headers,
      body: "1",
    });
    await SELF.fetch("https://fake.host/sub/file2.txt", {
      method: "PUT",
      headers,
      body: "2",
    });
    await SELF.fetch("https://fake.host/other.txt", {
      method: "PUT",
      headers,
      body: "x",
    });

    const res = await SELF.fetch("https://fake.host/sub?list", { headers });
    expect(res.status).toBe(200);
    const files = await res.json() as any[];
    expect(files.every((f: any) => f.path.startsWith("sub/"))).toBe(true);
    expect(files.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Git commands ──

describe("Git commands", () => {
  it("commit returns a SHA", async () => {
    // Write a file first
    await SELF.fetch("https://fake.host/commit-test.txt", {
      method: "PUT",
      headers,
      body: "commit content",
    });

    const res = await SELF.fetch("https://fake.host/?cmd=commit", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "test commit",
        author: { name: "Test", email: "test@test.com" },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.sha).toBeTypeOf("string");
    expect(body.sha.length).toBe(40);
  });

  it("log returns commits after a commit", async () => {
    // Ensure at least one commit exists
    await SELF.fetch("https://fake.host/log-test.txt", {
      method: "PUT",
      headers,
      body: "log content",
    });
    await SELF.fetch("https://fake.host/?cmd=commit", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ message: "log test commit" }),
    });

    const res = await SELF.fetch("https://fake.host/?cmd=log", { headers });
    expect(res.status).toBe(200);
    const commits = await res.json() as any[];
    expect(commits.length).toBeGreaterThan(0);
    expect(commits[0].oid).toBeTypeOf("string");
    expect(commits[0].message).toContain("log test commit");
  });

  it("unknown command returns 400", async () => {
    const res = await SELF.fetch("https://fake.host/?cmd=bogus", { headers });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain("Unknown command");
  });
});
