import { tool } from "@opencode-ai/plugin"
import { spaceFetch } from "./_space.js"

// ─── Unified Diff Parser ────────────────────────────────────────────────────

interface HunkLine {
  type: "add" | "remove" | "context"
  content: string
}

interface Hunk {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: HunkLine[]
}

interface FilePatch {
  path: string
  hunks: Hunk[]
}

function parseUnifiedDiff(diff: string): FilePatch[] {
  const patches: FilePatch[] = []
  const lines = diff.split("\n")
  let i = 0

  while (i < lines.length) {
    if (lines[i].startsWith("--- ")) {
      const oldPath = lines[i].slice(4).replace(/^[ab]\//, "")
      i++
      if (i < lines.length && lines[i].startsWith("+++ ")) {
        const newPath = lines[i].slice(4).replace(/^[ab]\//, "")
        i++
        const path = newPath === "/dev/null" ? oldPath : newPath
        const hunks: Hunk[] = []

        while (i < lines.length && lines[i].startsWith("@@ ")) {
          const match = lines[i].match(
            /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/
          )
          if (!match) {
            i++
            continue
          }
          const hunk: Hunk = {
            oldStart: parseInt(match[1]),
            oldCount: parseInt(match[2] ?? "1"),
            newStart: parseInt(match[3]),
            newCount: parseInt(match[4] ?? "1"),
            lines: [],
          }
          i++

          while (i < lines.length) {
            const l = lines[i]
            if (l.startsWith("+") && !l.startsWith("+++")) {
              hunk.lines.push({ type: "add", content: l.slice(1) })
            } else if (l.startsWith("-") && !l.startsWith("---")) {
              hunk.lines.push({ type: "remove", content: l.slice(1) })
            } else if (l.startsWith(" ") || l === "") {
              hunk.lines.push({ type: "context", content: l.slice(1) })
            } else {
              break
            }
            i++
          }
          hunks.push(hunk)
        }

        patches.push({ path, hunks })
        continue
      }
    }
    i++
  }

  return patches
}

export default tool({
  description: "Apply a unified diff to one or more files in an agent space.",
  args: {
    space_url: tool.schema.string().describe("Base URL of the agent space"),
    api_key: tool.schema.string().describe("API key for the agent space"),
    diff: tool.schema.string().describe("Unified diff content"),
  },
  async execute(args) {
    const filePatches = parseUnifiedDiff(args.diff)
    const results: string[] = []

    for (const fp of filePatches) {
      let lines: string[] = []
      const readRes = await spaceFetch(args.space_url, args.api_key, fp.path)
      if (readRes.ok) {
        const text = await readRes.text()
        lines = text.split("\n")
      }

      const sortedHunks = [...fp.hunks].sort((a, b) => b.oldStart - a.oldStart)
      for (const hunk of sortedHunks) {
        const newLines: string[] = []
        for (const hl of hunk.lines) {
          if (hl.type === "add" || hl.type === "context") {
            newLines.push(hl.content)
          }
        }
        const removeCount = hunk.lines.filter(
          (l) => l.type === "remove" || l.type === "context"
        ).length
        lines.splice(hunk.oldStart - 1, removeCount, ...newLines)
      }

      const writeRes = await spaceFetch(args.space_url, args.api_key, fp.path, {
        method: "PUT",
        body: lines.join("\n"),
      })
      if (writeRes.ok) {
        results.push(`Patched: ${fp.path}`)
      } else {
        results.push(`Failed: ${fp.path}`)
      }
    }

    return results.join("\n")
  },
})
