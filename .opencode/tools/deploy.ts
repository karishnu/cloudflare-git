import { tool } from "@opencode-ai/plugin"
import { spaceFetch } from "./_space.js"

export default tool({
  description:
    "Deploy code from a git branch in an agent space as a dynamic worker.",
  args: {
    space_url: tool.schema.string().describe("Base URL of the agent space"),
    api_key: tool.schema.string().describe("API key for the agent space"),
    branch: tool.schema
      .string()
      .describe("Git branch name to deploy (e.g. 'release', 'main', 'feature/ui')"),
  },
  async execute(args) {
    const res = await spaceFetch(args.space_url, args.api_key, "?cmd=deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branch: args.branch }),
    })

    const data = await res.json()
    if (!res.ok) {
      return `Error: ${data?.error ?? "deployment failed"}`
    }

    return JSON.stringify(
      {
        ...data,
        release_url: `${args.space_url.replace(/\/+$/, "")}/release/${args.branch}`,
      },
      null,
      2
    )
  },
})
