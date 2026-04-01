import git from "isomorphic-git";
import { createWorker } from "@cloudflare/worker-bundler";
import type { HandlerContext } from "../helpers/types.js";
import { jsonResponse } from "../helpers/git-pack.js";

// ─── Deploy Engine Handlers ─────────────────────────────────────────────────

export async function handleDeployCommand(
  ctx: HandlerContext,
  cmd: string,
  request: Request
): Promise<Response> {
  try {
    switch (cmd) {
      case "deploy":
        return await deployBranch(ctx, request);
      case "get_deployment":
        return await getDeployment(ctx, request);
      case "list_deployments":
        return await listDeployments(ctx);
      case "undeploy":
        return await undeployBranch(ctx, request);
      default:
        return jsonResponse({ error: `Unknown deploy command: ${cmd}` }, 400);
    }
  } catch (e: any) {
    return jsonResponse({ error: e.message ?? String(e) }, 500);
  }
}

// ─── Read files from a git branch tree ──────────────────────────────────────

async function readBranchFiles(
  ctx: HandlerContext,
  branch: string
): Promise<{ commitHash: string; files: Record<string, string> }> {
  // Resolve branch ref to commit hash
  const commitHash = await git.resolveRef({
    fs: ctx.fs,
    dir: "/",
    ref: branch,
  });

  // Read commit to get tree OID
  const { object: commitContent } = await git.readObject({
    fs: ctx.fs,
    dir: "/",
    oid: commitHash,
    format: "content",
  });
  const commitText = new TextDecoder().decode(commitContent as Uint8Array);
  const lines = commitText.split("\n");
  let treeOid = "";
  for (const line of lines) {
    if (line.startsWith("tree ")) {
      treeOid = line.slice(5).trim();
      break;
    }
  }
  if (!treeOid) {
    throw new Error(`Could not find tree in commit ${commitHash}`);
  }

  // Walk tree recursively to collect all files
  const files: Record<string, string> = {};
  await walkTree(ctx, treeOid, "", files);
  return { commitHash, files };
}

async function walkTree(
  ctx: HandlerContext,
  treeOid: string,
  prefix: string,
  files: Record<string, string>
): Promise<void> {
  const { object: content } = await git.readObject({
    fs: ctx.fs,
    dir: "/",
    oid: treeOid,
    format: "content",
  });
  const treeData = content as Uint8Array;
  const decoder = new TextDecoder();

  let pos = 0;
  while (pos < treeData.length) {
    // Parse mode
    let spaceIdx = pos;
    while (spaceIdx < treeData.length && treeData[spaceIdx] !== 0x20) spaceIdx++;
    const mode = decoder.decode(treeData.slice(pos, spaceIdx));

    // Parse name
    let nullIdx = spaceIdx + 1;
    while (nullIdx < treeData.length && treeData[nullIdx] !== 0) nullIdx++;
    const name = decoder.decode(treeData.slice(spaceIdx + 1, nullIdx));

    // 20-byte SHA
    if (nullIdx + 21 > treeData.length) break;
    const shaBytes = treeData.slice(nullIdx + 1, nullIdx + 21);
    const sha = Array.from(shaBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    pos = nullIdx + 21;

    const fullPath = prefix ? `${prefix}/${name}` : name;

    if (mode === "40000") {
      await walkTree(ctx, sha, fullPath, files);
    } else {
      try {
        const { object: blobContent } = await git.readObject({
          fs: ctx.fs,
          dir: "/",
          oid: sha,
          format: "content",
        });
        files[fullPath] = decoder.decode(blobContent as Uint8Array);
      } catch {
        // Skip unreadable blobs
      }
    }
  }
}

// ─── Deploy a branch ────────────────────────────────────────────────────────

async function deployBranch(
  ctx: HandlerContext,
  request: Request
): Promise<Response> {
  const body = (await request.json()) as { branch: string };
  const branch = body.branch;
  if (!branch) {
    return jsonResponse({ error: "branch is required" }, 400);
  }

  // Read all files from the branch
  const { commitHash, files } = await readBranchFiles(ctx, branch);

  if (Object.keys(files).length === 0) {
    return jsonResponse({ error: `No files found in branch "${branch}"` }, 400);
  }

  // Bundle with @cloudflare/worker-bundler (handles TS + npm deps)
  const { mainModule, modules } = await createWorker({ files });

  // Serialize modules: values may be strings or objects like {js: string}
  const serializedModules: Record<string, string | { js: string }> = {};
  for (const [name, value] of Object.entries(modules)) {
    if (typeof value === "string") {
      serializedModules[name] = value;
    } else {
      // Preserve module type objects as-is for JSON serialization
      serializedModules[name] = value as { js: string };
    }
  }

  // Store deployment in SQLite
  const now = Date.now();
  ctx.sql.exec(
    `INSERT OR REPLACE INTO deployments (branch, commit_hash, main_module, modules, deployed_at)
     VALUES (?, ?, ?, ?, ?)`,
    branch,
    commitHash,
    mainModule,
    JSON.stringify(serializedModules),
    now
  );

  return jsonResponse({
    branch,
    commit_hash: commitHash,
    main_module: mainModule,
    deployed_at: new Date(now).toISOString(),
  });
}

// ─── Get a deployment ───────────────────────────────────────────────────────

async function getDeployment(
  ctx: HandlerContext,
  request: Request
): Promise<Response> {
  const url = new URL(request.url);
  const branch = url.searchParams.get("branch");
  if (!branch) {
    return jsonResponse({ error: "branch query param is required" }, 400);
  }

  const row = ctx.sql
    .exec(
      "SELECT branch, commit_hash, main_module, modules, deployed_at FROM deployments WHERE branch = ?",
      branch
    )
    .toArray();

  if (row.length === 0) {
    return jsonResponse({ error: `No deployment found for branch "${branch}"` }, 404);
  }

  const r = row[0];
  return jsonResponse({
    branch: r.branch as string,
    commit_hash: r.commit_hash as string,
    main_module: r.main_module as string,
    modules: JSON.parse(r.modules as string),
    deployed_at: new Date(r.deployed_at as number).toISOString(),
  });
}

// ─── List deployments ───────────────────────────────────────────────────────

async function listDeployments(ctx: HandlerContext): Promise<Response> {
  const rows = ctx.sql
    .exec("SELECT branch, commit_hash, main_module, deployed_at FROM deployments ORDER BY deployed_at DESC")
    .toArray();

  const deployments = rows.map((r) => ({
    branch: r.branch as string,
    commit_hash: r.commit_hash as string,
    main_module: r.main_module as string,
    deployed_at: new Date(r.deployed_at as number).toISOString(),
  }));

  return jsonResponse(deployments);
}

// ─── Undeploy a branch ──────────────────────────────────────────────────────

async function undeployBranch(
  ctx: HandlerContext,
  request: Request
): Promise<Response> {
  const body = (await request.json()) as { branch: string };
  const branch = body.branch;
  if (!branch) {
    return jsonResponse({ error: "branch is required" }, 400);
  }

  const result = ctx.sql.exec(
    "DELETE FROM deployments WHERE branch = ?",
    branch
  );

  if (result.rowsWritten === 0) {
    return jsonResponse({ error: `No deployment found for branch "${branch}"` }, 404);
  }

  return jsonResponse({ ok: true, branch });
}
