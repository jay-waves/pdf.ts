//go:build darwin

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func installAssociations(executable string) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	application := filepath.Join(home, "Applications", "pdf.ts.app")
	contents := filepath.Join(application, "Contents")
	macosDir := filepath.Join(contents, "MacOS")
	if err := os.MkdirAll(macosDir, 0o755); err != nil {
		return err
	}
	launcher := "#!/bin/sh\nexec '" + strings.ReplaceAll(executable, "'", "'\\''") + "' open \"$@\"\n"
	if err := os.WriteFile(filepath.Join(macosDir, "pdf.ts-launcher"), []byte(launcher), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(contents, "Info.plist"), []byte(infoPlist), 0o644); err != nil {
		return err
	}
	runLSRegister("-f", application)
	return nil
}

func uninstallAssociations() error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	application := filepath.Join(home, "Applications", "pdf.ts.app")
	if _, err := os.Stat(application); err == nil {
		runLSRegister("-u", application)
	} else if !os.IsNotExist(err) {
		return err
	}
	return os.RemoveAll(application)
}

func runLSRegister(args ...string) {
	const lsregister = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
	if info, err := os.Stat(lsregister); err == nil && info.Mode().IsRegular() {
		_ = exec.Command(lsregister, args...).Run()
	}
}

const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>io.github.jay-waves.pdf.ts</string>
  <key>CFBundleName</key><string>pdf.ts</string>
  <key>CFBundleDisplayName</key><string>pdf.ts</string>
  <key>CFBundleExecutable</key><string>pdf.ts-launcher</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleDocumentTypes</key>
  <array>
    <dict>
      <key>CFBundleTypeName</key><string>PDF document</string>
      <key>CFBundleTypeRole</key><string>Viewer</string>
      <key>LSItemContentTypes</key><array><string>com.adobe.pdf</string></array>
    </dict>
  </array>
</dict>
</plist>
`
