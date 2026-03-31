import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../helpers/types.js";
import { deploySpace, listSpaces, deleteSpace } from "./spaces.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function getStub(env: Env): DurableObjectStub {
  const id = env.GIT_REPO.idFromName("repo");
  return env.GIT_REPO.get(id);
}

async function doFetch(
  env: Env,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const stub = getStub(env);
  return stub.fetch(new Request(`https://internal${path}`, init));
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function globToRegex(pattern: string): RegExp {
  let re = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i++; // skip second *
        if (pattern[i + 1] === "/") i++; // skip trailing /
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (c === ".") {
      re += "\\.";
    } else {
      re += c;
    }
  }
  re += "$";
  return new RegExp(re);
}

// ─── Server Factory ─────────────────────────────────────────────────────────

export function createServer(env: Env): McpServer {
  const server = new McpServer({
    name: "AgentSpace",
    version: "1.0.0",
  });

  // ── read ────────────────────────────────────────────────────────────────

  server.tool(
    "read",
    "Read file contents. Supports optional line range (1-indexed offset and limit).",
    {
      path: z.string().describe("File path to read"),
      offset: z.number().int().min(1).optional().describe("1-indexed start line"),
      limit: z.number().int().min(1).optional().describe("Number of lines to return"),
    },
    async ({ path, offset, limit }) => {
      const res = await doFetch(env, `/${path}`);
      if (!res.ok) {
        const err = await res.text();
        return textResult(`Error: ${err}`);
      }
      let text = await res.text();

      if (offset !== undefined || limit !== undefined) {
        const lines = text.split("\n");
        const start = (offset ?? 1) - 1;
        const end = limit !== undefined ? start + limit : lines.length;
        const sliced = lines.slice(start, end);
        // Format with line numbers
        text = sliced
          .map((line, i) => `${start + i + 1}\t${line}`)
          .join("\n");
      }

      return textResult(text);
    }
  );

  // ── write ───────────────────────────────────────────────────────────────

  server.tool(
    "write",
    "Create or overwrite a file with the given content.",
    {
      path: z.string().describe("File path to write"),
      content: z.string().describe("File content"),
    },
    async ({ path, content }) => {
      const res = await doFetch(env, `/${path}`, {
        method: "PUT",
        body: content,
      });
      const data = await res.json();
      return textResult(JSON.stringify(data));
    }
  );

  // ── edit ────────────────────────────────────────────────────────────────

  server.tool(
    "edit",
    "Find and replace an exact string in a file. The old_string must be unique in the file.",
    {
      path: z.string().describe("File path to edit"),
      old_string: z.string().describe("Exact text to find (must be unique)"),
      new_string: z.string().describe("Replacement text"),
    },
    async ({ path, old_string, new_string }) => {
      // Read current content
      const readRes = await doFetch(env, `/${path}`);
      if (!readRes.ok) {
        return textResult(`Error: file not found: ${path}`);
      }
      const text = await readRes.text();

      const count = text.split(old_string).length - 1;
      if (count === 0) {
        return textResult(`Error: old_string not found in ${path}`);
      }
      if (count > 1) {
        return textResult(`Error: old_string found ${count} times in ${path} (must be unique)`);
      }

      const newText = text.replace(old_string, new_string);
      const writeRes = await doFetch(env, `/${path}`, {
        method: "PUT",
        body: newText,
      });
      const data = await writeRes.json();
      return textResult(JSON.stringify(data));
    }
  );

  // ── list ────────────────────────────────────────────────────────────────

  server.tool(
    "list",
    "List files and directories, optionally filtered by a path prefix.",
    {
      prefix: z.string().optional().describe("Path prefix to filter by"),
    },
    async ({ prefix }) => {
      const queryPath = prefix ? `/${prefix}?list` : "/?list";
      const res = await doFetch(env, queryPath);
      const data = await res.json();
      return textResult(JSON.stringify(data, null, 2));
    }
  );

  // ── grep ────────────────────────────────────────────────────────────────

  server.tool(
    "grep",
    "Search file contents using a regular expression. Returns matching lines with file paths and line numbers.",
    {
      pattern: z.string().describe("Regex pattern to search for"),
      include: z.string().optional().describe("Glob pattern to filter files (e.g. '*.ts')"),
    },
    async ({ pattern, include }) => {
      // Get all files
      const listRes = await doFetch(env, "/?list");
      const files = (await listRes.json()) as { path: string }[];

      const includeRe = include ? globToRegex(include) : null;
      const searchRe = new RegExp(pattern, "gi");

      const results: string[] = [];
      for (const file of files) {
        if (includeRe && !includeRe.test(file.path)) continue;

        const readRes = await doFetch(env, `/${file.path}`);
        if (!readRes.ok) continue;

        const text = await readRes.text();
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (searchRe.test(lines[i])) {
            results.push(`${file.path}:${i + 1}:${lines[i]}`);
          }
          searchRe.lastIndex = 0; // reset global regex
        }
      }

      if (results.length === 0) {
        return textResult("No matches found.");
      }
      return textResult(results.join("\n"));
    }
  );

  // ── glob ────────────────────────────────────────────────────────────────

  server.tool(
    "glob",
    "Find files matching a glob pattern. Returns matching file paths sorted by modification time.",
    {
      pattern: z.string().describe("Glob pattern (e.g. '**/*.ts', 'src/*.js')"),
    },
    async ({ pattern }) => {
      const listRes = await doFetch(env, "/?list");
      const files = (await listRes.json()) as { path: string; mtime: number }[];

      const re = globToRegex(pattern);
      const matched = files
        .filter((f) => re.test(f.path))
        .sort((a, b) => b.mtime - a.mtime);

      if (matched.length === 0) {
        return textResult("No files matched.");
      }
      return textResult(matched.map((f) => f.path).join("\n"));
    }
  );

  // ── patch ───────────────────────────────────────────────────────────────

  server.tool(
    "patch",
    "Apply a unified diff to one or more files.",
    {
      diff: z.string().describe("Unified diff content"),
    },
    async ({ diff }) => {
      // Parse unified diff and apply hunks
      const filePatches = parseUnifiedDiff(diff);
      const results: string[] = [];

      for (const fp of filePatches) {
        // Read current file (may not exist for new files)
        let lines: string[] = [];
        const readRes = await doFetch(env, `/${fp.path}`);
        if (readRes.ok) {
          const text = await readRes.text();
          lines = text.split("\n");
        }

        // Apply hunks in reverse order to preserve line numbers
        const sortedHunks = [...fp.hunks].sort((a, b) => b.oldStart - a.oldStart);
        for (const hunk of sortedHunks) {
          const newLines: string[] = [];
          for (const hl of hunk.lines) {
            if (hl.type === "add" || hl.type === "context") {
              newLines.push(hl.content);
            }
          }
          const removeCount = hunk.lines.filter(
            (l) => l.type === "remove" || l.type === "context"
          ).length;
          lines.splice(hunk.oldStart - 1, removeCount, ...newLines);
        }

        // Write back
        const writeRes = await doFetch(env, `/${fp.path}`, {
          method: "PUT",
          body: lines.join("\n"),
        });
        if (writeRes.ok) {
          results.push(`Patched: ${fp.path}`);
        } else {
          results.push(`Failed: ${fp.path}`);
        }
      }

      return textResult(results.join("\n"));
    }
  );

  // ── git_commit ──────────────────────────────────────────────────────────

  server.tool(
    "git_commit",
    "Commit all working tree files.",
    {
      message: z.string().describe("Commit message"),
      author_name: z.string().optional().describe("Author name"),
      author_email: z.string().optional().describe("Author email"),
    },
    async ({ message, author_name, author_email }) => {
      const body: any = { message };
      if (author_name || author_email) {
        body.author = {
          name: author_name ?? "AgentSpace",
          email: author_email ?? "agent@agent-space.workers.dev",
        };
      }
      const res = await doFetch(env, "/?cmd=commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      return textResult(JSON.stringify(data));
    }
  );

  // ── git_log ─────────────────────────────────────────────────────────────

  server.tool(
    "git_log",
    "View commit history.",
    {
      depth: z.number().int().min(1).optional().describe("Max number of commits to return"),
    },
    async ({ depth }) => {
      const res = await doFetch(env, "/?cmd=log");
      let data = (await res.json()) as any[];
      if (depth !== undefined) {
        data = data.slice(0, depth);
      }
      return textResult(JSON.stringify(data, null, 2));
    }
  );

  // ── git_status ──────────────────────────────────────────────────────────

  server.tool(
    "git_status",
    "List files in the working tree with their modification times.",
    {},
    async () => {
      const res = await doFetch(env, "/?list");
      const files = (await res.json()) as { path: string; mtime: number }[];
      if (files.length === 0) {
        return textResult("Working tree is empty.");
      }
      const out = files.map((f) => {
        const date = new Date(f.mtime).toISOString();
        return `${date}  ${f.path}`;
      });
      return textResult(out.join("\n"));
    }
  );

  // ── create_space ────────────────────────────────────────────────────────

  server.tool(
    "create_space",
    "Deploy a new agent-space as a separate Cloudflare Worker with its own URL, filesystem, and git repo.",
    {
      name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).describe("Space name (lowercase alphanumeric + hyphens)"),
      api_key: z.string().optional().describe("API key for the new space. Auto-generated if omitted."),
    },
    async ({ name, api_key }) => {
      const key = api_key ?? crypto.randomUUID();
      try {
        const result = await deploySpace(env, name, key);
        return textResult(JSON.stringify({
          name,
          url: result.url,
          api_key: key,
          mcp_endpoint: `${result.url}/mcp`,
        }, null, 2));
      } catch (e: any) {
        return textResult(`Error: ${e.message}`);
      }
    }
  );

  // ── list_spaces ─────────────────────────────────────────────────────────

  server.tool(
    "list_spaces",
    "List all deployed agent-spaces.",
    {},
    async () => {
      try {
        const spaces = await listSpaces(env);
        if (spaces.length === 0) {
          return textResult("No spaces found.");
        }
        return textResult(JSON.stringify(spaces, null, 2));
      } catch (e: any) {
        return textResult(`Error: ${e.message}`);
      }
    }
  );

  // ── delete_space ────────────────────────────────────────────────────────

  server.tool(
    "delete_space",
    "Delete a deployed agent-space and all its data.",
    {
      name: z.string().describe("Name of the space to delete"),
    },
    async ({ name }) => {
      try {
        await deleteSpace(env, name);
        return textResult(`Space "${name}" deleted.`);
      } catch (e: any) {
        return textResult(`Error: ${e.message}`);
      }
    }
  );

  return server;
}

