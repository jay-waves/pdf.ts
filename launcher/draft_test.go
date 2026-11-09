package main

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestDraftLifecycleAndConflicts(t *testing.T) {
	path := filepath.Join(t.TempDir(), "book.pdf")
	original := []byte("original PDF bytes")
	if err := os.WriteFile(path, original, 0600); err != nil {
		t.Fatal(err)
	}
	resource, err := NewResource(path)
	if err != nil {
		t.Fatal(err)
	}
	base, _ := fileVersion(path)
	app := &App{}
	call := func(method, token, baseVersion, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "/draft", bytes.NewBufferString(body))
		if token != "" {
			req.Header.Set("If-Match", quoteETag(token))
		}
		req.Header.Set("X-Pdf-Ts-Version", baseVersion)
		response := httptest.NewRecorder()
		app.handleDraft(resource, response, req)
		return response
	}
	if r := call("GET", "", "", ""); r.Code != 204 {
		t.Fatal(r.Code, r.Body.String())
	}
	body := fmt.Sprintf(`{"format":"pdf.ts/swp","version":1,"baseVersion":%q,"revision":1,"targets":[],"upsert":[],"removed":[],"formValues":{}}`, base)
	if r := call("PUT", "", base, body); r.Code != 428 {
		t.Fatal(r.Code)
	}
	saved := call("PUT", "missing", base, body)
	if saved.Code != 204 {
		t.Fatal(saved.Code, saved.Body.String())
	}
	token := unquoteETag(saved.Header().Get("ETag"))
	contents, err := os.ReadFile(path + ".swp")
	if err != nil || string(contents) != body {
		t.Fatal(err, string(contents))
	}
	unchanged, _ := os.ReadFile(path)
	if !bytes.Equal(unchanged, original) {
		t.Fatal("autosave modified the PDF")
	}
	if r := call("GET", "", "", ""); r.Body.String() != body {
		t.Fatal("draft did not round trip")
	}
	if r := call("PUT", "missing", base, body); r.Code != 409 {
		t.Fatal("stale writer accepted", r.Code)
	}
	if r := call("DELETE", "missing", "", ""); r.Code != 409 {
		t.Fatal("stale deletion accepted", r.Code)
	}
	if err := os.WriteFile(path, []byte("externally changed PDF"), 0600); err != nil {
		t.Fatal(err)
	}
	updatedBody := bytes.ReplaceAll([]byte(body), []byte(`"revision":1`), []byte(`"revision":2`))
	updated := call("PUT", token, base, string(updatedBody))
	if updated.Code != 204 {
		t.Fatal("edits against the original base must remain saveable", updated.Code, updated.Body.String())
	}
	if r := call("PUT", token, base, body); r.Code != 409 {
		t.Fatal("stale draft writer accepted after PDF change", r.Code)
	}
	token = unquoteETag(updated.Header().Get("ETag"))
	if r := call("GET", "", "", ""); r.Body.String() != string(updatedBody) {
		t.Fatal("draft lost its original base or new edits")
	}
	request := httptest.NewRequest(http.MethodPut, "/resource", bytes.NewBufferString("edited original"))
	request.Header.Set("If-Match", quoteETag(base))
	_, conflict, err := resource.Replace(httptest.NewRecorder(), request)
	if err != nil || conflict == nil || conflict.Code != "version_conflict" {
		t.Fatalf("saving an old-base draft must not authorize PDF replacement: conflict=%v err=%v", conflict, err)
	}
	current, err := os.ReadFile(path)
	if err != nil || string(current) != "externally changed PDF" {
		t.Fatal("external PDF was overwritten", err)
	}
	// Removing the PDF makes any accidental full-file read fail deterministically.
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if r := call("PUT", token, base, string(updatedBody)); r.Code != 204 {
		t.Fatal("draft writes must not read the PDF", r.Code, r.Body.String())
	}
	if r := call("DELETE", token, "", ""); r.Code != 204 {
		t.Fatal(r.Code)
	}
	if _, err := os.Stat(path + ".swp"); !os.IsNotExist(err) {
		t.Fatal("draft not removed", err)
	}
}
func TestForeignSwapFileIsNotOverwritten(t *testing.T) {
	path := filepath.Join(t.TempDir(), "book.pdf")
	os.WriteFile(path, []byte("pdf"), 0600)
	os.WriteFile(path+".swp", []byte("another application's data"), 0600)
	resource, _ := NewResource(path)
	req := httptest.NewRequest(http.MethodPut, "/draft", bytes.NewBufferString("{}"))
	req.Header.Set("If-Match", `"missing"`)
	response := httptest.NewRecorder()
	(&App{}).handleDraft(resource, response, req)
	if response.Code != 409 {
		t.Fatal(response.Code)
	}
	data, _ := os.ReadFile(path + ".swp")
	if string(data) != "another application's data" {
		t.Fatal("foreign file changed")
	}
}

func TestDraftDiskGrowthIsExactlyLatestSidecar(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "book.pdf")
	original := bytes.Repeat([]byte("original PDF bytes\n"), 65536)
	if err := os.WriteFile(path, original, 0600); err != nil {
		t.Fatal(err)
	}
	resource, err := NewResource(path)
	if err != nil {
		t.Fatal(err)
	}
	token := missingDraftVersion
	// Grow, shrink, then repeat: writes must replace, truncate and clean up temps.
	for _, note := range []string{"批注", "a longer annotation", "短", "短"} {
		body := fmt.Sprintf(`{"format":"pdf.ts/swp","version":1,"engine":3,"baseVersion":%q,"revision":1,"formValues":{"Name":{"value":%q}}}`, resource.version, note)
		request := httptest.NewRequest(http.MethodPut, "/draft", bytes.NewBufferString(body))
		request.Header.Set("If-Match", quoteETag(token))
		request.Header.Set("X-Pdf-Ts-Version", resource.version)
		response := httptest.NewRecorder()
		(&App{}).handleDraft(resource, response, request)
		if response.Code != http.StatusNoContent {
			t.Fatal(response.Code, response.Body.String())
		}
		token = unquoteETag(response.Header().Get("ETag"))
		pdf, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(pdf, original) {
			t.Fatal("draft write changed the original PDF", err)
		}
		sidecar, err := os.ReadFile(path + ".swp")
		if err != nil || string(sidecar) != body {
			t.Fatal("sidecar must contain exactly the latest draft", err)
		}
		entries, err := os.ReadDir(directory)
		if err != nil {
			t.Fatal(err)
		}
		if len(entries) != 2 {
			t.Fatalf("expected only PDF and sidecar, found %d entries", len(entries))
		}
		var total int64
		for _, entry := range entries {
			info, err := entry.Info()
			if err != nil {
				t.Fatal(err)
			}
			total += info.Size()
		}
		if growth := total - int64(len(original)); growth != int64(len([]byte(body))) {
			t.Fatalf("disk growth = %d bytes, want exactly %d draft bytes", growth, len([]byte(body)))
		}
	}
}
