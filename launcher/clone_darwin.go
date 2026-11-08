package main

import "golang.org/x/sys/unix"

// clonefile shares APFS extents; unsupported volumes use the regular writer.
func cloneSaveFile(source, destination string) error {
	return unix.Clonefile(source, destination, unix.CLONE_NOFOLLOW)
}
