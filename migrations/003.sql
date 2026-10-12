ALTER TABLE attempts ADD COLUMN access_state TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE attempts ADD COLUMN access_held_at INTEGER;
ALTER TABLE attempts ADD COLUMN access_released_at INTEGER;
ALTER TABLE attempts ADD COLUMN access_override TEXT;
ALTER TABLE attempts ADD COLUMN access_checked_at INTEGER;
ALTER TABLE attempts ADD COLUMN access_error TEXT;
UPDATE attempts SET access_state='HELD',access_held_at=start WHERE start IS NOT NULL;
INSERT INTO schema_version(version) VALUES(3);
-- Unlike a new unique index, this tolerates legacy history until remote reconciliation,
-- while preventing NEW reservations from overlapping a persisted interval hold.
CREATE TRIGGER account_access_hold_insert BEFORE INSERT ON attempts
WHEN NEW.state IN ('PREPARING','ACTIVE','LOCKED','FINALIZING','COLLECTION_FAILED')
BEGIN
  SELECT RAISE(ABORT, 'Account remains restricted by an original exam interval')
  WHERE EXISTS (SELECT 1 FROM attempts WHERE uid=NEW.uid AND
    (state IN ('PREPARING','ACTIVE','LOCKED','FINALIZING','COLLECTION_FAILED') OR
     (start IS NOT NULL AND access_state NOT IN ('RELEASED','OVERRIDDEN'))));
END;
