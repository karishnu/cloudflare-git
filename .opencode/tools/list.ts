import { tool } from "@opencode-ai/plugin"
import { spaceFetch } from "./_space.js"

export default tool({
  description:
    "List files and directories in an agent space, optionally filtered by a path prefix.",
  args: {
    space_url: tool.schema.string().describe("Base URL of the agent space"),
    api_key: tool.schema.string().describe("API key for the agent space"),
    prefix: tool.schema.string().optional().describe("Path prefix to filter by"),
  },
  async execute(args) {
    const queryPath = args.prefix ? `${args.prefix}?list` : "?list"
    const res = await spaceFetch(args.space_url, args.api_key, queryPath)
    const data = await res.json()
    return JSON.stringify(data, null, 2)
  },
})
