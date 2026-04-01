import { tool } from "@opencode-ai/plugin"
import { spaceFetch } from "./_space.js"

export default tool({
  description:
    "Find and replace an exact string in a file on an agent space. The old_string must be unique in the file.",
  args: {
    space_url: tool.schema.string().describe("Base URL of the agent space"),
    api_key: tool.schema.string().describe("API key for the agent space"),
    path: tool.schema.string().describe("File path to edit"),
    old_string: tool.schema.string().describe("Exact text to find (must be unique)"),
    new_string: tool.schema.string().describe("Replacement text"),
  },
  async execute(args) {
    // Read current content
    const readRes = await spaceFetch(args.space_url, args.api_key, args.path)
    if (!readRes.ok) {
      return `Error: file not found: ${args.path}`
    }
    const text = await readRes.text()

    const count = text.split(args.old_string).length - 1
    if (count === 0) {
      return `Error: old_string not found in ${args.path}`
    }
    if (count > 1) {
      return `Error: old_string found ${count} times in ${args.path} (must be unique)`
    }

    const newText = text.replace(args.old_string, args.new_string)
    const writeRes = await spaceFetch(args.space_url, args.api_key, args.path, {
      method: "PUT",
      body: newText,
    })
    const data = await writeRes.json()
    return JSON.stringify(data)
  },
})
