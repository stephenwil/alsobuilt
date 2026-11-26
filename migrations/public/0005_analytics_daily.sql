-- Daily anonymous funnel aggregates (zero PII, zero IPs, zero cookies, zero raw pitch text)
CREATE TABLE IF NOT EXISTS analytics_daily (
  day TEXT NOT NULL,
  event TEXT NOT NULL,
  dim TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, event, dim)
);

CREATE INDEX IF NOT EXISTS idx_analytics_daily_day ON analytics_daily(day);
