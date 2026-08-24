package main

import "testing"

func TestWelcomeURLUsesPublicHostAndDaemonPort(t *testing.T) {
	directory := t.TempDir()
	registry, err := OpenRegistry(directory)
	if err != nil {
		t.Fatal(err)
	}
	if err := registry.SetEndpoint("127.0.0.1:34567"); err != nil {
		t.Fatal(err)
	}
	viewerURL, err := WelcomeURL(directory)
	if err != nil {
		t.Fatal(err)
	}
	if viewerURL != "http://pdf.ts.localhost:34567/" {
		t.Fatalf("WelcomeURL() = %q", viewerURL)
	}
}
