# alsobuilt-mcp

Zero-dependency **Model Context Protocol (MCP)** server for [AlsoBuilt](https://alsobuilt.pages.dev/).

Ask Claude Code, Cursor, Codex, or any MCP-compatible agent to check who is already building your AI idea — including indie `<5k ★` repos and archived `Lesson` builds — **before** you scaffold a new repo.

## Tools Exposed

- **`check_idea_overlap`** — Score a one-sentence pitch against the live AlsoBuilt catalog (`https://alsobuilt.pages.dev/index.json`), returning overlap %, top matches (major & indie), your unique wedge traits, and a shareable radar URL.
- **`list_categories`** — List all 7 categories with repo counts, indie counts (`<5k ★`), and live anonymous Stealth Pulse counts (`/api/pulse`).
- **`search_projects`** — Search/filter repos by keyword, category, size tier (`indie`, `mid`, `major`), stage (`Prod`, `Beta`, `Proto`, `Lesson`), or exact `slug`.

## Quick Setup (Zero Install Dependencies — Node 20+)

Clone the repo (or run directly from your local checkout):

```bash
git clone https://github.com/stephenwil/alsobuilt.git
```

### Claude Code

```bash
claude mcp add alsobuilt -- node /path/to/alsobuilt/mcp/server.mjs
```

### Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "alsobuilt": {
      "command": "node",
      "args": ["/path/to/alsobuilt/mcp/server.mjs"]
    }
  }
}
```

### Codex (`~/.codex/config.toml`)

```toml
[mcp_servers.alsobuilt]
command = "node"
args = ["/path/to/alsobuilt/mcp/server.mjs"]
```

## Example Prompts Inside Your Coding Agent

- *"Check AlsoBuilt before I start building a local Rust TUI for monitoring Ollama & llama.cpp tokens/sec."*
- *"Search AlsoBuilt for indie (<5k star) MCP tooling projects written in Rust or Go."*
- *"Which AlsoBuilt categories currently have the most private stealth builders?"*

## Environment Variables

- `ALSOBUILT_URL` — Optional override for the catalog host (defaults to `https://alsobuilt.pages.dev`). Falls back to the bundled `public/index.json` when offline.
