ALTER TABLE sync_entities
  DROP CONSTRAINT IF EXISTS sync_entities_entity_type_check;
ALTER TABLE sync_entities
  ADD CONSTRAINT sync_entities_entity_type_check
  CHECK (entity_type IN ('setting', 'model_pricing', 'balance_snapshot'));
ALTER TABLE sync_entities
  ADD COLUMN IF NOT EXISTS payload JSONB;
ALTER TABLE sync_entities
  ADD COLUMN IF NOT EXISTS deleted BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE sync_changes
  DROP CONSTRAINT IF EXISTS sync_changes_entity_type_check;
ALTER TABLE sync_changes
  ADD CONSTRAINT sync_changes_entity_type_check
  CHECK (entity_type IN ('setting', 'model_pricing', 'balance_snapshot'));
ALTER TABLE sync_changes
  ADD COLUMN IF NOT EXISTS operation TEXT NOT NULL DEFAULT 'upsert';
ALTER TABLE sync_changes
  DROP CONSTRAINT IF EXISTS sync_changes_operation_check;
ALTER TABLE sync_changes
  ADD CONSTRAINT sync_changes_operation_check
  CHECK (operation IN ('upsert', 'delete'));

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type = 'model_pricing'),
  entity_key TEXT NOT NULL,
  current_version INTEGER NOT NULL,
  current_payload JSONB,
  current_deleted BOOLEAN NOT NULL DEFAULT false,
  incoming_base_version INTEGER NOT NULL,
  incoming_operation TEXT NOT NULL CHECK (incoming_operation IN ('upsert', 'delete')),
  incoming_payload JSONB,
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved', 'discarded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_user_status
  ON sync_conflicts(user_id, status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_conflicts_operation
  ON sync_conflicts(user_id, device_id, operation_id);
