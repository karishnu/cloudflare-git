import { tool } from "@opencode-ai/plugin"
import { spaceFetch } from "./_space.js"

function globToRegex(pattern: string): RegExp {
  let re = "^"
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*"
        i++
        if (pattern[i + 1] === "/") i++
      } else {
        re += "[^/]*"
      }
    } else if (c === "?") {
      re += "[^/]"
    } else if (c === ".") {
      re += "\\."
    } else {
      re += c
    }
  }
  re += "$"
  return new RegExp(re)
}

export default tool({
  description:
    "Search file contents in an agent space using a regular expression. Returns matching lines with file paths and line numbers.",
  args: {
    space_url: tool.schema.string().describe("Base URL of the agent space"),
    api_key: tool.schema.string().describe("API key for the agent space"),
    pattern: tool.schema.string().describe("Regex pattern to search for"),
    include: tool.schema
      .string()
      .optional()
      .describe("Glob pattern to filter files (e.g. '*.ts')"),
  },
  async execute(args) {
    const listRes = await spaceFetch(args.space_url, args.api_key, "?list")
    const files = (await listRes.json()) as { path: string }[]

    const includeRe = args.include ? globToRegex(args.include) : null
    const searchRe = new RegExp(args.pattern, "gi")

    const results: string[] = []
    for (const file of files) {
      if (includeRe && !includeRe.test(file.path)) continue

      const readRes = await spaceFetch(args.space_url, args.api_key, file.path)
      if (!readRes.ok) continue

      const text = await readRes.text()
      const lines = text.split("\n")
      for (let i = 0; i < lines.length; i++) {
        if (searchRe.test(lines[i])) {
          results.push(`${file.path}:${i + 1}:${lines[i]}`)
        }
        searchRe.lastIndex = 0
      }
    }

    if (results.length === 0) {
      return "No matches found."
    }
    return results.join("\n")
  },
})
