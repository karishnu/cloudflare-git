import { tool } from "@opencode-ai/plugin"
import { spaceFetch } from "./_space.js"

export default tool({
  description:
    "Remove a deployed branch from an agent space.",
  args: {
    space_url: tool.schema.string().describe("Base URL of the agent space"),
    api_key: tool.schema.string().describe("API key for the agent space"),
    branch: tool.schema.string().describe("Branch name to undeploy"),
  },
  async execute(args) {
    const res = await spaceFetch(args.space_url, args.api_key, "?cmd=undeploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branch: args.branch }),
    })

    const data = await res.json()
    if (!res.ok) {
      return `Error: ${data?.error ?? "undeploy failed"}`
    }

    return JSON.stringify(data, null, 2)
  },
})
