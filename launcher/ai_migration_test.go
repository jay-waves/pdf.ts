package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRegistryRemovesRetiredAICredentials(t *testing.T) {
	directory := t.TempDir()
	statePath := filepath.Join(directory, stateFilename)
	if err := os.WriteFile(statePath, []byte(`{"version":3,"documents":{},"ai":{"apiKey":"old-encrypted-key","baseUrl":"https://example.com"}}`), 0600); err != nil {
		t.Fatal(err)
	}
	masterPath := filepath.Join(directory, "master.key")
	if err := os.WriteFile(masterPath, []byte("old-master-key"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := OpenRegistry(directory); err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(content), `"ai"`) || strings.Contains(string(content), "old-encrypted-key") {
		t.Fatal("retired AI configuration remains on disk")
	}
	if _, err := os.Stat(masterPath); !os.IsNotExist(err) {
		t.Fatalf("retired master key remains: %v", err)
	}
	if _, err := OpenRegistry(directory); err != nil {
		t.Fatal("migration is not idempotent:", err)
	}
}
