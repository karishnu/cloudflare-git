import { tool } from "@opencode-ai/plugin"
import { spaceFetch } from "./_space.js"

export default tool({
  description: "Commit all working tree files in an agent space.",
  args: {
    space_url: tool.schema.string().describe("Base URL of the agent space"),
    api_key: tool.schema.string().describe("API key for the agent space"),
    message: tool.schema.string().describe("Commit message"),
    author_name: tool.schema.string().optional().describe("Author name"),
    author_email: tool.schema.string().optional().describe("Author email"),
  },
  async execute(args) {
    const body: Record<string, unknown> = { message: args.message }
    if (args.author_name || args.author_email) {
      body.author = {
        name: args.author_name ?? "AgentSpace",
        email: args.author_email ?? "agent@agent-space.workers.dev",
      }
    }
    const res = await spaceFetch(args.space_url, args.api_key, "?cmd=commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    return JSON.stringify(data)
  },
})
