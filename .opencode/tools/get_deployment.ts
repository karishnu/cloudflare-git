import { tool } from "@opencode-ai/plugin"
import { spaceFetch } from "./_space.js"

export default tool({
  description:
    "Get deployment metadata for a branch in an agent space.",
  args: {
    space_url: tool.schema.string().describe("Base URL of the agent space"),
    api_key: tool.schema.string().describe("API key for the agent space"),
    branch: tool.schema.string().describe("Branch name to inspect"),
  },
  async execute(args) {
    const res = await spaceFetch(
      args.space_url,
      args.api_key,
      `?cmd=get_deployment&branch=${encodeURIComponent(args.branch)}`
    )

    const data = await res.json()
    if (!res.ok) {
      return `Error: ${data?.error ?? "failed to get deployment"}`
    }

    return JSON.stringify(data, null, 2)
  },
})
