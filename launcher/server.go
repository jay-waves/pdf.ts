package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	DefaultListenAddress = "127.0.0.1:23119"
	DefaultPublicHost    = "pdf.ts.localhost"
)

type Options struct {
	ListenAddress string
	PublicHost    string
	StateDir      string
}

type App struct {
	options    Options
	registry   *Registry
	resources  map[string]*Resource
	mutex      sync.Mutex
	server     *http.Server
	listener   net.Listener
	origin     string
	done       chan error
	closeOnce  sync.Once
	stopTasks  context.CancelFunc
	daemonLock *os.File
}

type openResult struct {
	ID   string `json:"id"`
	URL  string `json:"url"`
	Name string `json:"name"`
	Kind string `json:"kind"`
}

func New(options Options) (*App, error) {
	if options.ListenAddress == "" {
		options.ListenAddress = DefaultListenAddress
	}
	if options.PublicHost == "" {
		options.PublicHost = DefaultPublicHost
	}
	registry, err := OpenRegistry(options.StateDir)
	if err != nil {
		return nil, err
	}
	return &App{
		options:   options,
		registry:  registry,
		resources: make(map[string]*Resource),
		done:      make(chan error, 1),
	}, nil
}

func (app *App) Start(ctx context.Context) (string, error) {
	if err := app.acquireDaemonLock(); err != nil {
		return "", err
	}
	listener, err := net.Listen("tcp", app.options.ListenAddress)
	if err != nil {
		app.releaseDaemonLock()
		return "", fmt.Errorf("listen on %s: %w", app.options.ListenAddress, err)
	}
	tcpAddress, ok := listener.Addr().(*net.TCPAddr)
	if !ok || !tcpAddress.IP.IsLoopback() {
		_ = listener.Close()
		app.releaseDaemonLock()
		return "", errors.New("pdf.ts must listen on a loopback address")
	}
	app.listener = listener
	app.origin = "http://" + net.JoinHostPort(app.options.PublicHost, fmt.Sprint(tcpAddress.Port))
	if err := app.registry.SetEndpoint(listener.Addr().String(), app.origin); err != nil {
		_ = listener.Close()
		app.releaseDaemonLock()
		return "", err
	}
	app.server = &http.Server{
		Handler:           app.routes(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       30 * time.Second,
		MaxHeaderBytes:    32 << 10,
	}
	taskContext, stopTasks := context.WithCancel(ctx)
	app.stopTasks = stopTasks

	go func() {
		err := app.server.Serve(listener)
		if errors.Is(err, http.ErrServerClosed) {
			err = nil
		}
		app.done <- err
	}()
	go func() {
		<-ctx.Done()
		_ = app.Close()
	}()
	go app.sweepExpiredDocuments(taskContext)
	return app.origin, nil
}

func (app *App) Wait() error {
	serveErr := <-app.done
	// Shutdown closes the listener before Close has cleared the persisted
	// endpoint and released the daemon lock. A standalone daemon must not let
	// its main goroutine exit during that cleanup.
	return errors.Join(serveErr, app.Close())
}

func (app *App) Close() error {
	var err error
	app.closeOnce.Do(func() {
		if app.stopTasks != nil {
			app.stopTasks()
		}
		if app.server != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			err = app.server.Shutdown(ctx)
		}
		if app.listener != nil {
			if clearErr := app.registry.ClearEndpoint(app.listener.Addr().String()); err == nil {
				err = clearErr
			}
		}
		app.releaseDaemonLock()
	})
	return err
}

func (app *App) acquireDaemonLock() error {
	lockPath := filepath.Join(filepath.Dir(app.registry.path), "daemon.lock")
	file, err := os.OpenFile(lockPath, os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return fmt.Errorf("open daemon lock: %w", err)
	}
	locked, err := tryFileLock(file)
	if err != nil {
		_ = file.Close()
		return fmt.Errorf("acquire daemon lock: %w", err)
	}
	if !locked {
		_ = file.Close()
		return errors.New("another pdf.ts daemon is already running")
	}
	app.daemonLock = file
	return nil
}

func (app *App) releaseDaemonLock() {
	if app.daemonLock == nil {
		return
	}
	_ = unlockFile(app.daemonLock)
	_ = app.daemonLock.Close()
	app.daemonLock = nil
}

func (app *App) sweepExpiredDocuments(ctx context.Context) {
	app.removeExpiredDocuments(time.Now())
	ticker := time.NewTicker(expiredDocumentSweepInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			app.removeExpiredDocuments(now)
		}
	}
}

