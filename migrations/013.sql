CREATE TABLE agent_management_nonces (
  agent TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires INTEGER NOT NULL,
  PRIMARY KEY(agent,nonce)
);
CREATE INDEX agent_management_nonce_expiry ON agent_management_nonces(expires);
CREATE TABLE agent_management_requests (
  agent TEXT NOT NULL,
  request TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  PRIMARY KEY(agent,request)
);
INSERT INTO schema_version VALUES(13);
