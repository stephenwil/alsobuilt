# AlsoBuilt

**Parallel AI builds & idea collision radar** — an open-source, Git-first catalog and collision sandbox built on **Astro 5 + Svelte 5 + Cloudflare Pages + Cloudflare D1 (`alsobuilt-public`)**.

- **Collision Sandbox (`/`)** — Drop an AI idea pitch, see live overlap %, spot your unique wedge, compare variants side-by-side across Table / Constellation Map / Cards views, log an anonymous *"I'm Building Privately"* pulse (`/api/pulse`), or generate a pre-filled variant PR (`variants/<category>/<slug>.yaml`).
- **Open Catalog Feed (`/index.json`)** — Static, CORS-enabled JSON index compiled at build time from `variants/**/*.yaml` so separate private notebooks, CLI tools, or personal idea vaults can run read-only collision checks without coupling to this repo.

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

Open `http://<your-tailscale-host>.ts.net:8788/` (Open Hub) or `http://<your-tailscale-host>.ts.net:8788/index.json` (catalog feed). Both `npm run dev` and `npm run preview` bind to `0.0.0.0` so they are immediately reachable over Tailscale.

---

## Deploying to Cloudflare Pages + D1

1. **Create the public D1 database** in your Cloudflare account:
   ```bash
   npx wrangler d1 create alsobuilt-public
   ```
2. Paste the returned `database_id` UUID into `wrangler.jsonc`.
3. **Apply remote migrations**:
   ```bash
   npm run db:migrate:remote
   ```
4. **Deploy to Cloudflare Pages** (connect this GitHub repo in Cloudflare Dashboard → Pages → Build command `npm run build`, output directory `dist`), bind `PUBLIC_DB` → `alsobuilt-public` under **Settings → Functions → D1 database bindings**, and set an optional `PULSE_SALT` secret for monthly anonymous IP hashing.

---

## Contributing a Public Variant

Add one YAML file under `variants/<category>/<slug>.yaml` matching `schema/variant.schema.json`, then verify locally:

```bash
npm run validate:variants
```

See [docs/cloudflare-d1-manual.md](./docs/cloudflare-d1-manual.md) for the Cloudflare D1 architecture reference, limits, and read replication guide.
