import { tool } from "@opencode-ai/plugin"
import { spaceFetch } from "./_space.js"

export default tool({
  description:
    "List files in an agent space's working tree with their modification times.",
  args: {
    space_url: tool.schema.string().describe("Base URL of the agent space"),
    api_key: tool.schema.string().describe("API key for the agent space"),
  },
  async execute(args) {
    const res = await spaceFetch(args.space_url, args.api_key, "?list")
    const files = (await res.json()) as { path: string; mtime: number }[]
    if (files.length === 0) {
      return "Working tree is empty."
    }
    return files
      .map((f) => {
        const date = new Date(f.mtime).toISOString()
        return `${date}  ${f.path}`
      })
      .join("\n")
  },
})
