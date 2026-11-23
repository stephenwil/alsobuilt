# AlsoBuilt

**Parallel AI builds & idea collision radar** — a dual-mode open-source app built on **Astro + Svelte 5 + Cloudflare Pages + Dual Cloudflare D1 SQLite databases**:

1. **Open Hub (`/`)** — Public multi-category collision sandbox where any developer can drop their AI idea pitch, see live overlap %, spot their unique wedge, compare side-by-side against existing variants, log an anonymous *"I'm Building Privately"* pulse, or generate a pre-filled variant PR (`variants/<category>/<slug>.yaml`).
2. **Personal Ideas Vault (`/vault`)** — Physically separate D1 database (`alsobuilt-vault`) locked behind **Cloudflare Access** where you track your own private ideas, notes, conviction scores, and crowding snapshots while running live read-only collision checks against the public hub.

---

## Quick Start (Local Development)

```bash
# 1. Install dependencies
npm install

# 2. Apply migrations to BOTH local SQLite D1 databases
npm run db:migrate:local

# 3. Validate YAML variants, build static Astro site, and run Cloudflare Pages + D1 locally
npm run preview
```

Open `http://<your-tailscale-host>.ts.net:8788/` (Open Hub) and `http://<your-tailscale-host>.ts.net:8788/vault/` (Personal Ideas Vault). Both `npm run dev` and `npm run preview` bind to `0.0.0.0` so they are immediately reachable over Tailscale.

---

## Deploying to Cloudflare Pages + D1

1. **Create both D1 databases** in your Cloudflare account:
   ```bash
   npx wrangler d1 create alsobuilt-public
   npx wrangler d1 create alsobuilt-vault
   ```
2. Paste the returned `database_id` UUIDs into `wrangler.jsonc`.
3. **Apply remote migrations**:
   ```bash
   npm run db:migrate:remote
   ```
4. **Deploy to Cloudflare Pages** (connect this GitHub repo in Cloudflare Dashboard → Pages → Build command `npm run build`, output directory `dist`), and bind `PUBLIC_DB` → `alsobuilt-public` and `VAULT_DB` → `alsobuilt-vault` under **Settings → Functions → D1 database bindings**.
5. **Lock `/vault` behind Cloudflare Access** (Zero Trust → Access → Applications):
   - Protect paths `/vault*` and `/api/vault*` allowing only your email.
   - Set environment variables in Cloudflare Pages: `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `PULSE_SALT`, and set `ALLOW_LOCAL_VAULT_BYPASS=false`.

---

## Contributing a Public Variant

Add one YAML file under `variants/<category>/<slug>.yaml` matching `schema/variant.schema.json`, then verify locally:

```bash
npm run validate:variants
```

See [docs/cloudflare-d1-manual.md](./docs/cloudflare-d1-manual.md) for the complete D1 architecture manual, limits, read replication guide, and roadmap.
