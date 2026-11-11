//go:build windows

package main

import "golang.org/x/sys/windows"

func ReportError(title, message string) {
	titlePointer, titleError := windows.UTF16PtrFromString(title)
	messagePointer, messageError := windows.UTF16PtrFromString(message)
	if titleError != nil || messageError != nil {
		return
	}
	_, _ = windows.MessageBox(0, messagePointer, titlePointer, windows.MB_ICONERROR)
}
