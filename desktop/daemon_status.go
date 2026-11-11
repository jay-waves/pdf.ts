package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const daemonStatusFilename = "daemon-status.json"

type DaemonFailure struct {
	Error    string    `json:"error"`
	FailedAt time.Time `json:"failedAt"`
}

func RecordDaemonError(stateDir string, cause error) error {
	if cause == nil {
		return errors.New("daemon error is required")
	}
	directory, err := resolveStateDir(stateDir)
	if err != nil {
		return err
	}
	content, err := json.MarshalIndent(DaemonFailure{
		Error:    cause.Error(),
		FailedAt: time.Now(),
	}, "", "  ")
	if err != nil {
		return fmt.Errorf("encode daemon status: %w", err)
	}
	return writePrivateFileAtomically(filepath.Join(directory, daemonStatusFilename), ".pdf.ts-*", content)
}

func LastDaemonError(stateDir string) (*DaemonFailure, error) {
	directory, err := resolveStateDir(stateDir)
	if err != nil {
		return nil, err
	}
	content, err := os.ReadFile(filepath.Join(directory, daemonStatusFilename))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read daemon status: %w", err)
	}
	var failure DaemonFailure
	if err := json.Unmarshal(content, &failure); err != nil {
		return nil, fmt.Errorf("decode daemon status: %w", err)
	}
	return &failure, nil
}

func ClearDaemonError(stateDir string) error {
	directory, err := resolveStateDir(stateDir)
	if err != nil {
		return err
	}
	if err := os.Remove(filepath.Join(directory, daemonStatusFilename)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("clear daemon status: %w", err)
	}
	return nil
}

func resolveStateDir(directory string) (string, error) {
	if directory == "" {
		var err error
		directory, err = DefaultStateDir()
		if err != nil {
			return "", err
		}
	}
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return "", fmt.Errorf("create state directory: %w", err)
	}
	_ = os.Chmod(directory, 0o700)
	return directory, nil
}
