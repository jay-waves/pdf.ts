package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

const (
	masterKeyFilename = "master.key"
	masterKeySize     = 32
)

type storedAIConfig struct {
	APIKey  string `json:"apiKey,omitempty"`
	BaseURL string `json:"baseUrl,omitempty"`
	Model   string `json:"model,omitempty"`
	Prompt  string `json:"prompt,omitempty"`
}

func (registry *Registry) loadAIConfig(defaults aiConfig) (aiConfig, error) {
	stored := registry.state.AI
	if stored == nil {
		return defaults, nil
	}
	config := defaults
	config.BaseURL = stored.BaseURL
	config.Model = stored.Model
	config.Prompt = stored.Prompt
	if config.Prompt == "" {
		config.Prompt = defaultTranslationPrompt
	}
	if stored.APIKey != "" {
		key, err := registry.readMasterKey(false)
		if err != nil {
			return defaults, err
		}
		config.APIKey, err = decryptAPIKey(key, stored.APIKey)
		if err != nil {
			return defaults, fmt.Errorf("decrypt AI API key: %w", err)
		}
	}
	return config, nil
}

func (registry *Registry) saveAIConfig(config aiConfig) error {
	stored := &storedAIConfig{BaseURL: config.BaseURL, Model: config.Model, Prompt: config.Prompt}
	if config.APIKey != "" {
		key, err := registry.readMasterKey(true)
		if err != nil {
			return err
		}
		stored.APIKey, err = encryptAPIKey(key, config.APIKey)
		if err != nil {
			return fmt.Errorf("encrypt AI API key: %w", err)
		}
	}
	registry.mutex.Lock()
	defer registry.mutex.Unlock()
	previous := registry.state.AI
	registry.state.AI = stored
	if err := registry.writeLocked(); err != nil {
		registry.state.AI = previous
		return err
	}
	return nil
}

func (registry *Registry) readMasterKey(create bool) ([]byte, error) {
	path := filepath.Join(filepath.Dir(registry.path), masterKeyFilename)
	key, err := os.ReadFile(path)
	if err == nil {
		_ = os.Chmod(path, 0o600)
		if len(key) != masterKeySize {
			return nil, errors.New("AI master key has an invalid size")
		}
		return key, nil
	}
	if !errors.Is(err, os.ErrNotExist) || !create {
		return nil, fmt.Errorf("read AI master key: %w", err)
	}
	key = make([]byte, masterKeySize)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		return nil, fmt.Errorf("generate AI master key: %w", err)
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if errors.Is(err, os.ErrExist) {
		return registry.readMasterKey(false)
	}
	if err != nil {
		return nil, fmt.Errorf("create AI master key: %w", err)
	}
	if _, err = file.Write(key); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(path)
		return nil, fmt.Errorf("write AI master key: %w", err)
	}
	return key, nil
}

func encryptAPIKey(key []byte, value string) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := aead.Seal(nonce, nonce, []byte(value), nil)
	return base64.RawStdEncoding.EncodeToString(sealed), nil
}

func decryptAPIKey(key []byte, encoded string) (string, error) {
	sealed, err := base64.RawStdEncoding.DecodeString(encoded)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(sealed) < aead.NonceSize() {
		return "", errors.New("encrypted API key is truncated")
	}
	plain, err := aead.Open(nil, sealed[:aead.NonceSize()], sealed[aead.NonceSize():], nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}
