CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  state TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS rooms_updated_at ON rooms(updated_at);
