# Glossary

## Documents and identity

| Term | Meaning |
| --- | --- |
| Original | PDF bytes on disk or in the browser file system, excluding unsaved edits. |
| `PlatformDocument` | An opened resource with write access, an optional reading-history key, and external-change monitoring. |
| `ManagedResource` | A readable URL, optional stream, and release capability. Its URL is not a stable file identity. |
| `sharedIdentity` | File identity used for sharing. Compare file handles with `isSameEntry`, not filenames. |
| `documentId` / `sessionKey` | Worker session identifiers, currently equal; neither a path nor a content hash. |
| Shared document | A session for a file identity and known content version, sharing edits and history across tabs. |
| `documentKey` | Reading-history key; distinct from shared file identity. |
| Tab | Owner of independent UI, navigation, selection, and rendering caches. |

## Versions and persistence

| Term | Meaning |
| --- | --- |
| `revision` | Increasing edit counter within a session, not a content hash. |
| `savedRevision` | Last edit revision confirmed written to the original. |
| `diskVersion` | Original PDF content version tracked by the save coordinator to detect external changes. |
| `candidateVersion` | Output hash used to recognize files reopened during a save. |
| Save to PDF | Serialize the full PDF and confirm the original's version through the writer. Downloading a copy does not confirm a save. |
| Copy | Independent export; does not advance `diskVersion` or `savedRevision`. |
| `PdfWritePlan` | Worker-provided target, PDF bytes, expected original version, and output version. The platform returns a `PdfWriteResult`. |
| `SaveLane` | Per-file FIFO for saves, queued draft writes, and cleanup; separate from the native queue. |
| Draft | Recovery data for annotations and supported form values: desktop `.swp` or private browser storage. Not a full PDF or backup. |
| `baseVersion` | Original PDF version required to restore a draft. |
| `draftRevision` | Persisted draft revision; does not indicate a saved PDF. |
| Draft storage version | Compare-and-swap token, separate from `baseVersion` and `revision`. |
| Merge | Write edits into a full PDF, then clear or rebuild the draft. `mergeOutputVersion` identifies drafts left after a completed write. |
| Baseline | Original annotations, forms, and pages used to calculate net changes. |
| Conflict | File or draft version mismatch; must not be silently overwritten. |

## Runtime and rendering

| Term | Meaning |
| --- | --- |
| Platform | Adapter for files, permissions, preferences, and external services. |
| Launcher | Go desktop entry point and local service in `desktop/`; handles files and browser launch. |
| Host | Worker owner of document state, history, and persistence coordination. |
| Client | Tab entry point to worker document capabilities. |
| Native runtime | PDFium WASM and its lifecycle inside the worker. |
| Native queue | Serializes native document operations; must not remain occupied waiting for disk or tab responses. |
| Stage | EmbedPDF viewport, page layout, and interaction coordinates. |
| Raster | Rendered pixels: a base image or a high-resolution tile. |
| `CanvasRenderLayer` | Tab layer that paints base images and tiles. |
| `pageIndex` / `pageNumber` | Zero-based internal index / one-based user-facing number. |
| PDF point | Document coordinate unit, distinct from CSS and device pixels. |
| DPR | Device pixels per CSS pixel. |
| Transferable buffer | Bytes transferred between workers and tabs; the sender loses access after transfer. |
| Deep module | A small capability interface that encapsulates policy, invariants, and internal coordination. |

## Capabilities

| Term | Meaning |
| --- | --- |
| `AiService` | Optional AI requests and configuration. An absent platform `ai` means unsupported; missing methods must not signal partial support. |
| `DocumentOutput` | Created by `createDocumentOutput` for one document context; prepares serialization and writes for saves and exports. |
| `ViewCheckpoint` | Temporary layout, zoom, rotation, mode, and reading anchor captured during document replacement; not persistent history or PDF edits. |
