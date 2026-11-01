-- Original frame metadata/digests remain authoritative. These tables describe
-- verified, explicitly lossy derivatives of COMPLETED recordings only.
CREATE TABLE monitoring_video_segments(
 id TEXT PRIMARY KEY,
 attempt TEXT NOT NULL REFERENCES attempts(id),
 source TEXT NOT NULL CHECK(source IN ('screen','webcam')),
 sha256 TEXT NOT NULL,
 bytes INTEGER NOT NULL CHECK(bytes>0),
 width INTEGER NOT NULL CHECK(width>=2 AND width<=1280),
 height INTEGER NOT NULL CHECK(height>=2 AND height<=1280),
 frame_count INTEGER NOT NULL CHECK(frame_count BETWEEN 1 AND 12),
 source_bytes INTEGER NOT NULL CHECK(source_bytes>=0),
 created INTEGER NOT NULL,
 verified INTEGER NOT NULL,
 cleaned INTEGER
);
CREATE INDEX monitoring_video_attempt ON monitoring_video_segments(attempt,id);
CREATE TABLE monitoring_video_frames(
 frame TEXT PRIMARY KEY REFERENCES frames(id) ON DELETE CASCADE,
 segment TEXT NOT NULL REFERENCES monitoring_video_segments(id) ON DELETE CASCADE,
 frame_index INTEGER NOT NULL CHECK(frame_index BETWEEN 0 AND 11),
 decoded_sha256 TEXT NOT NULL,
 UNIQUE(segment,frame_index)
);
CREATE TABLE monitoring_video_jobs(
 attempt TEXT PRIMARY KEY REFERENCES attempts(id),
 status TEXT NOT NULL CHECK(status IN ('pending','running','retry','paused','complete','deleted')),
 owner TEXT,
 tries INTEGER NOT NULL DEFAULT 0,
 next INTEGER NOT NULL,
 updated INTEGER NOT NULL,
 verified INTEGER,
 error TEXT
);
CREATE INDEX monitoring_video_ready ON monitoring_video_jobs(status,next,attempt);
CREATE TABLE monitoring_video_requests(
 id TEXT PRIMARY KEY,
 attempt TEXT NOT NULL REFERENCES attempts(id),
 action TEXT NOT NULL CHECK(action IN ('request','retry','cancel')),
 created INTEGER NOT NULL,
 actor TEXT NOT NULL,
 input_hash TEXT NOT NULL,
 result TEXT NOT NULL
);
INSERT INTO schema_version VALUES(37);
