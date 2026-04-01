import type { Env } from "../helpers/types.js";

// ─── Cloudflare API helpers for space management ────────────────────────────

const CF_API = "https://api.cloudflare.com/client/v4";
const SPACE_PREFIX = "agent-space-";

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

// ─── Deploy a new space ─────────────────────────────────────────────────────

export async function deploySpace(
  env: Env,
  spaceName: string,
  apiKey: string
): Promise<{ url: string; scriptName: string }> {
  const scriptName = `${SPACE_PREFIX}${spaceName}`;
  const acct = env.CF_ACCOUNT_ID;
  const token = env.CF_API_TOKEN;

  // 1. Fetch our own Worker's script content (bundled modules)
  const selfName = "agent-space";
  const contentRes = await fetch(
    `${CF_API}/accounts/${acct}/workers/scripts/${selfName}/content/v2`,
    { headers: headers(token) }
  );
  if (!contentRes.ok) {
    const err = await contentRes.text();
    throw new Error(`Failed to fetch own script content: ${contentRes.status} ${err}`);
  }

  // The /content/v2 endpoint returns the compiled bundle; cf-entrypoint tells us the main module
  const mainModule = contentRes.headers.get("cf-entrypoint") ?? "index.js";
  const originalForm = await contentRes.formData();

  // 2. Build new FormData: our metadata + original module parts
  const metadata = {
    main_module: mainModule,
    compatibility_date: "2024-12-30",
    compatibility_flags: ["nodejs_compat"],
    bindings: [
      {
        type: "durable_object_namespace",
        name: "GIT_REPO",
        class_name: "GitRepoDO",
      },
      {
        type: "secret_text",
        name: "API_KEY",
        text: apiKey,
      },
      {
        type: "plain_text",
        name: "SPACE_ROLE",
        text: "workspace",
      },
      {
        type: "worker_loader",
        name: "LOADER",
      },
    ],
    migrations: {
      new_tag: "v1",
      steps: [{ new_sqlite_classes: ["GitRepoDO"] }],
    },
  };

  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" })
  );
  // Copy all module parts from the original response, preserving ES module type
  for (const [name, value] of originalForm.entries()) {
    if (name === "metadata") continue;
    const blob = typeof value === "string" ? new Blob([value]) : value;
    const contentType = blob.type || "application/javascript+module";
    form.append(
      name,
      new Blob([blob], { type: contentType }),
      name
    );
  }
  const uploadBody: BodyInit = form;

  const uploadRes = await fetch(
    `${CF_API}/accounts/${acct}/workers/scripts/${scriptName}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: uploadBody,
    }
  );

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`Failed to deploy space "${spaceName}": ${uploadRes.status} ${err}`);
  }

  // 3. Enable workers.dev subdomain for the new script
  await fetch(
    `${CF_API}/accounts/${acct}/workers/scripts/${scriptName}/subdomain`,
    {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ enabled: true }),
    }
  );

  // 4. Determine the workers.dev URL
  const subdomainRes = await fetch(
    `${CF_API}/accounts/${acct}/workers/subdomain`,
    { headers: headers(token) }
  );
  let subdomain = "";
  if (subdomainRes.ok) {
    const data = (await subdomainRes.json()) as any;
    subdomain = data?.result?.subdomain ?? "";
  }

  const url = subdomain
    ? `https://${scriptName}.${subdomain}.workers.dev`
    : `https://${scriptName}.workers.dev`;

  return { url, scriptName };
}

// ─── List spaces ────────────────────────────────────────────────────────────

export interface SpaceInfo {
  name: string;
  scriptName: string;
  url: string;
  createdOn: string;
  modifiedOn: string;
}

export async function listSpaces(env: Env): Promise<SpaceInfo[]> {
  const acct = env.CF_ACCOUNT_ID;
  const token = env.CF_API_TOKEN;

  // Get workers.dev subdomain
  const subdomainRes = await fetch(
    `${CF_API}/accounts/${acct}/workers/subdomain`,
    { headers: headers(token) }
  );
  let subdomain = "";
  if (subdomainRes.ok) {
    const data = (await subdomainRes.json()) as any;
    subdomain = data?.result?.subdomain ?? "";
  }

  // List all scripts
  const res = await fetch(
    `${CF_API}/accounts/${acct}/workers/scripts`,
    { headers: headers(token) }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to list workers: ${res.status} ${err}`);
  }

  const data = (await res.json()) as any;
  const scripts = data?.result ?? [];

  return scripts
    .filter((s: any) => (s.id as string).startsWith(SPACE_PREFIX))
    .map((s: any) => {
      const scriptName = s.id as string;
      const spaceName = scriptName.slice(SPACE_PREFIX.length);
      const url = subdomain
        ? `https://${scriptName}.${subdomain}.workers.dev`
        : `https://${scriptName}.workers.dev`;
      return {
        name: spaceName,
        scriptName,
        url,
        createdOn: s.created_on ?? "",
        modifiedOn: s.modified_on ?? "",
      };
    });
}

// ─── Delete a space ─────────────────────────────────────────────────────────

export async function deleteSpace(
  env: Env,
  spaceName: string
): Promise<void> {
  const scriptName = `${SPACE_PREFIX}${spaceName}`;
  const acct = env.CF_ACCOUNT_ID;
  const token = env.CF_API_TOKEN;

  const res = await fetch(
    `${CF_API}/accounts/${acct}/workers/scripts/${scriptName}`,
    {
      method: "DELETE",
      headers: headers(token),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to delete space "${spaceName}": ${res.status} ${err}`);
  }
}
