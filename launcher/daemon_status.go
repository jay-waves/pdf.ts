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
	return writePrivateFileAtomically(directory, daemonStatusFilename, content)
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

func writePrivateFileAtomically(directory, name string, content []byte) error {
	temp, err := os.CreateTemp(directory, ".pdf.ts-status-*")
	if err != nil {
		return fmt.Errorf("create temporary daemon status: %w", err)
	}
	tempPath := temp.Name()
	defer func() {
		_ = temp.Close()
		_ = os.Remove(tempPath)
	}()
	if err := temp.Chmod(0o600); err != nil {
		return fmt.Errorf("protect daemon status: %w", err)
	}
	if _, err := temp.Write(content); err != nil {
		return fmt.Errorf("write daemon status: %w", err)
	}
	if err := temp.Sync(); err != nil {
		return fmt.Errorf("flush daemon status: %w", err)
	}
	if err := temp.Close(); err != nil {
		return fmt.Errorf("close daemon status: %w", err)
	}
	if err := atomicReplace(tempPath, filepath.Join(directory, name)); err != nil {
		return fmt.Errorf("replace daemon status: %w", err)
	}
	return nil
}
