package main

import (
	"os"

	"golang.org/x/sys/unix"
)

func cloneSaveFile(source, destination string) error {
	src, err := os.Open(source)
	if err != nil {
		return err
	}
	defer src.Close()
	dst, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer dst.Close()
	return unix.IoctlFileClone(int(dst.Fd()), int(src.Fd()))
}
