package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
)

var errInvalidPdfIncrement = errors.New("invalid PDF incremental revision")

// ReplacePdfIncrement atomically replaces the previous incremental tail with
// the latest revision produced by PDFium. Only the immutable base prefix is
// copied from the current file, so repeated saves produce A+Rn rather than
// A+R1+...+Rn.
func (resource *Resource) ReplacePdfIncrement(
	response http.ResponseWriter,
	request *http.Request,
) (*WriteResult, *Conflict, error) {
	expected := unquoteETag(request.Header.Get("If-Match"))
	if expected == "" {
		return nil, nil, errPreconditionRequired
	}
	baseVersion := unquoteETag(request.Header.Get("X-Pdf-Ts-Base-Version"))
	if baseVersion == "" {
		return nil, nil, fmt.Errorf("%w: X-Pdf-Ts-Base-Version is required", errInvalidPdfIncrement)
	}
	baseSize, err := strconv.ParseInt(request.Header.Get("X-Pdf-Ts-Base-Size"), 10, 64)
	if err != nil || baseSize <= 0 || baseSize > maxDocumentBytes {
		return nil, nil, fmt.Errorf("%w: X-Pdf-Ts-Base-Size is missing or invalid", errInvalidPdfIncrement)
	}

	unlock, err := acquireDocumentLock(resource.path)
	if err != nil {
		return nil, nil, err
	}
	defer unlock()

	current, err := fileVersion(resource.path)
	if err != nil {
		return nil, nil, fmt.Errorf("fingerprint current document: %w", err)
	}
	if current != expected {
		return nil, &Conflict{
			Code:    "version_conflict",
			Message: "The document changed on disk after it was opened.",
		}, nil
	}

	source, err := os.Open(resource.path)
	if err != nil {
		return nil, nil, fmt.Errorf("open current document: %w", err)
	}
	defer source.Close()
	sourceInfo, err := source.Stat()
	if err != nil {
		return nil, nil, fmt.Errorf("inspect current document: %w", err)
	}
	if sourceInfo.Size() < baseSize {
		return nil, nil, fmt.Errorf(
			"%w: current PDF is shorter than its %d-byte base (%d bytes)",
			errInvalidPdfIncrement,
			baseSize,
			sourceInfo.Size(),
		)
	}

	temp, err := os.CreateTemp(filepath.Dir(resource.path), ".pdf.ts-pdf-increment-*")
	if err != nil {
		return nil, nil, fmt.Errorf("create temporary document: %w", err)
	}
	tempPath := temp.Name()
	keepTemp := false
	defer func() {
		_ = temp.Close()
		if !keepTemp {
			_ = os.Remove(tempPath)
		}
	}()

	baseHash := sha256.New()
	outputHash := sha256.New()
	if _, err := io.CopyN(io.MultiWriter(temp, baseHash, outputHash), source, baseSize); err != nil {
		return nil, nil, fmt.Errorf("copy PDF base: %w", err)
	}
	actualBaseVersion := hex.EncodeToString(baseHash.Sum(nil))
	if actualBaseVersion != baseVersion {
		return nil, nil, fmt.Errorf(
			"%w: PDF base fingerprint does not match the opened document",
			errInvalidPdfIncrement,
		)
	}
	// Windows cannot atomically replace an open destination file.
	if err := source.Close(); err != nil {
		return nil, nil, fmt.Errorf("close current document: %w", err)
	}
	limited := http.MaxBytesReader(response, request.Body, maxDocumentBytes-baseSize)
	written, err := io.Copy(io.MultiWriter(temp, outputHash), limited)
	if err != nil {
		return nil, nil, fmt.Errorf("receive PDF incremental revision: %w", err)
	}
	if written == 0 {
		return nil, nil, fmt.Errorf("%w: refusing to append an empty revision", errInvalidPdfIncrement)
	}
	if err := temp.Chmod(sourceInfo.Mode().Perm()); err != nil {
		return nil, nil, fmt.Errorf("preserve PDF permissions: %w", err)
	}
	if err := temp.Sync(); err != nil {
		return nil, nil, fmt.Errorf("flush temporary document: %w", err)
	}
	if err := temp.Close(); err != nil {
		return nil, nil, fmt.Errorf("close temporary document: %w", err)
	}

	rechecked, err := fileVersion(resource.path)
	if err != nil {
		return nil, nil, fmt.Errorf("recheck current document: %w", err)
	}
	if rechecked != expected {
		return nil, &Conflict{
			Code:    "version_conflict",
			Message: "The document changed on disk while the incremental revision was being saved.",
		}, nil
	}
	if err := atomicReplace(tempPath, resource.path); err != nil {
		return nil, nil, fmt.Errorf("replace document: %w", err)
	}
	keepTemp = true

	version := hex.EncodeToString(outputHash.Sum(nil))
	info, statErr := os.Stat(resource.path)
	resource.mutex.Lock()
	resource.version = version
	if statErr == nil {
		resource.size = info.Size()
		resource.modTime = info.ModTime()
	}
	resource.mutex.Unlock()
	return &WriteResult{Version: version}, nil, nil
}
