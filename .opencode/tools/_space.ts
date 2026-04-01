// Shared helper for OpenCode custom tools that interact with agent spaces.
// Prefixed with _ so OpenCode doesn't register it as a tool.

export async function spaceFetch(
  spaceUrl: string,
  apiKey: string,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const base = spaceUrl.replace(/\/+$/, "");
  const url = `${base}/${path.replace(/^\/+/, "")}`;
  const headers: Record<string, string> = {
    "X-API-Key": apiKey,
    ...(init?.headers as Record<string, string> ?? {}),
  };
  return fetch(url, { ...init, headers });
}

export function requireSpaceArgs(spaceUrl: unknown, apiKey: unknown): void {
  if (!spaceUrl || typeof spaceUrl !== "string") {
    throw new Error("space_url is required");
  }
  if (!apiKey || typeof apiKey !== "string") {
    throw new Error("api_key is required");
  }
}
