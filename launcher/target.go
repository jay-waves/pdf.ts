package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func ResolveTarget(argument string) (string, error) {
	raw := strings.TrimSpace(strings.Trim(argument, `"`))
	if raw == "" {
		return "", errors.New("empty document target")
	}
	absolute, err := filepath.Abs(filepath.FromSlash(raw))
	if err != nil {
		return "", fmt.Errorf("resolve absolute path: %w", err)
	}
	canonical, err := filepath.EvalSymlinks(absolute)
	if err != nil {
		return "", fmt.Errorf("resolve document path: %w", err)
	}
	info, err := os.Stat(canonical)
	if err != nil {
		return "", fmt.Errorf("inspect document: %w", err)
	}
	if !info.Mode().IsRegular() {
		return "", errors.New("document target must be a regular file")
	}
	if !strings.EqualFold(filepath.Ext(canonical), ".pdf") {
		return "", errors.New("pdf.ts only opens PDF files")
	}
	return canonical, nil
}
