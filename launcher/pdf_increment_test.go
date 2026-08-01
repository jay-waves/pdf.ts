package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

func TestReplacePdfIncrementReplacesPreviousTail(t *testing.T) {
	const base = "immutable PDF base"
	path := filepath.Join(t.TempDir(), "document.pdf")
	if err := os.WriteFile(path, []byte(base), 0o600); err != nil {
		t.Fatal(err)
	}
	resource, err := NewResource(path)
	if err != nil {
		t.Fatal(err)
	}
	baseVersion, err := fileVersion(path)
	if err != nil {
		t.Fatal(err)
	}

	saveRevision := func(currentVersion, revision string) *WriteResult {
		t.Helper()
		request := httptest.NewRequest(http.MethodPatch, "/resource", bytes.NewBufferString(revision))
		request.Header.Set("If-Match", quoteETag(currentVersion))
		request.Header.Set("X-Pdf-Ts-Base-Version", quoteETag(baseVersion))
		request.Header.Set("X-Pdf-Ts-Base-Size", strconv.Itoa(len(base)))
		result, conflict, err := resource.ReplacePdfIncrement(httptest.NewRecorder(), request)
		if err != nil || conflict != nil {
			t.Fatalf("save %q: result=%v conflict=%v err=%v", revision, result, conflict, err)
		}
		return result
	}

	first := saveRevision(baseVersion, "-revision-one")
	if content, err := os.ReadFile(path); err != nil {
		t.Fatal(err)
	} else if string(content) != base+"-revision-one" {
		t.Fatalf("first save = %q", content)
	}

	second := saveRevision(first.Version, "-revision-two")
	if second.Version == first.Version {
		t.Fatal("second revision did not change the document version")
	}
	if content, err := os.ReadFile(path); err != nil {
		t.Fatal(err)
	} else if string(content) != base+"-revision-two" {
		t.Fatalf("second save retained the previous tail: %q", content)
	}
}
