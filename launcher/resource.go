package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const maxDocumentBytes int64 = 4 << 30

var errPreconditionRequired = errors.New("If-Match is required for document writes")

type Resource struct {
	path    string
	mutex   sync.RWMutex
	version string
	size    int64
	modTime time.Time
}

type WriteResult struct {
	Version string `json:"version"`
	Name    string `json:"name"`
}

type Conflict struct {
	Code           string `json:"code"`
	Message        string `json:"message"`
	CurrentVersion string `json:"currentVersion"`
}

type CopyResult struct {
	Name string `json:"name"`
}

func NewResource(path string) (*Resource, error) {
	version, err := fileVersion(path)
	if err != nil {
		return nil, fmt.Errorf("fingerprint document: %w", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("inspect document: %w", err)
	}
	return &Resource{
		path:    path,
		version: version,
		size:    info.Size(),
		modTime: info.ModTime(),
	}, nil
}

func (resource *Resource) Path() string { return resource.path }

func (resource *Resource) Serve(response http.ResponseWriter, request *http.Request) error {
	file, err := os.Open(resource.path)
	if err != nil {
		return fmt.Errorf("open document: %w", err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return fmt.Errorf("inspect document: %w", err)
	}
	version, err := resource.versionFor(file, info)
	if err != nil {
		return err
	}

	response.Header().Set("ETag", quoteETag(version))
	response.Header().Set("Content-Disposition", contentDisposition(filepath.Base(resource.path)))
	http.ServeContent(response, request, filepath.Base(resource.path), info.ModTime(), file)
	return nil
}

func (resource *Resource) Replace(response http.ResponseWriter, request *http.Request) (*WriteResult, *Conflict, error) {
	expected := unquoteETag(request.Header.Get("If-Match"))
	if expected == "" {
		return nil, nil, errPreconditionRequired
	}

	unlock, err := acquireDocumentLock(resource.path)
	if err != nil {
		return nil, nil, err
	}
	defer unlock()

	current, err := fileVersion(resource.path)
	if err != nil {
		return nil, nil, fmt.Errorf("fingerprint current document: %w", err)
	}
	if current != expected {
		return nil, &Conflict{
			Code:           "version_conflict",
			Message:        "The document changed on disk after it was opened.",
			CurrentVersion: current,
		}, nil
	}

	temp, err := os.CreateTemp(filepath.Dir(resource.path), ".pdf.ts-save-*")
	if err != nil {
		return nil, nil, fmt.Errorf("create temporary document: %w", err)
	}
	tempPath := temp.Name()
	keepTemp := false
	defer func() {
		_ = temp.Close()
		if !keepTemp {
			_ = os.Remove(tempPath)
		}
	}()

	limited := http.MaxBytesReader(response, request.Body, maxDocumentBytes)
	hash := sha256.New()
	written, err := io.Copy(io.MultiWriter(temp, hash), limited)
	if err != nil {
		return nil, nil, fmt.Errorf("receive document: %w", err)
	}
	if written == 0 {
		return nil, nil, errors.New("refusing to replace a document with an empty file")
	}
	if info, statErr := os.Stat(resource.path); statErr == nil {
		_ = temp.Chmod(info.Mode().Perm())
	}
	if err := temp.Sync(); err != nil {
		return nil, nil, fmt.Errorf("flush temporary document: %w", err)
	}
	if err := temp.Close(); err != nil {
		return nil, nil, fmt.Errorf("close temporary document: %w", err)
	}

	// Check once more immediately before the atomic replacement. This catches
	// editors outside pdf.ts that changed the file while the upload ran.
	rechecked, err := fileVersion(resource.path)
	if err != nil {
		return nil, nil, fmt.Errorf("recheck current document: %w", err)
	}
	if rechecked != expected {
		return nil, &Conflict{
			Code:           "version_conflict",
			Message:        "The document changed on disk while the new version was being saved.",
			CurrentVersion: rechecked,
		}, nil
	}
	if err := atomicReplace(tempPath, resource.path); err != nil {
		return nil, nil, fmt.Errorf("replace document: %w", err)
	}
	keepTemp = true
	version := hex.EncodeToString(hash.Sum(nil))
	info, statErr := os.Stat(resource.path)
	resource.mutex.Lock()
	resource.version = version
	if statErr == nil {
		resource.size = info.Size()
		resource.modTime = info.ModTime()
	}
	resource.mutex.Unlock()
	return &WriteResult{Version: version, Name: filepath.Base(resource.path)}, nil, nil
}

func (resource *Resource) SaveConflictCopy(response http.ResponseWriter, request *http.Request) (*CopyResult, error) {
	unlock, err := acquireDocumentLock(resource.path)
	if err != nil {
		return nil, err
	}
	defer unlock()

	directory := filepath.Dir(resource.path)
	extension := filepath.Ext(resource.path)
	stem := strings.TrimSuffix(filepath.Base(resource.path), extension)
	timestamp := time.Now().Format("20060102-150405")

	var output *os.File
	for attempt := 0; attempt < 100; attempt++ {
		suffix := ""
		if attempt > 0 {
			suffix = fmt.Sprintf("-%d", attempt+1)
		}
		name := fmt.Sprintf("%s (pdf.ts conflict %s%s)%s", stem, timestamp, suffix, extension)
		output, err = os.OpenFile(filepath.Join(directory, name), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if err == nil {
			break
		}
		if !os.IsExist(err) {
			return nil, fmt.Errorf("create conflict copy: %w", err)
		}
	}
	if output == nil {
		return nil, errors.New("could not allocate a unique conflict-copy filename")
	}
	name := filepath.Base(output.Name())
	complete := false
	defer func() {
		_ = output.Close()
		if !complete {
			_ = os.Remove(output.Name())
		}
	}()

	limited := http.MaxBytesReader(response, request.Body, maxDocumentBytes)
	written, err := io.Copy(output, limited)
	if err != nil {
		return nil, fmt.Errorf("write conflict copy: %w", err)
	}
	if written == 0 {
		return nil, errors.New("refusing to save an empty conflict copy")
	}
	if err := output.Sync(); err != nil {
		return nil, fmt.Errorf("flush conflict copy: %w", err)
	}
	if info, statErr := os.Stat(resource.path); statErr == nil {
		_ = output.Chmod(info.Mode().Perm())
	}
	if err := output.Close(); err != nil {
		return nil, fmt.Errorf("close conflict copy: %w", err)
	}
	complete = true
	return &CopyResult{Name: name}, nil
}

func fileVersion(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	return fileVersionFrom(file)
}

func fileVersionFrom(reader io.Reader) (string, error) {
	hash := sha256.New()
	if _, err := io.Copy(hash, reader); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func (resource *Resource) versionFor(file *os.File, info os.FileInfo) (string, error) {
	resource.mutex.RLock()
	if resource.size == info.Size() && resource.modTime.Equal(info.ModTime()) {
		version := resource.version
		resource.mutex.RUnlock()
		return version, nil
	}
	resource.mutex.RUnlock()

	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return "", fmt.Errorf("rewind document before fingerprint: %w", err)
	}
	version, err := fileVersionFrom(file)
	if err != nil {
		return "", fmt.Errorf("fingerprint changed document: %w", err)
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return "", fmt.Errorf("rewind document after fingerprint: %w", err)
	}
	resource.mutex.Lock()
	resource.version = version
	resource.size = info.Size()
	resource.modTime = info.ModTime()
	resource.mutex.Unlock()
	return version, nil
}

func quoteETag(value string) string {
	return `"` + value + `"`
}

func unquoteETag(value string) string {
	return strings.Trim(strings.TrimSpace(value), `"`)
}

func contentDisposition(filename string) string {
	var fallback strings.Builder
	for _, character := range filename {
		if character >= 0x20 && character <= 0x7e && character != '"' && character != '\\' {
			fallback.WriteRune(character)
		} else {
			fallback.WriteByte('_')
		}
	}
	return fmt.Sprintf(
		`inline; filename="%s"; filename*=UTF-8''%s`,
		fallback.String(),
		encodeRFC5987(filename),
	)
}

func encodeRFC5987(value string) string {
	const hexadecimal = "0123456789ABCDEF"
	var encoded strings.Builder
	for index := 0; index < len(value); index++ {
		character := value[index]
		if character >= 'a' && character <= 'z' ||
			character >= 'A' && character <= 'Z' ||
			character >= '0' && character <= '9' ||
			strings.ContainsRune("!#$&+-.^_`|~", rune(character)) {
			encoded.WriteByte(character)
			continue
		}
		encoded.WriteByte('%')
		encoded.WriteByte(hexadecimal[character>>4])
		encoded.WriteByte(hexadecimal[character&0x0f])
	}
	return encoded.String()
}
