//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

var messageBoxW = syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW")

func ReportError(title, message string) {
	titlePointer, titleError := syscall.UTF16PtrFromString(title)
	messagePointer, messageError := syscall.UTF16PtrFromString(message)
	if titleError != nil || messageError != nil {
		return
	}
	const errorIcon = 0x00000010
	_, _, _ = messageBoxW.Call(
		0,
		uintptr(unsafe.Pointer(messagePointer)),
		uintptr(unsafe.Pointer(titlePointer)),
		errorIcon,
	)
}
