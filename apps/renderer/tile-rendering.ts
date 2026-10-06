import type { Tile } from '@embedpdf/plugin-tiling';

/** Keep displayed detail, but unmount unfinished tiles at obsolete scales. */
export function getDisplayTiles(
  front: readonly Tile[],
  pending: readonly Tile[],
  scale: number,
  loaded: ReadonlySet<string>,
) {
  return [...new Map([...front, ...pending].map((tile) => [tile.id, tile])).values()]
    .filter((tile) => tile.srcScale === scale || loaded.has(tile.id));
}
