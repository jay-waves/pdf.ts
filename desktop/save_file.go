package main

import (
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
