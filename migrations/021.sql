-- Additive browser credential intents. Fingerprints contain only the username
-- and the same strong salted Argon2id verifier used for account authentication,
-- never plaintext passwords or fast password-derived fingerprints.
CREATE TABLE administrator_creation_requests (
  actor TEXT NOT NULL,
  request TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  result TEXT NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY(actor,request)
);
INSERT INTO schema_version VALUES(21);
