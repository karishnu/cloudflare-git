import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const API_KEY = "test-api-key";

function basicAuthHeader(password: string): string {
  return "Basic " + btoa(`git:${password}`);
}

// ── Auth ──

describe("Git Smart HTTP auth", () => {
  it("rejects requests without auth", async () => {
    const res = await SELF.fetch(
      "https://fake.host/repo.git/info/refs?service=git-upload-pack"
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe('Basic realm="Git"');
  });

  it("rejects requests with wrong password", async () => {
    const res = await SELF.fetch(
      "https://fake.host/repo.git/info/refs?service=git-upload-pack",
      { headers: { Authorization: basicAuthHeader("wrong-key") } }
    );
    expect(res.status).toBe(401);
  });

  it("accepts requests with valid Basic auth", async () => {
    const res = await SELF.fetch(
      "https://fake.host/repo.git/info/refs?service=git-upload-pack",
      { headers: { Authorization: basicAuthHeader(API_KEY) } }
    );
    expect(res.status).toBe(200);
  });
});

// ── info/refs ──

describe("Git info/refs", () => {
  const authHeaders = { Authorization: basicAuthHeader(API_KEY) };

  it("returns upload-pack advertisement", async () => {
    const res = await SELF.fetch(
      "https://fake.host/repo.git/info/refs?service=git-upload-pack",
      { headers: authHeaders }
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "application/x-git-upload-pack-advertisement"
    );
    const text = await res.text();
    // Should contain service announcement
    expect(text).toContain("# service=git-upload-pack");
    // Should contain capabilities
    expect(text).toContain("report-status");
  });

  it("returns receive-pack advertisement", async () => {
    const res = await SELF.fetch(
      "https://fake.host/repo.git/info/refs?service=git-receive-pack",
      { headers: authHeaders }
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "application/x-git-receive-pack-advertisement"
    );
    const text = await res.text();
    expect(text).toContain("# service=git-receive-pack");
  });

  it("rejects unsupported service", async () => {
    const res = await SELF.fetch(
      "https://fake.host/repo.git/info/refs?service=git-something-else",
      { headers: authHeaders }
    );
    expect(res.status).toBe(403);
  });
});

// ── HEAD ──

describe("Git HEAD", () => {
  it("returns HEAD ref", async () => {
    const res = await SELF.fetch("https://fake.host/repo.git/HEAD", {
      headers: { Authorization: basicAuthHeader(API_KEY) },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/plain");
    const text = await res.text();
    expect(text).toContain("ref: refs/heads/main");
  });
});
