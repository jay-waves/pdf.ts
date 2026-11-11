package main

import (
	"os"
	"unsafe"

	"golang.org/x/sys/windows"
)

func cloneSaveFile(source, destination string) error {
	src, err := os.Open(source)
	if err != nil {
		return err
	}
	defer src.Close()
	info, err := src.Stat()
	if err != nil {
		return err
	}
	// 64 KiB aligns to supported ReFS cluster sizes. Leave a partial final
	// block unshared; the complete-file writer fills it from the new output.
	size := info.Size() / (64 * 1024) * (64 * 1024)
	if size == 0 {
		return windows.ERROR_NOT_SUPPORTED
	}
	dst, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer dst.Close()
	if err := dst.Truncate(size); err != nil {
		return err
	}
	data := struct {
		Source       windows.Handle
		SourceOffset int64
		TargetOffset int64
		ByteCount    int64
	}{Source: windows.Handle(src.Fd()), ByteCount: size}
	var returned uint32
	return windows.DeviceIoControl(windows.Handle(dst.Fd()), windows.FSCTL_DUPLICATE_EXTENTS_TO_FILE,
		(*byte)(unsafe.Pointer(&data)), uint32(unsafe.Sizeof(data)), nil, 0, &returned, nil)
}
