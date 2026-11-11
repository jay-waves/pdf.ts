//go:build !linux && !darwin && !windows

package main

import "errors"

func cloneSaveFile(source, destination string) error {
	return errors.New("copy-on-write cloning is unavailable")
}
