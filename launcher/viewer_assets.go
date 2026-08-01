package main

import (
	"bytes"
	"compress/gzip"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"
)

type viewerAssetHandler struct {
	files fs.FS
}

func newViewerAssetHandler(files fs.FS) http.Handler {
	return viewerAssetHandler{files: files}
}

func (handler viewerAssetHandler) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		response.Header().Set("Allow", "GET, HEAD")
		http.Error(response, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	name := strings.TrimPrefix(path.Clean("/"+request.URL.Path), "/")
	if name == "." || name == "" {
		name = "index.html"
	} else if strings.HasSuffix(request.URL.Path, "/") {
		name = path.Join(name, "index.html")
	}
	if !fs.ValidPath(name) {
		http.NotFound(response, request)
		return
	}

	compressed, err := fs.ReadFile(handler.files, name+".gz")
	if err != nil {
		http.NotFound(response, request)
		return
	}

	content := compressed
	response.Header().Set("Vary", "Accept-Encoding")
	if acceptsGzip(request.Header.Values("Accept-Encoding")) {
		response.Header().Set("Content-Encoding", "gzip")
	} else {
		reader, err := gzip.NewReader(bytes.NewReader(compressed))
		if err != nil {
			http.Error(response, "invalid embedded asset", http.StatusInternalServerError)
			return
		}
		content, err = io.ReadAll(reader)
		closeErr := reader.Close()
		if err != nil || closeErr != nil {
			http.Error(response, "invalid embedded asset", http.StatusInternalServerError)
			return
		}
	}

	contentType := mime.TypeByExtension(path.Ext(name))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	response.Header().Set("Content-Type", contentType)
	http.ServeContent(response, request, name, time.Time{}, bytes.NewReader(content))
}

func acceptsGzip(values []string) bool {
	for _, value := range values {
		for _, item := range strings.Split(value, ",") {
			parts := strings.Split(item, ";")
			encoding := strings.TrimSpace(parts[0])
			if !strings.EqualFold(encoding, "gzip") && encoding != "*" {
				continue
			}
			quality := 1.0
			for _, parameter := range parts[1:] {
				key, raw, found := strings.Cut(strings.TrimSpace(parameter), "=")
				if !found || !strings.EqualFold(strings.TrimSpace(key), "q") {
					continue
				}
				parsed, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
				if err != nil {
					quality = 0
				} else {
					quality = parsed
				}
			}
			if quality > 0 {
				return true
			}
		}
	}
	return false
}
