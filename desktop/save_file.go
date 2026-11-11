package main

import (
	"fmt"
	"os"
	"path/filepath"
)

// A private directory makes the not-yet-existing clone destination safe on
// platforms whose clone API creates the file itself. It is on the same volume.
func createSaveFile(source string) (*os.File, func(), error) {
	dir, err := os.MkdirTemp(filepath.Dir(source), ".pdf.ts-save-*")
	if err != nil {
		return nil, nil, err
	}
	cleanup := func() { _ = os.RemoveAll(dir) }
	path := filepath.Join(dir, "document")
	cloned := cloneSaveFile(source, path) == nil
	if !cloned {
		// A failed clone may have created or partially populated the destination.
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			cleanup()
			return nil, nil, err
		}
	}
	// macOS clones inherit source permissions; make the private staging file
	// writable before opening it. Replace restores the original mode at commit.
	if cloned {
		if err := os.Chmod(path, 0600); err != nil {
			cleanup()
			return nil, nil, err
		}
	}
	flags := os.O_RDWR
	if !cloned {
		flags |= os.O_CREATE | os.O_EXCL
	}
	file, err := os.OpenFile(path, flags, 0600)
	if err != nil {
		cleanup()
		return nil, nil, err
	}
	return file, cleanup, nil
}

func writePrivateFileAtomically(path, pattern string, content []byte) error {
	temp, err := os.CreateTemp(filepath.Dir(path), pattern)
	if err != nil {
		return fmt.Errorf("create temporary private file: %w", err)
	}
	tempPath := temp.Name()
	defer func() {
		_ = temp.Close()
		_ = os.Remove(tempPath)
	}()
	if err := temp.Chmod(0o600); err != nil {
		return fmt.Errorf("protect private file: %w", err)
	}
	if _, err := temp.Write(content); err != nil {
		return fmt.Errorf("write private file: %w", err)
	}
	if err := temp.Sync(); err != nil {
		return fmt.Errorf("flush private file: %w", err)
	}
	if err := temp.Close(); err != nil {
		return fmt.Errorf("close private file: %w", err)
	}
	if err := atomicReplace(tempPath, path); err != nil {
		return fmt.Errorf("replace private file: %w", err)
	}
	return nil
}
