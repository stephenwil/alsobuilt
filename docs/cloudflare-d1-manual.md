# Cloudflare D1 Technical Manual & Roadmap for AlsoBuilt

> **Scope:** Dual-mode architecture for **AlsoBuilt** — a public **Open Hub** for parallel AI ideas (`alsobuilt-public`) paired with a physically isolated **Personal Ideas Vault** (`alsobuilt-vault`), both running serverless on **Cloudflare Pages + Workers + D1**.

---

## 1. What Is Cloudflare D1?

**Cloudflare D1** is Cloudflare's native **serverless SQLite database** designed to run directly alongside Cloudflare Workers and Cloudflare Pages Functions.

Instead of provisioning a database server (Postgres/MySQL VM, connection pools, VPC rules, idle monthly fees), D1 gives you standard **SQLite SQL** with:

- **Scale-to-zero billing:** $0 when idle; no egress fees.
- **Direct Worker bindings:** Query via `env.PUBLIC_DB.prepare(...)`—no connection strings, TLS handshake overhead, or pool exhaustion.
- **Database-per-boundary design:** You get **10 databases on the Free tier** (100,000 included on Paid), which lets AlsoBuilt keep your **Public Open Hub** and **Personal Ideas Vault** in **two physically separate databases** at zero extra cost.
- **Built-in Time Travel:** Automatic point-in-time recovery (restore to any minute in the last **7 days** on Free, **30 days** on Paid).
- **Global Read Replication:** Automatic read-only replicas across global regions (`ENAM`, `WNAM`, `WEUR`, `EEUR`, `APAC`, `OC`) at no extra fee beyond normal row-read metering.

---

## 2. AlsoBuilt Dual-Database Architecture

Separating public community data from your private ideas eliminates the risk of an accidental `WHERE is_public = 1` bug leaking your personal notes.

| Binding | Database Name | Exposure | Contents |
| :--- | :--- | :--- | :--- |
| `env.PUBLIC_DB` | `alsobuilt-public` | Public read / rate-limited stealth write | Public ideas/categories, variants (synced from GitHub YAML), traits, stealth builder pulses, archived lessons |
| `env.VAULT_DB` | `alsobuilt-vault` | **Private only** (gated by Cloudflare Access) | Your personal ideas, private scratch notes, conviction/priority scores, private collision snapshots, "promote to public" draft state |

### How Cross-Comparison Works (Zero Leakage)
When you open your private vault (`vault.alsobuilt.dev` or `/vault` behind Cloudflare Access):
1. The Worker reads your private idea from `env.VAULT_DB`.
2. The Worker runs a **read-only** similarity query against `env.PUBLIC_DB` (or client-side against `index.json`).
3. It renders your private idea on the Constellation Map and Wedge Diff against public projects—**never writing anything from `VAULT_DB` into `PUBLIC_DB`** unless you explicitly click **Publish as PR**.

---

## 3. Quotas, Pricing & Hard Limits

### Pricing & Daily/Monthly Allowances

| Resource | Workers Free ($0/mo) | Workers Paid ($5/mo base) |
| :--- | :--- | :--- |
| **Rows read** | 5,000,000 / day | 25 billion / month (+ $0.001 / million) |
| **Rows written** | 100,000 / day | 50 million / month (+ $1.00 / million) |
| **Storage** | 5 GB account total | 5 GB included (+ $0.75 / GB-month) |
| **Max size per DB** | 500 MB | 10 GB *(hard cap)* |
| **Max databases** | 10 | 100,000 included (up to 1,000,000 total) |
| **Queries / invocation** | 50 | 1,000 |
| **Time Travel window** | 7 days | 30 days |
| **Read Replicas** | Included | Included |

*Note: On the Free tier, daily limits reset at `00:00 UTC` and fail closed rather than charging overages.*

### Critical Technical Limits (All Plans)
- **Max SQL query duration:** `30s`
- **Max query result payload:** `50 MB`
- **Max SQL statement length:** `100 KB`
- **Max bound parameters per query:** `100`
- **Batching:** `db.batch([...])` executes sequentially in a transaction and counts as **1 query** toward the per-invocation limit.

