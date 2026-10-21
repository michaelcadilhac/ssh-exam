-- Review fences contain only counters, never hashes/copies of private messages.
ALTER TABLE attempts ADD COLUMN continuation_revision INTEGER NOT NULL DEFAULT 0;
CREATE TABLE continuation_requests(
  actor TEXT NOT NULL,
  request TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  result TEXT NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY(actor,request)
);
CREATE TRIGGER continuation_attempt_revision AFTER UPDATE OF state,generation,start,deadline,original_deadline,clock_revision,protected,ended,reason ON attempts
WHEN OLD.state IS NOT NEW.state OR OLD.generation IS NOT NEW.generation OR OLD.start IS NOT NEW.start
 OR OLD.deadline IS NOT NEW.deadline OR OLD.original_deadline IS NOT NEW.original_deadline
 OR OLD.clock_revision IS NOT NEW.clock_revision OR OLD.protected IS NOT NEW.protected
 OR OLD.ended IS NOT NEW.ended OR OLD.reason IS NOT NEW.reason
BEGIN UPDATE attempts SET continuation_revision=continuation_revision+1 WHERE id=NEW.id; END;
CREATE TRIGGER continuation_history_insert AFTER INSERT ON attempt_interruptions
BEGIN UPDATE attempts SET continuation_revision=continuation_revision+1 WHERE id=NEW.attempt; END;
CREATE TRIGGER continuation_history_update AFTER UPDATE ON attempt_interruptions
WHEN OLD.generation IS NOT NEW.generation OR OLD.events IS NOT NEW.events
 OR OLD.authorizations IS NOT NEW.authorizations OR OLD.ended IS NOT NEW.ended
 OR OLD.outcome IS NOT NEW.outcome OR OLD.opened IS NOT NEW.opened OR OLD.historical IS NOT NEW.historical
BEGIN UPDATE attempts SET continuation_revision=continuation_revision+1 WHERE id=NEW.attempt; END;
CREATE TRIGGER continuation_history_delete AFTER DELETE ON attempt_interruptions
BEGIN UPDATE attempts SET continuation_revision=continuation_revision+1 WHERE id=OLD.attempt; END;
CREATE TRIGGER continuation_incident_insert AFTER INSERT ON incidents
BEGIN UPDATE attempts SET continuation_revision=continuation_revision+1 WHERE id=NEW.attempt; END;
CREATE TRIGGER continuation_incident_update AFTER UPDATE ON incidents
WHEN OLD.generation IS NOT NEW.generation OR OLD.events IS NOT NEW.events
 OR OLD.message IS NOT NEW.message OR OLD.review_at IS NOT NEW.review_at OR OLD.opened IS NOT NEW.opened
BEGIN UPDATE attempts SET continuation_revision=continuation_revision+1 WHERE id=NEW.attempt; END;
CREATE TRIGGER continuation_incident_delete AFTER DELETE ON incidents
BEGIN UPDATE attempts SET continuation_revision=continuation_revision+1 WHERE id=OLD.attempt; END;
CREATE TRIGGER continuation_grant_insert AFTER INSERT ON continuations
BEGIN UPDATE attempts SET continuation_revision=continuation_revision+1 WHERE id=NEW.attempt; END;
CREATE TRIGGER continuation_grant_update AFTER UPDATE ON continuations
WHEN OLD.generation IS NOT NEW.generation OR OLD.expires IS NOT NEW.expires OR OLD.consumed IS NOT NEW.consumed
BEGIN UPDATE attempts SET continuation_revision=continuation_revision+1 WHERE id=NEW.attempt; END;
CREATE TRIGGER continuation_grant_delete AFTER DELETE ON continuations
BEGIN UPDATE attempts SET continuation_revision=continuation_revision+1 WHERE id=OLD.attempt; END;
INSERT INTO schema_version(version) VALUES(16);
