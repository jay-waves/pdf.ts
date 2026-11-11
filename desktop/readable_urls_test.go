package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

func TestReadableDocumentAliases(t *testing.T) {
	r := &Registry{path: filepath.Join(t.TempDir(), "state.json"), state: persistentState{Version: stateVersion, Documents: map[string]Document{}}}
	name := "中文 #100%.pdf"
	first := Document{ID: "original-id", Path: filepath.Join("books", name), Alias: r.availableAliasLocked(name), ExpiresAt: time.Now().Add(time.Hour)}
	r.state.Documents[first.ID] = first
	if got := r.availableAliasLocked(name); got != "中文 #100%~2.pdf" {
		t.Fatalf("collision alias: %q", got)
	}
	for _, key := range []string{first.ID, first.Alias} {
		got, ok := r.Document(key)
		if !ok || got.ID != first.ID {
			t.Fatalf("lookup %q: %+v", key, got)
		}
	}
	if err := r.writeLocked(); err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(r.path)
	if err != nil {
		t.Fatal(err)
	}
	var restored persistentState
	if err := json.Unmarshal(content, &restored); err != nil {
		t.Fatal(err)
	}
	if restored.Documents[first.ID].Alias != name {
		t.Fatal("alias not persisted")
	}
	first.ExpiresAt = time.Now().Add(-time.Hour)
	r.state.Documents[first.ID] = first
	if _, ok := r.Document(first.Alias); ok {
		t.Fatal("expired alias resolved")
	}
}

func TestReadableRouteLoadsViewer(t *testing.T) {
	var compressed bytes.Buffer
	writer := gzip.NewWriter(&compressed)
	writer.Write([]byte(`<html><script src="./assets/app.js"></script><link href="./logo.png"></html>`))
	writer.Close()
	handler := viewerAssetHandler{files: fstest.MapFS{"index.html.gz": &fstest.MapFile{Data: compressed.Bytes()}}}
	for _, method := range []string{"GET", "HEAD"} {
		request := httptest.NewRequest(method, "/read/"+url.PathEscape("中文 #100%.pdf"), nil)
		request.Header.Set("Accept-Encoding", "gzip")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != 200 {
			t.Fatalf("%s: %d", method, response.Code)
		}
		if !strings.HasPrefix(response.Header().Get("Content-Type"), "text/html") {
			t.Fatal("not HTML")
		}
		if method == "GET" && !strings.Contains(response.Body.String(), `src="/assets/app.js"`) {
			t.Fatal("relative assets not rebased")
		}
		if method == "HEAD" && response.Body.Len() != 0 {
			t.Fatal("HEAD returned body")
		}
	}
}

func TestViewerAssetCachePolicy(t *testing.T) {
	var compressed bytes.Buffer
	writer := gzip.NewWriter(&compressed)
	writer.Write([]byte("asset"))
	writer.Close()
	files := fstest.MapFS{}
	for _, name := range []string{"index.html", "assets/embedpdf-BzwSuc3l.wasm", "assets/app.js"} {
		files[name+".gz"] = &fstest.MapFile{Data: compressed.Bytes()}
	}
	handler := newViewerAssetHandler(files)
	for _, tc := range []struct{ path, want string }{
		{"/", "no-cache"}, {"/read/document.pdf", "no-cache"},
		{"/assets/app.js", "no-cache"},
		{"/assets/embedpdf-BzwSuc3l.wasm", "public, max-age=31536000, immutable"},
	} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest("GET", tc.path, nil))
		if got := response.Header().Get("Cache-Control"); got != tc.want {
			t.Fatalf("%s: %q", tc.path, got)
		}
	}
}
