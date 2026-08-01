//go:build windows

package main

import (
	"os"
	"syscall"
	"unsafe"
)

const (
	lockfileFailImmediately = 0x00000001
	lockfileExclusiveLock   = 0x00000002
	errorLockViolation      = syscall.Errno(33)
)

var (
	lockFileEx   = syscall.NewLazyDLL("kernel32.dll").NewProc("LockFileEx")
	unlockFileEx = syscall.NewLazyDLL("kernel32.dll").NewProc("UnlockFileEx")
)

func tryFileLock(file *os.File) (bool, error) {
	overlapped := new(syscall.Overlapped)
	result, _, callErr := lockFileEx.Call(
		file.Fd(),
		uintptr(lockfileFailImmediately|lockfileExclusiveLock),
		0,
		1,
		0,
		uintptr(unsafe.Pointer(overlapped)),
	)
	if result != 0 {
		return true, nil
	}
	if callErr == errorLockViolation {
		return false, nil
	}
	if callErr != syscall.Errno(0) {
		return false, callErr
	}
	return false, syscall.EINVAL
}

func unlockFile(file *os.File) error {
	overlapped := new(syscall.Overlapped)
	result, _, callErr := unlockFileEx.Call(
		file.Fd(),
		0,
		1,
		0,
		uintptr(unsafe.Pointer(overlapped)),
	)
	if result != 0 {
		return nil
	}
	if callErr != syscall.Errno(0) {
		return callErr
	}
	return syscall.EINVAL
}