// ─── Unified Diff Parser ────────────────────────────────────────────────────

interface HunkLine {
  type: "add" | "remove" | "context";
  content: string;
}

interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: HunkLine[];
}

interface FilePatch {
  path: string;
  hunks: Hunk[];
}

function parseUnifiedDiff(diff: string): FilePatch[] {
  const patches: FilePatch[] = [];
  const lines = diff.split("\n");
  let i = 0;

  while (i < lines.length) {
    // Find --- line
    if (lines[i].startsWith("--- ")) {
      const oldPath = lines[i].slice(4).replace(/^[ab]\//, "");
      i++;
      if (i < lines.length && lines[i].startsWith("+++ ")) {
        const newPath = lines[i].slice(4).replace(/^[ab]\//, "");
        i++;
        const path = newPath === "/dev/null" ? oldPath : newPath;
        const hunks: Hunk[] = [];

        while (i < lines.length && lines[i].startsWith("@@ ")) {
          const match = lines[i].match(
            /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/
          );
          if (!match) { i++; continue; }
          const hunk: Hunk = {
            oldStart: parseInt(match[1]),
            oldCount: parseInt(match[2] ?? "1"),
            newStart: parseInt(match[3]),
            newCount: parseInt(match[4] ?? "1"),
            lines: [],
          };
          i++;

          while (i < lines.length) {
            const l = lines[i];
            if (l.startsWith("+") && !l.startsWith("+++")) {
              hunk.lines.push({ type: "add", content: l.slice(1) });
            } else if (l.startsWith("-") && !l.startsWith("---")) {
              hunk.lines.push({ type: "remove", content: l.slice(1) });
            } else if (l.startsWith(" ") || l === "") {
              hunk.lines.push({ type: "context", content: l.slice(1) });
            } else {
              break;
            }
            i++;
          }
          hunks.push(hunk);
        }

        patches.push({ path, hunks });
        continue;
      }
    }
    i++;
  }

  return patches;
}
