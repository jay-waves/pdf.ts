package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

var allowedExtensions = map[string]bool{
	".pdf": true,
}

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
	if !allowedExtensions[strings.ToLower(filepath.Ext(canonical))] {
		return "", errors.New("pdf.ts only opens PDF files")
	}
	return canonical, nil
}
