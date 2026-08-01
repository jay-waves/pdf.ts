//go:build linux

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func installAssociations(executable string) error {
	dataHome := os.Getenv("XDG_DATA_HOME")
	if dataHome == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return err
		}
		dataHome = filepath.Join(home, ".local", "share")
	}
	applicationsDir := filepath.Join(dataHome, "applications")
	if err := os.MkdirAll(applicationsDir, 0o755); err != nil {
		return err
	}
	iconDir := filepath.Join(dataHome, "icons", "hicolor", "128x128", "apps")
	if err := os.MkdirAll(iconDir, 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(iconDir, "pdf.ts.png"), launcherIcon, 0o644); err != nil {
		return err
	}
	desktopFile := fmt.Sprintf(`[Desktop Entry]
Type=Application
Name=pdf.ts
Comment=Open PDF documents in a local browser viewer
Exec="%s" open %%f
Terminal=false
NoDisplay=false
MimeType=application/pdf;
Categories=Office;Viewer;
Icon=pdf.ts
`, escapeDesktopExec(executable))
	if err := os.WriteFile(filepath.Join(applicationsDir, "pdf.ts.desktop"), []byte(desktopFile), 0o644); err != nil {
		return err
	}
	runIfAvailable("update-desktop-database", applicationsDir)
	return nil
}

func uninstallAssociations() error {
	dataHome := os.Getenv("XDG_DATA_HOME")
	if dataHome == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return err
		}
		dataHome = filepath.Join(home, ".local", "share")
	}
	applicationsDir := filepath.Join(dataHome, "applications")
	for _, target := range []string{
		filepath.Join(applicationsDir, "pdf.ts.desktop"),
		filepath.Join(dataHome, "icons", "hicolor", "128x128", "apps", "pdf.ts.png"),
	} {
		if err := os.Remove(target); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	runIfAvailable("update-desktop-database", applicationsDir)
	return nil
}

func escapeDesktopExec(value string) string {
	replacer := strings.NewReplacer(
		`\`, `\\`,
		`"`, `\"`,
		"`", "\\`",
		"$", `\$`,
		"%", "%%",
	)
	return replacer.Replace(value)
}

func runIfAvailable(name string, args ...string) {
	path, err := exec.LookPath(name)
	if err == nil {
		_ = exec.Command(path, args...).Run()
	}
}
