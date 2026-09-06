// Command generate-icons creates all platform icon assets from a square PNG.
package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"path/filepath"
)

var pngSizes = []int{16, 32, 48, 128, 512}
var icoSizes = []int{16, 32, 48, 128, 256}

func main() {
	root, err := os.Getwd()
	check(err)
	sourcePath := filepath.Join(root, "assets", "logo.png")
	if len(os.Args) == 2 {
		sourcePath, err = filepath.Abs(os.Args[1])
		check(err)
	} else if len(os.Args) > 2 {
		fmt.Fprintln(os.Stderr, "usage: go run scripts/generate-icons.go [source.png]")
		os.Exit(2)
	}

	sourceFile, err := os.Open(sourcePath)
	check(err)
	defer sourceFile.Close()
	source, err := png.Decode(sourceFile)
	check(err)
	if source.Bounds().Dx() != source.Bounds().Dy() {
		check(fmt.Errorf("source icon must be square, got %s", source.Bounds()))
	}
	sourceBounds := paddedContentSquare(source, 0.02)

	encoded := make(map[int][]byte)
	for _, size := range uniqueSizes(pngSizes, icoSizes) {
		var output bytes.Buffer
		check(png.Encode(&output, resizeArea(source, sourceBounds, size)))
		encoded[size] = output.Bytes()
	}
	for _, size := range pngSizes {
		name := "icon.png"
		if size != 512 {
			name = fmt.Sprintf("icon-%d.png", size)
		}
		check(os.WriteFile(filepath.Join(root, "assets", name), encoded[size], 0o644))
	}
	check(os.WriteFile(filepath.Join(root, "launcher", "icon.png"), encoded[128], 0o644))
	check(writeICO(filepath.Join(root, "assets", "icon.ico"), encoded))
}

func uniqueSizes(groups ...[]int) []int {
	seen := make(map[int]bool)
	var result []int
	for _, group := range groups {
		for _, size := range group {
			if !seen[size] {
				seen[size] = true
				result = append(result, size)
			}
		}
	}
	return result
}

// resizeArea uses alpha-aware area averaging, which keeps transparent edges clean
// and remains legible at the 16 px size used by Windows and browser toolbars.
func resizeArea(source image.Image, bounds image.Rectangle, size int) *image.NRGBA {
	result := image.NewNRGBA(image.Rect(0, 0, size, size))
	for y := 0; y < size; y++ {
		sy0 := y * bounds.Dy() / size
		sy1 := (y+1)*bounds.Dy()/size - 1
		for x := 0; x < size; x++ {
			sx0 := x * bounds.Dx() / size
			sx1 := (x+1)*bounds.Dx()/size - 1
			var red, green, blue, alpha, count uint64
			for sy := sy0; sy <= sy1; sy++ {
				for sx := sx0; sx <= sx1; sx++ {
					r, g, b, a := source.At(bounds.Min.X+sx, bounds.Min.Y+sy).RGBA()
					red += uint64(r)
					green += uint64(g)
					blue += uint64(b)
					alpha += uint64(a)
					count++
				}
			}
			if count == 0 || alpha == 0 {
				continue
			}
			result.SetNRGBA(x, y, color.NRGBA{
				R: uint8(red * 255 / alpha),
				G: uint8(green * 255 / alpha),
				B: uint8(blue * 255 / alpha),
				A: uint8((alpha / count) >> 8),
			})
		}
	}
	return result
}

// paddedContentSquare removes accidental transparent margins while preserving
// a small, consistent safety area around the visible artwork.
func paddedContentSquare(source image.Image, padding float64) image.Rectangle {
	bounds := source.Bounds()
	content := image.Rect(bounds.Max.X, bounds.Max.Y, bounds.Min.X, bounds.Min.Y)
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			_, _, _, alpha := source.At(x, y).RGBA()
			if alpha == 0 {
				continue
			}
			if x < content.Min.X {
				content.Min.X = x
			}
			if y < content.Min.Y {
				content.Min.Y = y
			}
			if x+1 > content.Max.X {
				content.Max.X = x + 1
			}
			if y+1 > content.Max.Y {
				content.Max.Y = y + 1
			}
		}
	}
	if content.Empty() {
		return bounds
	}

	contentSize := max(content.Dx(), content.Dy())
	size := min(bounds.Dx(), int(math.Ceil(float64(contentSize)/(1-2*padding))))
	centerX := (content.Min.X + content.Max.X) / 2
	centerY := (content.Min.Y + content.Max.Y) / 2
	left := min(max(centerX-size/2, bounds.Min.X), bounds.Max.X-size)
	top := min(max(centerY-size/2, bounds.Min.Y), bounds.Max.Y-size)
	return image.Rect(left, top, left+size, top+size)
}

func writeICO(path string, images map[int][]byte) error {
	var output bytes.Buffer
	check(binary.Write(&output, binary.LittleEndian, uint16(0)))
	check(binary.Write(&output, binary.LittleEndian, uint16(1)))
	check(binary.Write(&output, binary.LittleEndian, uint16(len(icoSizes))))
	offset := uint32(6 + 16*len(icoSizes))
	for _, size := range icoSizes {
		dimension := byte(size)
		if size == 256 {
			dimension = 0
		}
		output.WriteByte(dimension)
		output.WriteByte(dimension)
		output.WriteByte(0)
		output.WriteByte(0)
		check(binary.Write(&output, binary.LittleEndian, uint16(1)))
		check(binary.Write(&output, binary.LittleEndian, uint16(32)))
		check(binary.Write(&output, binary.LittleEndian, uint32(len(images[size]))))
		check(binary.Write(&output, binary.LittleEndian, offset))
		offset += uint32(len(images[size]))
	}
	for _, size := range icoSizes {
		output.Write(images[size])
	}
	return os.WriteFile(path, output.Bytes(), 0o644)
}

func check(err error) {
	if err != nil {
		panic(err)
	}
}
