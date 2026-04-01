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
    "Find files matching a glob pattern in an agent space. Returns matching file paths sorted by modification time.",
  args: {
    space_url: tool.schema.string().describe("Base URL of the agent space"),
    api_key: tool.schema.string().describe("API key for the agent space"),
    pattern: tool.schema.string().describe("Glob pattern (e.g. '**/*.ts', 'src/*.js')"),
  },
  async execute(args) {
    const res = await spaceFetch(args.space_url, args.api_key, "?list")
    const files = (await res.json()) as { path: string; mtime: number }[]

    const re = globToRegex(args.pattern)
    const matched = files
      .filter((f) => re.test(f.path))
      .sort((a, b) => b.mtime - a.mtime)

    if (matched.length === 0) {
      return "No files matched."
    }
    return matched.map((f) => f.path).join("\n")
  },
})
