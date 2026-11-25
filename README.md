# AlsoBuilt

**Live:** [alsobuilt.pages.dev](https://alsobuilt.pages.dev/) · **Feed:** [`/index.json`](https://alsobuilt.pages.dev/index.json) · **MCP Server:** [`mcp/`](./mcp/README.md)

**See who's already building your idea.** An open-source, Git-first catalog and collision radar (96+ verified open-source repos — including 38 indie `<5k ★` builds — across 10 categories spanning AI, Hardware & Embedded, Game Dev & Retro, and DevTools) built on **Astro 7 + Svelte 5 + Cloudflare Pages + Cloudflare D1**.

- **Collision Radar (`/`)** — Paste a one-sentence pitch to rank similar open-source repos by trait & keyword overlap, spot missing wedge traits, compare projects side-by-side, explore the 2D Constellation Map, or filter specifically to **Indie (`<5k ★`)** and **Lesson** builds.
- **Anonymous Stealth Pulse (`/api/pulse`)** — Building privately and don't want to expose your repo? Toggle *"+ I'm Building Privately"* to anonymously increment the live monthly-deduplicated counter for your category (Cloudflare D1).
- **Zero-YAML Submissions** — [Submit a GitHub repo via Issue Form](https://github.com/stephenwil/alsobuilt/issues/new?template=submit-project.yml) and GitHub Actions automatically fetches live stars/license and opens a validated catalog PR — or open a direct PR adding `variants/<category>/<slug>.yaml`.
- **MCP Server (`npx -y alsobuilt-mcp`)** — Zero-dependency stdio MCP server so Claude Code, Cursor, or Codex can check AlsoBuilt before scaffolding a new repo (`claude mcp add alsobuilt -- npx -y alsobuilt-mcp`). See [mcp/README.md](./mcp/README.md).
- **Open JSON Feed (`/index.json`)** — Static, CORS-enabled catalog compiled at build time from `variants/**/*.yaml` with nightly GitHub star refreshes and automatic deploys.

---

## Add the README Badge to Your Project

If your repo is listed in AlsoBuilt, feel free to add a badge linking back to your category:

```markdown
[![Listed on AlsoBuilt](https://img.shields.io/badge/AlsoBuilt-listed-6366f1?style=flat-square)](https://alsobuilt.pages.dev/)
```

---

## Quick Start (Local Development)

```bash
# 1. Install dependencies
npm install

# 2. Apply migrations to the local SQLite D1 database
npm run db:migrate:local

# 3. Validate YAML variants, build static Astro site, and run Cloudflare Pages + D1 locally
npm run preview
```

---

## Contributing a Project

**Option A (Fastest — No YAML):** Open a [Project Submission Issue](https://github.com/stephenwil/alsobuilt/issues/new?template=submit-project.yml) with your GitHub repo URL. Our Action validates it against the GitHub API and opens the PR automatically.

**Option B (Direct PR):** Add one YAML file under `variants/<category>/<slug>.yaml` matching `schema/variant.schema.json`, then verify locally:

```bash
npm run validate:variants
```

Merging to `main` automatically validates, runs D1 migrations, syncs `categories.yaml` to Cloudflare D1, and deploys to [alsobuilt.pages.dev](https://alsobuilt.pages.dev/).

### Adding a New Category

All categories live in a single source of truth: [`categories.yaml`](./categories.yaml).

1. Add a `slug`, `name`, and `description` entry to `categories.yaml`.
2. Run `npm run sync:categories` (auto-updates `schema/variant.schema.json` and the GitHub Issue Form dropdown).
3. Commit & push — GitHub Actions automatically upserts the new category into Cloudflare D1 on deploy.

Contributors can also select **`other (suggest a new category below)`** directly in the Issue Form to propose a new category alongside their project PR.

See [docs/cloudflare-d1-manual.md](./docs/cloudflare-d1-manual.md) for the Cloudflare D1 architecture reference.
