# Page control boundaries

Input → ViewerCommand → ViewerStage → v2 spatial capabilities → StageSnapshot → React

- `viewer-input.ts` owns app-level keyboard and page-navigation bindings. It emits semantic commands and contains no spatial implementation.
- `stage-surface.tsx` is the thin React binding that obtains capabilities and forwards normalized `@use-gesture/react` drag/pinch samples.
- `stage-input-controller.ts` owns the pointer state machine, wheel input, frame-coalesced pan/zoom, timers, activity lifetimes and cancellation. It has no React dependency.
- `viewer-controller.ts` routes application commands, coordinates overlays and annotation tools, and exposes React feedback. It does not install DOM listeners or calculate layout geometry.
- `viewer-stage.ts` is the app's single spatial owner. It owns page navigation, reading/presentation transitions and layout policy, and delegates geometry to the v2 adapter. Its synchronous immutable `StageSnapshot` is exposed through `useSyncExternalStore`.
- `stage-scroll-adapter.ts` is the private v2 spatial adapter behind `ViewerStage`: rect reveal, anchor preservation and DOM/plugin scroll access. App features depend on `ViewerStage`, not this adapter.
- `viewport-geometry.ts` owns measurement and stateless geometry: client-to-viewport anchors, rotated-page coordinates, axis projection and fit scales. Adapter content rectangles include viewport padding; persisted anchors use unrotated PDF page coordinates. Page navigation preserves a visual offset, while layout restoration preserves a PDF point.
- A selected reading area is temporary: its rectangle is used to calculate one zoom level and center it, then discarded. Fit area is a one-shot action; each click starts a new selection. Later navigation uses ordinary scrolling behavior. Fit page and Fit width continue to use the whole page.
- `reading-region-input.ts` reuses the Rectangle tool's handler with view-only preview/commit callbacks. `reading-region-layer.tsx` registers it with an exclusive page interaction mode and shows a brief drawing hint. It never submits annotations to the engine.
- DOM measurements are local to one operation. Small-scroll frames read only position and vertical bounds, passing that snapshot to the writer. Plugin metrics remain the source for the zoom plugin's computed post-zoom correction. Geometry is not cached across resize, rotation or document replacement.
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
| Set a reading area | Fit and center the selected rectangle once, then discard it |
| Navigate after selecting a reading area | Use the ordinary navigation behavior |
| Reload the document | Start without a reading area |

Right mouse drags are handled by `mouse-page-gesture.ts`, installed with stage navigation input. Drag left/right or up/down at least 40 CSS pixels with one axis at least 1.2 times the other (left/up advances; right/down goes back), then release to move forward/back by one page through `navigation/move-pages` and the stage's existing smooth navigation. Short right clicks preserve the selection menu. A grabbing cursor appears after holding for 150ms or moving 8 CSS pixels, and is cleared on release or cancellation. Early context menus are deferred until release; drags suppress menus. Pointer capture keeps releases outside the viewport observable. Escape, pointer cancellation, lost pointer capture, extra buttons and window blur cancel the gesture. Editable controls, overlays and reading-region selection do not start page gestures.

Add new spatial/layout rules in `ViewerStage`, not toolbar callbacks or persistence code. Keep modality-specific input rules in the stage input controller. Use `StageSnapshot` for visible page/layout UI instead of subscribing to spatial plugins again.
