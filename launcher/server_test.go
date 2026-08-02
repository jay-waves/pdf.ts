package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDocumentRoutesExposePdfSaveOperations(t *testing.T) {
	path := filepath.Join(t.TempDir(), "document.pdf")
	if err := os.WriteFile(path, []byte("pdf"), 0o600); err != nil {
		t.Fatal(err)
	}
	document := Document{ID: "document", Path: path, ExpiresAt: time.Now().Add(time.Hour)}
	app := &App{
		registry:  &Registry{state: persistentState{Documents: map[string]Document{document.ID: document}}},
		resources: make(map[string]*Resource),
	}

	assertDocumentStatus(t, app, http.MethodHead, "/api/documents/document", http.StatusOK)
	assertDocumentStatus(t, app, http.MethodPut, "/api/documents/document", http.StatusPreconditionRequired)
	assertDocumentStatus(t, app, http.MethodPatch, "/api/documents/document", http.StatusPreconditionRequired)
	assertDocumentStatus(t, app, http.MethodGet, "/api/documents/document/assets/image.png", http.StatusNotFound)
}

func assertDocumentStatus(t *testing.T, app *App, method, target string, expected int) {
	t.Helper()
	response := httptest.NewRecorder()
	app.handleDocument(response, httptest.NewRequest(method, target, nil))
	if response.Code != expected {
		t.Fatalf("%s %s: status=%d, want %d", method, target, response.Code, expected)
	}
}
