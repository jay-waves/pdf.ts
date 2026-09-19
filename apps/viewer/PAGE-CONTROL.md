# Page control boundaries

Input → ViewerCommand → PageController → PdfScroll / layout plugins → PageView → React

- `viewer-viewport-input.tsx` owns DOM keyboard, pointer and wheel listeners, gesture lifetimes and input cancellation. It emits navigation commands; reading pan and zoom retain their frame-level viewport implementation.
- `viewer-controller.ts` routes application commands, coordinates overlays and annotation tools, and exposes React feedback. It does not install DOM listeners or calculate layout geometry.
- `page-controller.ts` owns page navigation, reading/presentation transitions and layout policy. Its synchronous, immutable snapshot is exposed through `useSyncExternalStore`. Plugin notifications update reading feedback; they cannot replace the current presentation page.
- `pdf-scroll.ts` handles viewport geometry, anchor preservation, scrolling and reveal animations. It does not interpret keyboard events or decide reading modes.
- `pdf-surface.tsx` and `presentation-view.tsx` consume the view. During presentation the ordinary viewport remains mounted to preserve layout and reading settings, but is inert and its input component is unmounted. Presentation navigation does not scroll that inactive viewport. Exiting synchronizes its page once.
- `reading-history.ts` persists the controller snapshot and restores through `applyLayout` and `goToPage`; it does not write plugin layout state directly.

## Transition rules

| Action | Result |
| --- | --- |
| Enter horizontal scrolling | Single page, fit height |
| Enable double page | Vertical scrolling, fit width |
| Return to vertical scrolling | Keep current zoom unless using double page |
| Enter presentation | Keep reading layout; begin at the current reading page |
| Navigate in presentation | Update only the presentation page, bounded by document size |
| Advance after the last page | Move the Presentation cursor to `totalPages + 1`, an empty end screen; clicking it exits |
| Exit presentation | Restore reading interaction and navigate to the last presentation page |
| Restore history | Apply the same layout constraints as toolbar actions |

Add new layout rules in `PageController`, not toolbar callbacks or persistence code. Keep input-specific thresholds in the input layer. Use the controller snapshot for visible page/layout UI instead of subscribing to plugins again.
