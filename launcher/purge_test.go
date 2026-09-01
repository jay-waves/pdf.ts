package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPurgeRemovesUserData(t *testing.T) {
	dataHome := t.TempDir()
	t.Setenv("XDG_DATA_HOME", dataHome)
	stateDirectory := filepath.Join(dataHome, "pdf.ts")
	if err := os.MkdirAll(stateDirectory, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stateDirectory, "marker"), []byte("data"), 0o600); err != nil {
		t.Fatal(err)
	}

	if err := Purge(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(stateDirectory); !os.IsNotExist(err) {
		t.Fatalf("state directory still exists after purge: %v", err)
	}
}