### Three Billing & Performance Gotchas to Know Upfront
1. **Rows *scanned* count, not rows returned:** A `SELECT` on an unindexed 10,000-row table scans all 10,000 rows even if it returns 1 row. **Always index `WHERE` and `JOIN` columns** and verify with `EXPLAIN QUERY PLAN`.
2. **Index write amplification:** Every secondary index adds 1 extra row write per `INSERT`/`UPDATE`/`DELETE` touching that column. Keep indexes lean and purposeful.
3. **Keep hot catalog reads cached:** For AlsoBuilt's public catalog, compile `variants/*.yaml` into a static `index.json` served off Cloudflare's edge CDN for instant 0-row-read browsing, and hit D1 only for **live stealth pulses**, **submissions**, **votes**, and **Personal Vault CRUD**.

---

## 4. Schema Design for Both Databases

### A. Public Open Hub (`migrations/public/0001_init.sql`)
```sql
-- Top-level AI idea clusters / categories
CREATE TABLE categories (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Public tracked implementations (synced from GitHub variants/*.yaml)
CREATE TABLE variants (
  slug TEXT PRIMARY KEY,
  category_slug TEXT NOT NULL REFERENCES categories(slug),
  name TEXT NOT NULL,
  repo_url TEXT NOT NULL,
  tagline TEXT NOT NULL,
  arch TEXT NOT NULL,           -- Desktop | CLI | Web | Browser | Mobile
  model_mode TEXT NOT NULL,     -- Local LLM | Hybrid | Cloud API
  license TEXT NOT NULL,
  stage TEXT NOT NULL,          -- Prod | Beta | Proto | Lesson
  lesson_note TEXT,             -- Why pivoted/archived (for Stage = Lesson)
  stack TEXT NOT NULL,
  region TEXT,
  stars INTEGER NOT NULL DEFAULT 0,
  sparkline_json TEXT NOT NULL DEFAULT '[]',
  traits_json TEXT NOT NULL DEFAULT '[]',
  map_x REAL NOT NULL DEFAULT 0.5,
  map_y REAL NOT NULL DEFAULT 0.5,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_variants_category ON variants(category_slug);
CREATE INDEX idx_variants_stage ON variants(stage);

-- Anonymous "Building Privately" pulse counts (rate-limited by hashed IP/day)
CREATE TABLE stealth_pulses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_slug TEXT NOT NULL REFERENCES categories(slug),
  nearest_variant_slug TEXT,
  traits_json TEXT NOT NULL DEFAULT '[]',
  region TEXT,
  dedupe_hash TEXT NOT NULL UNIQUE, -- SHA-256(ip + salt + cluster + month)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_stealth_category ON stealth_pulses(category_slug);
CREATE INDEX idx_stealth_variant ON stealth_pulses(nearest_variant_slug);
```

### B. Personal Ideas Vault (`migrations/vault/0001_init.sql`)
```sql
CREATE TABLE personal_ideas (
  id TEXT PRIMARY KEY,              -- ULID / UUID
  title TEXT NOT NULL,
  pitch TEXT NOT NULL,
  category_slug TEXT,
  traits_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'spark', -- spark | researching | building | parked | shipped
  conviction INTEGER NOT NULL DEFAULT 3, -- 1..5
  private_notes TEXT NOT NULL DEFAULT '',
  wedge_notes TEXT NOT NULL DEFAULT '',
  last_max_overlap INTEGER,
  last_checked_at TEXT,
  promoted_slug TEXT,               -- Set if later published to public hub
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_personal_status ON personal_ideas(status);

-- Snapshot history so you can watch how crowded your idea gets over time
CREATE TABLE collision_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id TEXT NOT NULL REFERENCES personal_ideas(id) ON DELETE CASCADE,
  top_overlap INTEGER NOT NULL,
  closest_slug TEXT,
  public_twins_count INTEGER NOT NULL,
  stealth_nearby_count INTEGER NOT NULL,
  captured_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_snapshots_idea ON collision_snapshots(idea_id, captured_at);
```

---

