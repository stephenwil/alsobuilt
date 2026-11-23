-- AlsoBuilt Personal Ideas Vault schema (alsobuilt-vault)
-- Physically isolated SQLite database gated behind Cloudflare Access.

CREATE TABLE IF NOT EXISTS personal_ideas (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  pitch TEXT NOT NULL,
  category_slug TEXT NOT NULL DEFAULT 'ai-memory',
  traits_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'spark', -- spark | researching | building | parked | shipped
  conviction INTEGER NOT NULL DEFAULT 3, -- 1..5
  private_notes TEXT NOT NULL DEFAULT '',
  wedge_notes TEXT NOT NULL DEFAULT '',
  last_max_overlap INTEGER,
  last_checked_at TEXT,
  promoted_slug TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_personal_status ON personal_ideas(status);
CREATE INDEX IF NOT EXISTS idx_personal_category ON personal_ideas(category_slug);

CREATE TABLE IF NOT EXISTS collision_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id TEXT NOT NULL REFERENCES personal_ideas(id) ON DELETE CASCADE,
  top_overlap INTEGER NOT NULL,
  closest_slug TEXT,
  public_twins_count INTEGER NOT NULL DEFAULT 0,
  stealth_nearby_count INTEGER NOT NULL DEFAULT 0,
  captured_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_snapshots_idea ON collision_snapshots(idea_id, captured_at);
