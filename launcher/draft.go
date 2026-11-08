package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
)

const maxDraftBytes int64 = 64 << 20
const missingDraftVersion = "missing"

func readDraft(path string) ([]byte, string, error) {
	file, err := os.Open(path)
	if os.IsNotExist(err) {
		return nil, missingDraftVersion, nil
	}
	if err != nil {
		return nil, "", err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, "", err
	}
	if !info.Mode().IsRegular() || info.Size() > maxDraftBytes {
		return nil, "", errors.New("the .swp file is not a supported draft")
	}
	data, err := io.ReadAll(io.LimitReader(file, maxDraftBytes+1))
	if err != nil {
		return nil, "", err
	}
	if int64(len(data)) > maxDraftBytes {
		return nil, "", errors.New("draft exceeds size limit")
	}
	sum := sha256.Sum256(data)
	return data, hex.EncodeToString(sum[:]), nil
}

// Drafts are opaque, versioned edit data. The launcher never edits PDF objects.
func (app *App) handleDraft(resource *Resource, response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet && request.Method != http.MethodPut && request.Method != http.MethodDelete {
		response.Header().Set("Allow", "GET, PUT, DELETE")
		http.Error(response, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !app.sameOrigin(request) {
		writeJSONError(response, http.StatusForbidden, "forbidden_origin", "The draft request did not come from this pdf.ts page.")
		return
	}
	unlock, err := acquireDocumentLock(resource.path)
	if err != nil {
		writeMutationError(response, err, "draft_failed")
		return
	}
	defer unlock()
	path := resource.path + ".swp"
	// Do not follow another application's swap-file symlink for either reads or writes.
	if info, err := os.Lstat(path); err == nil && !info.Mode().IsRegular() {
		writeJSONError(response, http.StatusConflict, "draft_conflict", "The .swp path is not a regular draft file.")
		return
	}
	data, version, err := readDraft(path)
	if err != nil {
		writeMutationError(response, err, "draft_failed")
		return
	}
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("ETag", quoteETag(version))
	if request.Method == http.MethodGet {
		if data == nil {
			response.WriteHeader(http.StatusNoContent)
			return
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write(data)
		return
	}
	expected := unquoteETag(request.Header.Get("If-Match"))
	if expected == "" {
		writeMutationError(response, errPreconditionRequired, "draft_failed")
		return
	}
	if expected != version {
		writeJSONError(response, http.StatusConflict, "draft_conflict", "The .swp draft changed in another session.")
		return
	}
	if request.Method == http.MethodDelete {
		if version != missingDraftVersion {
			if err := os.Remove(path); err != nil {
				writeMutationError(response, err, "draft_failed")
				return
			}
		}
		response.Header().Set("ETag", quoteETag(missingDraftVersion))
		response.WriteHeader(http.StatusNoContent)
		return
	}
	incoming, err := io.ReadAll(http.MaxBytesReader(response, request.Body, maxDraftBytes))
	if err != nil {
		writeJSONError(response, http.StatusRequestEntityTooLarge, "draft_too_large", "The draft exceeds the size limit.")
		return
	}
	var envelope struct {
		Format      string `json:"format"`
		Version     int    `json:"version"`
		BaseVersion string `json:"baseVersion"`
	}
	if json.Unmarshal(incoming, &envelope) != nil || envelope.Format != "pdf.ts/swp" || envelope.Version != 1 || envelope.BaseVersion == "" || envelope.BaseVersion != request.Header.Get("X-Pdf-Ts-Version") {
		writeJSONError(response, http.StatusBadRequest, "invalid_draft", "Invalid pdf.ts .swp draft.")
		return
	}
	current, err := fileVersion(resource.path)
	if err != nil {
		writeMutationError(response, err, "draft_failed")
		return
	}
	if current != envelope.BaseVersion {
		writeJSONError(response, http.StatusConflict, "version_conflict", "The PDF changed before its draft could be saved.")
		return
	}
	if err := writeDraft(path, incoming); err != nil {
		writeMutationError(response, err, "draft_failed")
		return
	}
	sum := sha256.Sum256(incoming)
	response.Header().Set("ETag", quoteETag(hex.EncodeToString(sum[:])))
	response.WriteHeader(http.StatusNoContent)
}

func writeDraft(path string, data []byte) error {
	file, err := os.CreateTemp(filepath.Dir(path), ".pdf.ts-draft-*")
	if err != nil {
		return err
	}
	defer func() { _ = file.Close(); _ = os.Remove(file.Name()) }()
	if _, err := file.Write(data); err != nil {
		return fmt.Errorf("write draft: %w", err)
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return atomicReplace(file.Name(), path)
}
