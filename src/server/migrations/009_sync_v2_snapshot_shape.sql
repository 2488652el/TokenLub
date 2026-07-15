DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_sync_snapshots_snapshot_object'
      AND conrelid = 'user_sync_snapshots'::regclass
  ) THEN
    ALTER TABLE user_sync_snapshots
      ADD CONSTRAINT user_sync_snapshots_snapshot_object
      CHECK (jsonb_typeof(snapshot) = 'object');
  END IF;
END
$$;
