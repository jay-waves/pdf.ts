# Page control

`ViewerStage` keeps the application's navigation vocabulary and reading/presentation state. Its public zoom, layout, reading-area, and history methods are unchanged; its implementation delegates to the document's native EmbedPDF v3 `StageToken`.

`StageScrollAdapter` translates our one-based page numbers and persisted reading positions to v3 page indexes and viewpoints. The native stage owns coordinate projection, anchor preservation, layout, rotation, bounded scrolling, and animation. We no longer duplicate those calculations in an SDK-specific viewport adapter.

`NativePdfStage` mounts the v3 camera surface and its scrollbars with the existing application classes. Native pointer handling owns text selection, touch pan, pinch, momentum, and middle-button pan. `stage-input-controller.ts` retains the application's frame-coalesced Ctrl/Cmd+wheel sensitivity and fit-page/fit-width detents; ordinary vertical wheel input follows one damped path without device inference. Both paths prevent duplicate native handling. Reduced-motion preferences disable wheel easing.

Reading-area selection is a native interaction tool registered by `ViewerStage`. It previews a page-space rectangle and calls the stage's `reveal({zoom:'fit'})`. It never writes an annotation or dirties the PDF.

The native v3 `RenderLayer` owns base raster and tile retention, invalidation, cancellation, and image lifetime. The application wrapper retains startup status and an app-owned raster container for paint-readiness checks. It does not mutate SDK image elements.

The stage is camera-based rather than a DOM scroll container. Browser checks must navigate with wheel, scrollbar, or application controls; assigning `.viewer.scrollTop` no longer navigates the document.

Control visibility uses explicit show/hide/toggle requests. Mouse edge hover stays local to each control; touch tap toggles controls and a touch drag hides them. Right-button gesture arbitration belongs to `mouse-page-gesture.ts`; menus consume the resulting context-menu event.
