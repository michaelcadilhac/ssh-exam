-- Read recent instructor requests without scanning every full settings snapshot.
-- This index preserves all request, attempt and submission history.
CREATE INDEX grant_issuance_actor_exam_created
ON grant_issuance_previews(agent,actor,json_extract(snapshot,'$.exam'),created DESC,id DESC);
INSERT INTO schema_version VALUES(34);
