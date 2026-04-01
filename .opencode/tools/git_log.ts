import { tool } from "@opencode-ai/plugin"
import { spaceFetch } from "./_space.js"

export default tool({
  description: "View commit history of an agent space.",
  args: {
    space_url: tool.schema.string().describe("Base URL of the agent space"),
    api_key: tool.schema.string().describe("API key for the agent space"),
    depth: tool.schema
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Max number of commits to return"),
  },
  async execute(args) {
    const res = await spaceFetch(args.space_url, args.api_key, "?cmd=log")
    let data = (await res.json()) as unknown[]
    if (args.depth !== undefined) {
      data = data.slice(0, args.depth)
    }
    return JSON.stringify(data, null, 2)
  },
})
