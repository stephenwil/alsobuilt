# alsobuilt-mcp

Zero-dependency **Model Context Protocol (MCP)** server for [AlsoBuilt](https://alsobuilt.pages.dev/).

Ask Claude Code, Cursor, Codex, or any MCP-compatible coding agent to check who is already building your open-source idea — across AI, hardware & embedded, game dev & retro, devtools, indie `<5k ★` repos, and archived `Lesson` builds — **before** you scaffold a new repo.

## Tools Exposed

- **`check_idea_overlap`** — Score a one-sentence pitch against the live AlsoBuilt catalog (`https://alsobuilt.pages.dev/index.json`), returning overlap %, top matches (major & indie), your unique wedge traits, and a shareable radar URL.
- **`list_categories`** — List all AlsoBuilt categories with repo counts, indie counts (`<5k ★`), and live anonymous Stealth Pulse counts (`/api/pulse`).
- **`search_projects`** — Search/filter repos by keyword, category, size tier (`indie`, `mid`, `major`), stage (`Prod`, `Beta`, `Proto`, `Lesson`), or exact `slug`.

## Quick Setup (1-Line via `npx` — Node 20+, Zero Dependencies)

### Claude Code

```bash
claude mcp add alsobuilt -- npx -y alsobuilt-mcp
```

### Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "alsobuilt": {
      "command": "npx",
      "args": ["-y", "alsobuilt-mcp"]
    }
  }
}
```

### Codex (`~/.codex/config.toml`)

```toml
[mcp_servers.alsobuilt]
command = "npx"
args = ["-y", "alsobuilt-mcp"]
```

### Alternative: Run from a Local Checkout

```bash
git clone https://github.com/stephenwil/alsobuilt.git
claude mcp add alsobuilt -- node /path/to/alsobuilt/mcp/server.mjs
```

## Example Prompts Inside Your Coding Agent

- *"Check AlsoBuilt before I start building a local Rust TUI for monitoring Ollama & llama.cpp tokens/sec."*
- *"What open-source fantasy console SDKs or WebGL voxel dev kits are already on AlsoBuilt?"*
- *"Search AlsoBuilt for indie (<5k star) MCP tooling or hardware CAN bus projects."*
- *"Which AlsoBuilt categories currently have the most private stealth builders?"*

## Environment Variables

- `ALSOBUILT_URL` — Optional override for the catalog host (defaults to `https://alsobuilt.pages.dev`). Falls back to a local `../public/index.json` when running from a checkout offline.
