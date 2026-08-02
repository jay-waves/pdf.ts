package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestServeRefreshesVersionAfterExternalChange(t *testing.T) {
	path := filepath.Join(t.TempDir(), "document.pdf")
	if err := os.WriteFile(path, []byte("version one"), 0o600); err != nil {
		t.Fatal(err)
	}
	resource, err := NewResource(path)
	if err != nil {
		t.Fatal(err)
	}
	first := httptest.NewRecorder()
	if err := resource.Serve(first, httptest.NewRequest(http.MethodHead, "/resource", nil)); err != nil {
		t.Fatal(err)
	}
	firstVersion := first.Header().Get("ETag")

	if err := os.WriteFile(path, []byte("a different version"), 0o600); err != nil {
		t.Fatal(err)
	}
	// Some file systems have coarse timestamp resolution. Force a distinct
	// timestamp as well as a distinct size so the metadata cache is invalidated.
	changed := time.Now().Add(2 * time.Second)
	if err := os.Chtimes(path, changed, changed); err != nil {
		t.Fatal(err)
	}
	second := httptest.NewRecorder()
	if err := resource.Serve(second, httptest.NewRequest(http.MethodHead, "/resource", nil)); err != nil {
		t.Fatal(err)
	}
	secondVersion := second.Header().Get("ETag")
	if secondVersion == "" || secondVersion == firstVersion {
		t.Fatalf("ETag did not refresh after external change: %q", secondVersion)
	}
}

func TestServeReportsDocumentFilename(t *testing.T) {
	path := filepath.Join(t.TempDir(), "reader copy.epub")
	if err := os.WriteFile(path, []byte("epub"), 0o600); err != nil {
		t.Fatal(err)
	}
	resource, err := NewResource(path)
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	if err := resource.Serve(response, httptest.NewRequest(http.MethodHead, "/resource", nil)); err != nil {
		t.Fatal(err)
	}
	if disposition := response.Header().Get("Content-Disposition"); disposition !=
		`inline; filename="reader copy.epub"; filename*=UTF-8''reader%20copy.epub` {
		t.Fatalf("unexpected Content-Disposition: %q", disposition)
	}
}

func TestServeEncodesUnicodeDocumentFilename(t *testing.T) {
	path := filepath.Join(t.TempDir(), "中文 书.epub")
	if err := os.WriteFile(path, []byte("epub"), 0o600); err != nil {
		t.Fatal(err)
	}
	resource, err := NewResource(path)
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	if err := resource.Serve(response, httptest.NewRequest(http.MethodHead, "/resource", nil)); err != nil {
		t.Fatal(err)
	}
	const expected = `inline; filename="__ _.epub"; filename*=UTF-8''%E4%B8%AD%E6%96%87%20%E4%B9%A6.epub`
	if disposition := response.Header().Get("Content-Disposition"); disposition != expected {
		t.Fatalf("unexpected Content-Disposition: %q", disposition)
	}
}

func TestReplaceChecksVersion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "document.pdf")
	if err := os.WriteFile(path, []byte("version one"), 0o600); err != nil {
		t.Fatal(err)
	}
	resource, err := NewResource(path)
	if err != nil {
		t.Fatal(err)
	}
	version, err := fileVersion(path)
	if err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodPut, "/resource", bytes.NewBufferString("version two"))
	request.Header.Set("If-Match", quoteETag(version))
	result, conflict, err := resource.Replace(httptest.NewRecorder(), request)
	if err != nil || conflict != nil {
		t.Fatalf("replace: result=%v conflict=%v err=%v", result, conflict, err)
	}
	if result.Version == version {
		t.Fatal("version did not change after replacement")
	}

	staleRequest := httptest.NewRequest(http.MethodPut, "/resource", bytes.NewBufferString("stale edit"))
	staleRequest.Header.Set("If-Match", quoteETag(version))
	_, conflict, err = resource.Replace(httptest.NewRecorder(), staleRequest)
	if err != nil {
		t.Fatal(err)
	}
	if conflict == nil || conflict.Code != "version_conflict" {
		t.Fatalf("expected version conflict, got %#v", conflict)
	}
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "version two" {
		t.Fatalf("stale write changed the original: %q", content)
	}
}

func TestConflictCopyDoesNotOverwriteOriginal(t *testing.T) {
	path := filepath.Join(t.TempDir(), "book.epub")
	if err := os.WriteFile(path, []byte("original"), 0o600); err != nil {
		t.Fatal(err)
	}
	resource, err := NewResource(path)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/resource/copy", bytes.NewBufferString("edited"))
	result, err := resource.SaveConflictCopy(httptest.NewRecorder(), request)
	if err != nil {
		t.Fatal(err)
	}
	copyContent, err := os.ReadFile(filepath.Join(filepath.Dir(path), result.Name))
	if err != nil {
		t.Fatal(err)
	}
	if string(copyContent) != "edited" {
		t.Fatalf("unexpected copy content: %q", copyContent)
	}
	original, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(original) != "original" {
		t.Fatalf("original was overwritten: %q", original)
	}
}
