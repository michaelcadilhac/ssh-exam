ALTER TABLE attempts ADD COLUMN original_deadline INTEGER;
ALTER TABLE attempts ADD COLUMN clock_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE attempts ADD COLUMN clock_resets TEXT NOT NULL DEFAULT '[]';
UPDATE attempts SET original_deadline=deadline WHERE start IS NOT NULL;
CREATE TABLE clock_reset_requests(id TEXT PRIMARY KEY, attempt TEXT NOT NULL REFERENCES attempts(id), body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending');
CREATE UNIQUE INDEX one_pending_clock_reset ON clock_reset_requests(attempt) WHERE status='pending';
INSERT INTO schema_version VALUES(7);
