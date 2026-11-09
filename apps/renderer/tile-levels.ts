// Device pixels per PDF point, independent of CSS zoom and DPR. Snap upward
// in sqrt(2) steps: at most ~1.414x resolution (~2x pixels), capped at 128.
export const PDF_TILE_SCALES = Array.from({ length: 17 }, (_, i) => 2 ** ((i - 2) / 2));
