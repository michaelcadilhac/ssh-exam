-- Native runtime observations only. NULL preserves every existing attempt's
-- legacy behavior; these fields cannot establish live work/hold permission.
ALTER TABLE attempts ADD COLUMN monitoring_mode TEXT CHECK(monitoring_mode IS NULL OR monitoring_mode IN ('legacy','v1'));
ALTER TABLE attempts ADD COLUMN retained_hold TEXT CHECK(retained_hold IS NULL OR retained_hold IN ('pending','unverified','held','resuming'));
ALTER TABLE attempts ADD COLUMN monitoring_hold_kind TEXT CHECK(monitoring_hold_kind IS NULL OR monitoring_hold_kind IN ('policy','technical'));
UPDATE attempts SET monitoring_mode='legacy' WHERE start IS NOT NULL;
INSERT INTO schema_version(version) VALUES(30);
