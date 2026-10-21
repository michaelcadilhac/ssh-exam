package core

import "errors"

const mib int64 = 1024 * 1024
const DefaultCollectionFileMiB int64 = 128
const DefaultCollectionTotalMiB int64 = 512

type collectionBounds struct{ File, Total int64 }

// An omitted pair means an immutable pre-limit snapshot, never today's default.
// Modern issuers explicitly snapshot both values. Preserve legacy archives and
// staged settings hashes instead of silently raising historical policy.
func limitsForSettings(s Settings) (collectionBounds, error) {
	if s.CollectionFileMiB == 0 && s.CollectionTotalMiB == 0 {
		return collectionBounds{32 * mib, 64 * mib}, nil
	}
	if s.CollectionFileMiB < 1 || s.CollectionFileMiB > 4096 || s.CollectionTotalMiB < s.CollectionFileMiB || s.CollectionTotalMiB > 16384 {
		return collectionBounds{}, errors.New("collection_file_mib must be 1..4096 and collection_total_mib 1..16384, with total at least per-file; both must be snapshotted")
	}
	return collectionBounds{s.CollectionFileMiB * mib, s.CollectionTotalMiB * mib}, nil
}
