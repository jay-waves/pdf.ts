package main

import "embed"

//go:embed icon.png
var launcherIcon []byte

//go:embed viewer
var viewerFiles embed.FS
