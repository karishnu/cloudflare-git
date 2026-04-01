import { tool } from "@opencode-ai/plugin"
import { spaceFetch } from "./_space.js"

export default tool({
  description: "Create or overwrite a file in an agent space.",
  args: {
    space_url: tool.schema.string().describe("Base URL of the agent space"),
    api_key: tool.schema.string().describe("API key for the agent space"),
    path: tool.schema.string().describe("File path to write"),
    content: tool.schema.string().describe("File content"),
  },
  async execute(args) {
    const res = await spaceFetch(args.space_url, args.api_key, args.path, {
      method: "PUT",
      body: args.content,
    })
    const data = await res.json()
    return JSON.stringify(data)
  },
})
