package core

import (
	"testing"
	"time"
)

func TestIndividualDeadlinesAcrossTimezonesAndDaylightSaving(t *testing.T) {
	for _, tc := range []struct{ start, end string }{
		{"2026-03-08T01:30:00-06:00", "2026-03-08T04:00:00-05:00"},
		{"2026-11-01T01:30:00-05:00", "2026-11-01T02:00:00-06:00"},
		{"2026-10-18T01:15:00+14:00", "2026-10-18T02:45:00+14:00"},
		{"2026-10-17T23:15:00-10:00", "2026-10-18T00:45:00-10:00"},
		{"2026-10-18T00:30:00+05:45", "2026-10-18T02:00:00+05:45"},
	} {
		t.Run(tc.start, func(t *testing.T) {
			start, err := time.Parse(time.RFC3339, tc.start)
			if err != nil {
				t.Fatal(err)
			}
			end, err := time.Parse(time.RFC3339, tc.end)
			if err != nil {
				t.Fatal(err)
			}
			for _, minutes := range []int64{90, 120} {
				a := &Attempt{Settings: Settings{Duration: minutes * 60}}
				commitStart(a, start.UnixMilli(), 100, "timezone-test")
				expected := end.Add(time.Duration(minutes-90) * time.Minute).UnixMilli()
				if a.Deadline != expected || a.OriginalDeadline != expected || a.UptimeDeadline != 100+float64(minutes*60) {
					t.Fatalf("%d-minute allowance changed across timezone or DST: %+v", minutes, a)
				}
			}
		})
	}
}
