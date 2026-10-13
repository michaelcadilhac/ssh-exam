package core

import (
	"os"
	"testing"
)

func TestLogindInventoryAndEntryIdentity(t *testing.T) {
	for _, c := range []struct {
		text string
		want bool
		bad  bool
	}{
		{"", false, false}, {"1001 student\n1002 other\n", true, false},
		{"1002 other\n", false, false}, {"unknown inventory\n", false, true},
	} {
		present, err := loggedInUID([]byte(c.text), 1001)
		if present != c.want || (err != nil) != c.bad {
			t.Fatalf("inventory %q: %v %v", c.text, present, err)
		}
	}
	if trustedEntryExecutable(os.Getpid()) {
		t.Fatal("arbitrary test executable trusted as a gateway entry stub")
	}
}
