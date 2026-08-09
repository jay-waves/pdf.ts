package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

const (
	stateVersion                 = 3
	stateFilename                = "state.json"
	documentCapabilityLifetime   = 30 * 24 * time.Hour
	expiredDocumentSweepInterval = 24 * time.Hour
)

type Document struct {
	ID        string    `json:"id"`
	Path      string    `json:"path"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type persistentState struct {
	Version       int                 `json:"version"`
	ListenAddress string              `json:"listenAddress,omitempty"`
	Documents     map[string]Document `json:"documents"`
}

type Registry struct {
	mutex sync.RWMutex
	path  string
	state persistentState
}

func DefaultStateDir() (string, error) {
	directory, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("locate user configuration directory: %w", err)
	}
	return filepath.Join(directory, "pdf.ts"), nil
}

func OpenRegistry(directory string) (*Registry, error) {
	directory, err := resolveStateDir(directory)
	if err != nil {
		return nil, err
	}
	registry := &Registry{
		path: filepath.Join(directory, stateFilename),
		state: persistentState{
			Version:   stateVersion,
			Documents: make(map[string]Document),
		},
	}
	content, err := os.ReadFile(registry.path)
	switch {
	case err == nil:
		_ = os.Chmod(registry.path, 0o600)
		if err := json.Unmarshal(content, &registry.state); err != nil {
			return nil, fmt.Errorf("decode document registry: %w", err)
		}
		if registry.state.Version != stateVersion {
			return nil, fmt.Errorf("unsupported document registry version %d", registry.state.Version)
		}
		if registry.state.Documents == nil {
			registry.state.Documents = make(map[string]Document)
		}
		migrated := false
		expiresAt := time.Now().Add(documentCapabilityLifetime)
		for id, document := range registry.state.Documents {
			if document.ExpiresAt.IsZero() {
				document.ExpiresAt = expiresAt
				registry.state.Documents[id] = document
				migrated = true
			}
		}
		if migrated {
			if err := registry.writeLocked(); err != nil {
				return nil, fmt.Errorf("migrate document expiration: %w", err)
			}
		}
	case errors.Is(err, os.ErrNotExist):
		// The initial state is persisted when the daemon publishes its endpoint.
	default:
		return nil, fmt.Errorf("read document registry: %w", err)
	}
	return registry, nil
}

func (registry *Registry) Register(target string) (Document, error) {
	canonical, err := ResolveTarget(target)
	if err != nil {
		return Document{}, err
	}

	registry.mutex.Lock()
	defer registry.mutex.Unlock()
	now := time.Now()
	for id, document := range registry.state.Documents {
		if documentExpired(document, now) {
			delete(registry.state.Documents, id)
			continue
		}
		if sameDocumentPath(document.Path, canonical) {
			return document, nil
		}
	}

	id, err := randomID()
	if err != nil {
		return Document{}, fmt.Errorf("create document ID: %w", err)
	}
	document := Document{
		ID:        id,
		Path:      canonical,
		ExpiresAt: now.Add(documentCapabilityLifetime),
	}
	registry.state.Documents[id] = document
	if err := registry.writeLocked(); err != nil {
		delete(registry.state.Documents, id)
		return Document{}, err
	}
	return document, nil
}

func (registry *Registry) Document(id string) (Document, bool) {
	registry.mutex.RLock()
	defer registry.mutex.RUnlock()
	document, found := registry.state.Documents[id]
	if found && documentExpired(document, time.Now()) {
		return Document{}, false
	}
	return document, found
}

func (registry *Registry) RemoveExpired(now time.Time) ([]string, error) {
	registry.mutex.Lock()
	defer registry.mutex.Unlock()

	removed := make(map[string]Document)
	for id, document := range registry.state.Documents {
		if documentExpired(document, now) {
			removed[id] = document
			delete(registry.state.Documents, id)
		}
	}
	if len(removed) == 0 {
		return nil, nil
	}
	if err := registry.writeLocked(); err != nil {
		for id, document := range removed {
			registry.state.Documents[id] = document
		}
		return nil, err
	}
	ids := make([]string, 0, len(removed))
	for id := range removed {
		ids = append(ids, id)
	}
	return ids, nil
}

func (registry *Registry) Endpoint() string {
	registry.mutex.RLock()
	defer registry.mutex.RUnlock()
	return registry.state.ListenAddress
}

func (registry *Registry) SetEndpoint(listenAddress string) error {
	registry.mutex.Lock()
	defer registry.mutex.Unlock()
	registry.state.ListenAddress = listenAddress
	return registry.writeLocked()
}

func (registry *Registry) ClearEndpoint(listenAddress string) error {
	registry.mutex.Lock()
	defer registry.mutex.Unlock()
	if registry.state.ListenAddress != listenAddress {
		return nil
	}
	registry.state.ListenAddress = ""
	return registry.writeLocked()
}

func (registry *Registry) writeLocked() error {
	content, err := json.MarshalIndent(registry.state, "", "  ")
	if err != nil {
		return fmt.Errorf("encode document registry: %w", err)
	}
	content = append(content, '\n')
	if err := writePrivateFileAtomically(filepath.Dir(registry.path), filepath.Base(registry.path), content); err != nil {
		return fmt.Errorf("write document registry: %w", err)
	}
	return nil
}

func sameDocumentPath(left, right string) bool {
	left = filepath.Clean(left)
	right = filepath.Clean(right)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(left, right)
	}
	return left == right
}

func documentExpired(document Document, now time.Time) bool {
	return document.ExpiresAt.IsZero() || !now.Before(document.ExpiresAt)
}
