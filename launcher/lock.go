package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const lockWait = 10 * time.Second

var errDocumentLocked = errors.New("another pdf.ts process is currently writing this document")

func acquireDocumentLock(documentPath string) (func(), error) {
	cache, err := os.UserCacheDir()
	if err != nil {
		return nil, fmt.Errorf("locate cache directory: %w", err)
	}
	sum := sha256.Sum256([]byte(filepath.Clean(documentPath)))
	lockRoot := filepath.Join(cache, "pdf.ts", "locks")
	if err := os.MkdirAll(lockRoot, 0o700); err != nil {
		return nil, fmt.Errorf("create lock directory: %w", err)
	}
	lockPath := filepath.Join(lockRoot, hex.EncodeToString(sum[:])+".lock")
	deadline := time.Now().Add(lockWait)
	for {
		file, err := os.OpenFile(lockPath, os.O_RDWR|os.O_CREATE, 0o600)
		if err != nil {
			return nil, fmt.Errorf("open document lock: %w", err)
		}
		locked, lockErr := tryFileLock(file)
		if lockErr != nil {
			_ = file.Close()
			return nil, fmt.Errorf("acquire document lock: %w", lockErr)
		}
		if locked {
			return func() {
				_ = unlockFile(file)
				_ = file.Close()
			}, nil
		}
		_ = file.Close()
		if time.Now().After(deadline) {
			return nil, errDocumentLocked
		}
		time.Sleep(50 * time.Millisecond)
	}
}
