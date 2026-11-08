package main

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestSaveFileCloneOrFallbackLeavesSourceIntact(t *testing.T) {
	source := filepath.Join(t.TempDir(), "source.pdf")
	original := bytes.Repeat([]byte("x"), 256*1024)
	if err := os.WriteFile(source, original, 0600); err != nil {
		t.Fatal(err)
	}
	file, cleanup, err := createSaveFile(source)
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	defer file.Close()
	next := []byte("shorter complete PDF output")
	n, err := io.Copy(file, bytes.NewReader(next))
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Truncate(n); err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(source)
	if err != nil || !bytes.Equal(actual, original) {
		t.Fatalf("source changed before commit: %v", err)
	}
	saved, err := os.ReadFile(file.Name())
	if err != nil || !bytes.Equal(saved, next) {
		t.Fatalf("saved output mismatch: %v", err)
	}
}
