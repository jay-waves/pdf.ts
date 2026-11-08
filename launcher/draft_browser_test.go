package main

import (
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// Opt-in integration check reuses the running Vite server and system Chrome.
// PDF_TS_BROWSER_TEST=1 go test ./launcher -run TestDraftBrowser -v
func TestDraftBrowser(t *testing.T) {
	if os.Getenv("PDF_TS_BROWSER_TEST") != "1" {
		t.Skip("requires running Vite and system Chrome")
	}
	bytes, err := exec.Command("node", "--input-type=module", "-e", "import {fixture} from '../scripts/pdf-editing-fixture.mjs'; process.stdout.write(fixture());").Output()
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "book.pdf")
	if err := os.WriteFile(path, bytes, 0600); err != nil {
		t.Fatal(err)
	}
	resource, err := NewResource(path)
	if err != nil {
		t.Fatal(err)
	}
	document := Document{ID: "draft-browser", Path: path, ExpiresAt: time.Now().Add(time.Hour)}
	app := &App{registry: &Registry{state: persistentState{Documents: map[string]Document{document.ID: document}}}, resources: map[string]*Resource{document.ID: resource}}
	dev := os.Getenv("PDF_TEST_URL")
	if dev == "" {
		dev = "http://127.0.0.1:5173"
	}
	target, err := url.Parse(dev)
	if err != nil {
		t.Fatal(err)
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	mux := http.NewServeMux()
	mux.HandleFunc("/api/documents/", app.handleDocument)
	mux.Handle("/", proxy)
	server := httptest.NewServer(mux)
	defer server.Close()
	app.origin = server.URL
	cmd := exec.Command("node", "../scripts/check-draft-launcher.mjs")
	cmd.Env = append(os.Environ(), "PDF_TEST_URL="+server.URL, "PDF_TEST_FILE="+path)
	output, err := cmd.CombinedOutput()
	t.Log(string(output))
	if err != nil {
		t.Fatal(err)
	}
}
