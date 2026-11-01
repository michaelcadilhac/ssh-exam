# Authored monitoring-video compatibility fixture

This 4,914-byte VP9/WebM segment contains three captures of a drawn synthetic
camera scene (320×240). It contains no person, student data, audio or real camera
capture. Canvas generated the scene; the original JPEG input hashes and observed
source byte count are recorded in the manifest. Original JPEGs are deliberately
not included, so release checks must read the video representation.

The segment and `result` manifest are unchanged outputs from the successful
Debian FFmpeg 5.1.9 runtime probe on November 1, 2026. The encoder used
libvpx-vp9, CRF35, cpu-used6, one thread and one capture every five seconds.
`decoded_sha256` hashes packed RGB24 pixels from each decoded frame. Identical
input JPEGs do not imply identical lossy output frames; preserve all three hashes.

`manifest.json` is local fixture metadata. Its nested `result` is the exact
`VideoResult` producer response; `source_frames` copies the exact input-frame
projection, and `source_bytes` was measured from the verified synthetic inputs. The source clip SHA256 is
`d3614a8b6c04786543564fdb9820589ead2c9ff1c1e5aa7782e1028be97b0b89`.

`tests/container-release-smoke.py` validates that response using the compiled
schema, shifts only synthetic database timestamps before taking its baseline,
and reads the existing segment through compiled MonitoringMedia. It never
regenerates the clip or updates its expected hashes. A future codec change must
retain compatibility or provide a separately reviewed migration.
