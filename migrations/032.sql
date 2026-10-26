-- Accepted native transition provenance only. Neither an observed purpose nor
-- nonce restores execution authority or authorizes another continuation.
ALTER TABLE attempts ADD COLUMN native_resume_kind TEXT CHECK(native_resume_kind IS NULL OR native_resume_kind IN ('reviewed','technical'));
ALTER TABLE attempts ADD COLUMN native_resume_nonce TEXT;
INSERT INTO schema_version(version) VALUES(32);
