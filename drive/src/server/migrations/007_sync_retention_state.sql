CREATE TABLE IF NOT EXISTS sync_retention_states (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  minimum_sequence BIGINT NOT NULL CHECK (minimum_sequence > 0),
  updated_at TIMESTAMPTZ NOT NULL
);