## 5. Configuration (`wrangler.jsonc`) & Sessions API

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "alsobuilt",
  "compatibility_date": "2026-01-01",
  "pages_build_output_dir": "dist",
  "d1_databases": [
    {
      "binding": "PUBLIC_DB",
      "database_name": "alsobuilt-public",
      "database_id": "<PUBLIC_UUID>",
      "migrations_dir": "migrations/public"
    },
    {
      "binding": "VAULT_DB",
      "database_name": "alsobuilt-vault",
      "database_id": "<VAULT_UUID>",
      "migrations_dir": "migrations/vault"
    }
  ]
}
```

### Using Global Read Replicas Safely (`withSession`)
Direct calls (`env.PUBLIC_DB.prepare(...)`) always route to the primary. To benefit from global read replicas while preserving **read-your-writes**, use `withSession()`:

```ts
export async function onRequestGet({ request, env }: EventContext<Env, any, any>) {
  // Resume caller's consistency bookmark, or start at nearest edge replica
  const bookmark = request.headers.get("x-d1-bookmark") ?? "first-unconstrained";
  const session = env.PUBLIC_DB.withSession(bookmark);

  const { results } = await session
    .prepare("SELECT slug, name, stage, stars FROM variants WHERE category_slug = ?")
    .bind("ai-memory")
    .all();

  const res = Response.json({ variants: results });
  res.headers.set("x-d1-bookmark", session.getBookmark() ?? "");
  return res;
}
```

- Use `"first-unconstrained"` for fast public reads.
- Use `"first-primary"` or the caller's returned `bookmark` after writes (like clicking **+ I'm Building Privately** or saving a private idea in your vault).

---

## 6. Securing Your Personal Ideas Vault (Zero Auth Code)

Do **not** roll custom password auth for a single-owner personal vault. Use **Cloudflare Access (Zero Trust)**—free for up to 50 users:

1. Host the public app at `alsobuilt.dev` and gate `/vault/*` and `/api/vault/*` (or `vault.alsobuilt.dev`) behind a **Cloudflare Access Application**.
2. Set the policy to allow **only your email** (One-Time PIN or GitHub SSO).
3. Inside your Worker `/api/vault/*` middleware, verify the `Cf-Access-Jwt-Assertion` header against your Access team's public JWKS endpoint (defense-in-depth so direct `*.pages.dev` URLs can never bypass Access).

---

## 7. Day-to-Day Wrangler CLI Cheat Sheet

```bash
# Create both databases once
npx wrangler d1 create alsobuilt-public
npx wrangler d1 create alsobuilt-vault

# Create a new numbered migration
npx wrangler d1 migrations create alsobuilt-public add_stealth_table

# Apply migrations locally (SQLite file under .wrangler/state/v3/d1)
npx wrangler d1 migrations apply alsobuilt-public --local
npx wrangler d1 migrations apply alsobuilt-vault --local

# Apply migrations to production
npx wrangler d1 migrations apply alsobuilt-public --remote
npx wrangler d1 migrations apply alsobuilt-vault --remote

# Inspect query plan to verify index usage (avoid full table scans!)
npx wrangler d1 execute alsobuilt-public --remote \
  --command "EXPLAIN QUERY PLAN SELECT * FROM variants WHERE category_slug = 'ai-memory';"

# Point-in-time recovery (Time Travel)
npx wrangler d1 time-travel info alsobuilt-vault
npx wrangler d1 time-travel restore alsobuilt-vault --timestamp=2026-11-23T18:00:00Z
```

---

## 8. Four-Phase Build & Launch Roadmap

| Phase | Goal | Key Deliverables |
| :--- | :--- | :--- |
| **Phase 1 — Foundation** *(Day 1)* | Repo + Dual D1 setup | Astro + Svelte 5 + Tailwind app, Echo Frames SVG assets, `wrangler.jsonc`, `alsobuilt-public` & `alsobuilt-vault` migrations, local Wrangler dev working |
| **Phase 2 — Open Hub & Collision Engine** *(Days 2–3)* | Public interactive site | Multi-category Open Hub, `variants/*.yaml` + JSON Schema CI, Collision Sandbox (`YOUR IDEA` on Table/Map/Diff), live *"Building Privately"* counter backed by `PUBLIC_DB`, nightly GitHub Action stats sync |
| **Phase 3 — Personal Ideas Vault** *(Days 4–5)* | Private idea tracker | `/vault` workspace backed by `VAULT_DB`, Cloudflare Access Zero Trust lock, private notes & conviction ratings, automated **crowd-tracking snapshots** (see when new public repos encroach on your private ideas), 1-click *"Promote to Public PR"* |
| **Phase 4 — Scale & Launch** *(Week 2)* | Speed & community growth | Enable D1 Global Read Replication + `withSession`, dynamic OG Collision Receipt cards, optional edge embedding upgrade for semantic pitch matching, `Show HN` / Reddit / X launch |
