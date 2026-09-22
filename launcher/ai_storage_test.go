package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAIConfigPersistsWithEncryptedAPIKey(t *testing.T) {
	directory := t.TempDir()
	registry := &Registry{
		path:  filepath.Join(directory, stateFilename),
		state: persistentState{Version: stateVersion, Documents: make(map[string]Document)},
	}
	want := aiConfig{APIKey: "test-secret-key", BaseURL: "https://example.test/v1", Model: "test-model", Prompt: "Translate: {{selectedText}}"}
	if err := registry.saveAIConfig(want); err != nil {
		t.Fatal(err)
	}

	content, err := os.ReadFile(registry.path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(content), want.APIKey) {
		t.Fatal("state file contains the plaintext API key")
	}
	var state persistentState
	if err := json.Unmarshal(content, &state); err != nil {
		t.Fatal(err)
	}
	reopened := &Registry{path: registry.path, state: state}
	got, err := reopened.loadAIConfig(aiConfig{})
	if err != nil {
		t.Fatal(err)
	}
	if got.APIKey != want.APIKey || got.BaseURL != want.BaseURL || got.Model != want.Model || got.Prompt != want.Prompt {
		t.Fatalf("loaded config = %+v", got)
	}
	info, err := os.Stat(filepath.Join(directory, masterKeyFilename))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("master key permissions = %v", info.Mode().Perm())
	}
}