func (app *App) removeExpiredDocuments(now time.Time) {
	ids, err := app.registry.RemoveExpired(now)
	if err != nil || len(ids) == 0 {
		return
	}
	app.mutex.Lock()
	for _, id := range ids {
		delete(app.resources, id)
	}
	app.mutex.Unlock()
}

func (app *App) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/control/status", app.handleStatus)
	mux.HandleFunc("/api/control/stop", app.handleStop)
	mux.HandleFunc("/api/control/documents", app.handleRegisterDocument)
	mux.HandleFunc("/api/documents/", app.handleDocument)

	sub, err := fs.Sub(viewerFiles, "viewer")
	if err != nil {
		panic(err)
	}
	mux.Handle("/", newViewerAssetHandler(sub))
	return app.securityHeaders(mux)
}

func (app *App) handleStatus(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		response.Header().Set("Allow", http.MethodGet)
		http.Error(response, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func (app *App) handleStop(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		response.Header().Set("Allow", http.MethodPost)
		http.Error(response, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !app.sameOrigin(request) {
		writeJSONError(response, http.StatusForbidden, "forbidden_origin", "The stop request did not come from this pdf.ts instance.")
		return
	}
	response.WriteHeader(http.StatusAccepted)
	go func() {
		time.Sleep(10 * time.Millisecond)
		_ = app.Close()
	}()
}

func (app *App) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if !app.validRequestHost(request.Host) {
			http.Error(response, "invalid host", http.StatusMisdirectedRequest)
			return
		}
		response.Header().Set("X-Content-Type-Options", "nosniff")
		response.Header().Set("Referrer-Policy", "no-referrer")
		response.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
		response.Header().Set("X-Frame-Options", "DENY")
		if strings.HasPrefix(request.URL.Path, "/api/") {
			response.Header().Set("Cache-Control", "no-store")
		}
		next.ServeHTTP(response, request)
	})
}

func (app *App) validRequestHost(host string) bool {
	if app.listener == nil {
		return true
	}
	publicURL, err := url.Parse(app.origin)
	if err == nil && strings.EqualFold(host, publicURL.Host) {
		return true
	}
	return strings.EqualFold(host, app.listener.Addr().String())
}

