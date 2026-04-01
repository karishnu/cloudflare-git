import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../helpers/types.js";
import { deploySpace, listSpaces, deleteSpace } from "./spaces.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

// ─── Server Factory ─────────────────────────────────────────────────────────

export function createServer(env: Env): McpServer {
  const server = new McpServer({
    name: "AgentSpace",
    version: "1.0.0",
  });

  // ── create_space ────────────────────────────────────────────────────────

  server.tool(
    "create_space",
    "Deploy a new agent-space as a separate Cloudflare Worker with its own URL, filesystem, and git repo. Returns the space URL and API key needed to interact with it via the workspace tools (read, write, edit, grep, glob, etc.).",
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
