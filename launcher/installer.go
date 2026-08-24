package main

import (
	"fmt"
	"os"
	"path/filepath"
)

func Install(executable string) error {
	absolute, err := filepath.Abs(executable)
	if err != nil {
		return fmt.Errorf("resolve pdf.ts executable: %w", err)
	}
	if canonical, canonicalErr := filepath.EvalSymlinks(absolute); canonicalErr == nil {
		absolute = canonical
	}
	info, err := os.Stat(absolute)
	if err != nil {
		return fmt.Errorf("inspect pdf.ts executable: %w", err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("pdf.ts executable is not a regular file: %s", absolute)
	}
	if err := installAssociations(absolute); err != nil {
		return fmt.Errorf("install pdf.ts file associations: %w", err)
	}
	return nil
}

func Uninstall(purge bool) error {
	if purge {
		if err := StopDaemon(""); err != nil {
			return fmt.Errorf("stop pdf.ts daemon: %w", err)
		}
	}
	if err := uninstallAssociations(); err != nil {
		return fmt.Errorf("uninstall pdf.ts file associations: %w", err)
	}
	if purge {
		directory, err := DefaultStateDir()
		if err != nil {
			return err
		}
		if err := os.RemoveAll(directory); err != nil {
			return fmt.Errorf("remove pdf.ts application data: %w", err)
		}
	}
	return nil
}
