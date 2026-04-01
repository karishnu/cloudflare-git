import { tool } from "@opencode-ai/plugin"
import { spaceFetch } from "./_space.js"

export default tool({
  description: "List all branch deployments in an agent space.",
  args: {
    space_url: tool.schema.string().describe("Base URL of the agent space"),
    api_key: tool.schema.string().describe("API key for the agent space"),
  },
  async execute(args) {
    const res = await spaceFetch(args.space_url, args.api_key, "?cmd=list_deployments")
    const data = await res.json()

    if (!res.ok) {
      return `Error: ${data?.error ?? "failed to list deployments"}`
    }

    return JSON.stringify(data, null, 2)
  },
})
