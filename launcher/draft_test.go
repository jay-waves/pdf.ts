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
	if r := call("PUT", token, base, body); r.Code != 409 {
		t.Fatal("changed PDF accepted", r.Code)
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
