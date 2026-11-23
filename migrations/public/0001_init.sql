-- AlsoBuilt Public Open Hub schema (alsobuilt-public)
-- Every filtered column is indexed so D1 stays well inside free-tier row-scan quotas.

CREATE TABLE IF NOT EXISTS categories (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS variants (
  slug TEXT PRIMARY KEY,
  category_slug TEXT NOT NULL REFERENCES categories(slug),
  name TEXT NOT NULL,
  repo_url TEXT NOT NULL,
  tagline TEXT NOT NULL,
  arch TEXT NOT NULL,
  model_mode TEXT NOT NULL,
  license TEXT NOT NULL,
  stage TEXT NOT NULL,
  lesson_note TEXT,
  stack TEXT NOT NULL,
  region TEXT,
  stars INTEGER NOT NULL DEFAULT 0,
  sparkline_json TEXT NOT NULL DEFAULT '[]',
  traits_json TEXT NOT NULL DEFAULT '[]',
  map_x REAL NOT NULL DEFAULT 0.5,
  map_y REAL NOT NULL DEFAULT 0.5,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_variants_category ON variants(category_slug);
CREATE INDEX IF NOT EXISTS idx_variants_stage ON variants(stage);

-- Anonymous "I'm Building Privately" pulse counts (deduplicated per hashed visitor/month)
CREATE TABLE IF NOT EXISTS stealth_pulses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_slug TEXT NOT NULL REFERENCES categories(slug),
  nearest_variant_slug TEXT,
  traits_json TEXT NOT NULL DEFAULT '[]',
  region TEXT,
  dedupe_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_stealth_category ON stealth_pulses(category_slug);
CREATE INDEX IF NOT EXISTS idx_stealth_variant ON stealth_pulses(nearest_variant_slug);
