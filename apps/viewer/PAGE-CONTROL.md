# Page control

`ViewerStage` keeps the application's navigation vocabulary and reading/presentation state. Its public zoom, layout, reading-area, and history methods are unchanged; its implementation delegates to the document's native EmbedPDF v3 `StageToken`.

`StageScrollAdapter` translates our one-based page numbers and persisted reading positions to v3 page indexes and viewpoints. The native stage owns coordinate projection, anchor preservation, layout, rotation, bounded scrolling, and animation. We no longer duplicate those calculations in an SDK-specific viewport adapter.

`NativePdfStage` mounts the v3 camera surface and its scrollbars with the existing application classes. Native pointer handling owns text selection, touch pan, pinch, momentum, and middle-button pan. `stage-input-controller.ts` retains the application's frame-coalesced Ctrl/Cmd+wheel sensitivity and fit-page/fit-width detents; it captures only zoom wheels to prevent double handling by the native surface.

Reading-area selection is a native interaction tool registered by `ViewerStage`. It previews a page-space rectangle and calls the stage's `reveal({zoom:'fit'})`. It never writes an annotation or dirties the PDF.

The native v3 `RenderLayer` owns base raster and tile retention, invalidation, cancellation, and image lifetime. The application wrapper retains startup status and stable paint-readiness hooks.

The stage is camera-based rather than a DOM scroll container. Browser checks must navigate with wheel, scrollbar, or application controls; assigning `.viewer.scrollTop` no longer navigates the document.