func (app *App) handleRegisterDocument(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		response.Header().Set("Allow", http.MethodPost)
		http.Error(response, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !app.sameOrigin(request) {
		writeJSONError(response, http.StatusForbidden, "forbidden_origin", "The registration request did not come from this pdf.ts instance.")
		return
	}
	var input struct {
		Path string `json:"path"`
	}
	request.Body = http.MaxBytesReader(response, request.Body, 64<<10)
	if err := json.NewDecoder(request.Body).Decode(&input); err != nil {
		writeJSONError(response, http.StatusBadRequest, "invalid_request", "The document registration request is invalid.")
		return
	}
	document, err := app.registry.Register(input.Path)
	if err != nil {
		writeJSONError(response, http.StatusBadRequest, "invalid_document", err.Error())
		return
	}
	query := url.Values{"launcherDocument": {document.ID}}
	viewerURL := app.origin + "/?" + query.Encode()
	writeJSON(response, http.StatusOK, openResult{
		ID:   document.ID,
		URL:  viewerURL,
		Name: filepath.Base(document.Path),
		Kind: document.Kind,
	})
}

func (app *App) handleDocument(response http.ResponseWriter, request *http.Request) {
	remainder := strings.TrimPrefix(request.URL.Path, "/api/documents/")
	parts := strings.Split(remainder, "/")
	if len(parts) == 0 || parts[0] == "" {
		http.NotFound(response, request)
		return
	}
	document, found := app.registry.Document(parts[0])
	if !found {
		writeJSONError(response, http.StatusNotFound, "unknown_document", "This document is not registered with pdf.ts.")
		return
	}
	resource, err := app.resourceFor(document)
	if err != nil {
		app.writeResourceError(response, err)
		return
	}

	if len(parts) == 2 && parts[1] == "copy" {
		app.handleCopy(resource, response, request)
		return
	}
	if len(parts) != 1 {
		http.NotFound(response, request)
		return
	}
	if request.Method == http.MethodPatch {
		app.handlePdfIncrement(resource, response, request)
		return
	}
	app.handleResource(resource, response, request)
}

func (app *App) handlePdfIncrement(resource *Resource, response http.ResponseWriter, request *http.Request) {
	if !app.sameOrigin(request) {
		writeJSONError(response, http.StatusForbidden, "forbidden_origin", "The write request did not come from this pdf.ts page.")
		return
	}
	result, conflict, err := resource.ReplacePdfIncrement(response, request)
	if conflict != nil {
		writeJSON(response, http.StatusConflict, conflict)
		return
	}
	if err != nil {
		status := http.StatusInternalServerError
		code := "write_failed"
		switch {
		case errors.Is(err, errInvalidPdfIncrement):
			status = http.StatusBadRequest
			code = "invalid_pdf_increment"
		case errors.Is(err, errPreconditionRequired):
			status = http.StatusPreconditionRequired
			code = "version_required"
		case errors.Is(err, errDocumentLocked):
			status = http.StatusLocked
			code = "document_locked"
		case errors.Is(err, os.ErrNotExist):
			status = http.StatusGone
			code = "document_missing"
		}
		writeJSONError(response, status, code, err.Error())
		return
	}
	writeJSON(response, http.StatusOK, result)
}

func (app *App) handleDocumentAsset(resource *Resource, relativePath string, response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		response.Header().Set("Allow", "GET, HEAD")
		http.Error(response, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if err := resource.ServeAsset(response, request, relativePath); err != nil {
		if errors.Is(err, errInvalidAssetPath) || errors.Is(err, os.ErrNotExist) {
			http.NotFound(response, request)
			return
		}
		app.writeResourceError(response, err)
	}
}

func (app *App) handleResource(resource *Resource, response http.ResponseWriter, request *http.Request) {
	switch request.Method {
	case http.MethodGet, http.MethodHead:
		if err := resource.Serve(response, request); err != nil {
			app.writeResourceError(response, err)
		}
	case http.MethodPut:
		if !app.sameOrigin(request) {
			writeJSONError(response, http.StatusForbidden, "forbidden_origin", "The write request did not come from this pdf.ts page.")
			return
		}
		result, conflict, err := resource.Replace(response, request)
		if conflict != nil {
			writeJSON(response, http.StatusConflict, conflict)
			return
		}
		if err != nil {
			status := http.StatusInternalServerError
			code := "write_failed"
			if errors.Is(err, errPreconditionRequired) {
				status = http.StatusPreconditionRequired
				code = "version_required"
			} else if errors.Is(err, errDocumentLocked) {
				status = http.StatusLocked
				code = "document_locked"
			} else if errors.Is(err, os.ErrNotExist) {
				status = http.StatusGone
				code = "document_missing"
			}
			writeJSONError(response, status, code, err.Error())
			return
		}
		writeJSON(response, http.StatusOK, result)
	default:
		response.Header().Set("Allow", "GET, HEAD, PUT")
		http.Error(response, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (app *App) handleCopy(resource *Resource, response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		response.Header().Set("Allow", http.MethodPost)
		http.Error(response, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !app.sameOrigin(request) {
		writeJSONError(response, http.StatusForbidden, "forbidden_origin", "The write request did not come from this pdf.ts page.")
		return
	}
	result, err := resource.SaveConflictCopy(response, request)
	if err != nil {
		status := http.StatusInternalServerError
		code := "copy_failed"
		if errors.Is(err, errDocumentLocked) {
			status = http.StatusLocked
		} else if errors.Is(err, os.ErrNotExist) {
			status = http.StatusGone
			code = "document_missing"
		}
		writeJSONError(response, status, code, err.Error())
		return
	}
	writeJSON(response, http.StatusCreated, result)
}

func (app *App) resourceFor(document Document) (*Resource, error) {
	app.mutex.Lock()
	defer app.mutex.Unlock()
	if resource := app.resources[document.ID]; resource != nil && sameDocumentPath(resource.Path(), document.Path) {
		return resource, nil
	}
	resource, err := NewResourceWithID(document.Path, document.ID)
	if err != nil {
		return nil, err
	}
	app.resources[document.ID] = resource
	return resource, nil
}

func (app *App) writeResourceError(response http.ResponseWriter, err error) {
	if errors.Is(err, os.ErrNotExist) {
		writeJSONError(response, http.StatusGone, "document_missing", "The document was moved or deleted. Open it again with pdf.ts to register its new location.")
		return
	}
	writeJSONError(response, http.StatusInternalServerError, "document_unavailable", err.Error())
}

func (app *App) sameOrigin(request *http.Request) bool {
	origin := request.Header.Get("Origin")
	return origin == "" || origin == app.origin
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}

func writeJSONError(response http.ResponseWriter, status int, code, message string) {
	writeJSON(response, status, map[string]string{"code": code, "message": message})
}

func randomID() (string, error) {
	var bytes [24]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes[:]), nil
}
