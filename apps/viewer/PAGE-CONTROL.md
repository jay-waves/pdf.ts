# Page control boundaries

Input → ViewerCommand → ViewerStage → v2 spatial capabilities → StageSnapshot → React

- `viewer-input.ts` owns app-level keyboard and page-navigation bindings. It emits semantic commands and contains no spatial implementation.
- `stage-surface.tsx` is the thin React binding that obtains capabilities and forwards normalized `@use-gesture/react` drag/pinch samples.
- `stage-input-controller.ts` owns the pointer state machine, wheel input, frame-coalesced pan/zoom, timers, activity lifetimes and cancellation. It has no React dependency.
- `viewer-controller.ts` routes application commands, coordinates overlays and annotation tools, and exposes React feedback. It does not install DOM listeners or calculate layout geometry.
- `viewer-stage.ts` is the app's single spatial owner. It owns page navigation, reading/presentation transitions and layout policy, and delegates geometry to the v2 adapter. Its synchronous immutable `StageSnapshot` is exposed through `useSyncExternalStore`.
- `stage-scroll-adapter.ts` is the private v2 spatial adapter behind `ViewerStage`: rect reveal, anchor preservation and DOM/plugin scroll access. App features depend on `ViewerStage`, not this adapter.
- `pdf-surface.tsx` and `presentation-view.tsx` consume the view. During presentation the ordinary viewport remains mounted to preserve layout and reading settings, but is inert and its input component is unmounted. Presentation navigation does not scroll that inactive viewport. Exiting synchronizes its page once.
- `reading-history.ts` persists the stage snapshot and restores through `applyLayout` and `goToPage`; it does not write plugin layout state directly.

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

Add new spatial/layout rules in `ViewerStage`, not toolbar callbacks or persistence code. Keep modality-specific input rules in the stage input controller. Use `StageSnapshot` for visible page/layout UI instead of subscribing to spatial plugins again.
