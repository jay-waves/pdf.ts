//go:build windows

package main

import (
	"fmt"
	"os"
	"syscall"
)

var attachConsole = syscall.NewLazyDLL("kernel32.dll").NewProc("AttachConsole")

func prepareStatusOutput() error {
	// GUI builds can inherit a valid output handle when redirected. Keep it.
	if _, err := syscall.GetFileType(syscall.Handle(os.Stdout.Fd())); err == nil {
		return nil
	}

	// Attach only to the invoking terminal; never create a console window.
	const attachParentProcess = 0xffffffff
	if attached, _, err := attachConsole.Call(attachParentProcess); attached == 0 {
		return fmt.Errorf("attach status output to parent console: %w", err)
	}
	handle, err := syscall.GetStdHandle(syscall.STD_OUTPUT_HANDLE)
	if err != nil {
		return fmt.Errorf("get console output: %w", err)
	}
	// Go initialized os.Stdout before AttachConsole supplied the new handle.
	os.Stdout = os.NewFile(uintptr(handle), "/dev/stdout")
	return nil
}
