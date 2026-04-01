import { tool } from "@opencode-ai/plugin"
import { spaceFetch } from "./_space.js"

export default tool({
  description:
    "Read file contents from an agent space. Supports optional line range (1-indexed offset and limit).",
  args: {
    space_url: tool.schema.string().describe("Base URL of the agent space"),
    api_key: tool.schema.string().describe("API key for the agent space"),
    path: tool.schema.string().describe("File path to read"),
    offset: tool.schema.number().int().min(1).optional().describe("1-indexed start line"),
    limit: tool.schema.number().int().min(1).optional().describe("Number of lines to return"),
  },
  async execute(args) {
    const res = await spaceFetch(args.space_url, args.api_key, args.path)
    if (!res.ok) {
      const err = await res.text()
      return `Error: ${err}`
    }
    let text = await res.text()

    if (args.offset !== undefined || args.limit !== undefined) {
      const lines = text.split("\n")
      const start = (args.offset ?? 1) - 1
      const end = args.limit !== undefined ? start + args.limit : lines.length
      text = lines
        .slice(start, end)
        .map((line, i) => `${start + i + 1}\t${line}`)
        .join("\n")
    }

    return text
  },
})
