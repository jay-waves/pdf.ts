import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPluginRegistration, type PluginRegistry } from '@embedpdf/core';
import { EmbedPDF } from '@embedpdf/core/react';
import { browserImageDataToBlobConverter, type ImageDataConverter } from '@embedpdf/engines/converters';
import { usePdfiumEngine } from '@embedpdf/engines/react';
import { Rotation, type PdfEngine } from '@embedpdf/models';
import pdfiumWasmUrl from '@embedpdf/pdfium/pdfium.wasm?url';
import { AnnotationLayer, AnnotationPluginPackage, LockModeType, type AnnotationCapability } from '@embedpdf/plugin-annotation/react';
import { BookmarkPluginPackage } from '@embedpdf/plugin-bookmark/react';
import { DocumentContent, DocumentManagerPluginPackage } from '@embedpdf/plugin-document-manager/react';
import { ExportPluginPackage } from '@embedpdf/plugin-export/react';
import { FormPluginPackage } from '@embedpdf/plugin-form/react';
import { HistoryPluginPackage } from '@embedpdf/plugin-history/react';
import { GlobalPointerProvider, InteractionManagerPluginPackage, PagePointerProvider } from '@embedpdf/plugin-interaction-manager/react';
import { PanPluginPackage, type PanCapability } from '@embedpdf/plugin-pan/react';
import { PrintPluginPackage } from '@embedpdf/plugin-print/react';
import { RenderLayer, RenderPluginPackage } from '@embedpdf/plugin-render/react';
import { Rotate, RotatePluginPackage } from '@embedpdf/plugin-rotate/react';
import { Scroller, ScrollPluginPackage, ScrollStrategy } from '@embedpdf/plugin-scroll/react';
import { SearchLayer, SearchPluginPackage } from '@embedpdf/plugin-search/react';
import { SelectionLayer, SelectionPluginPackage } from '@embedpdf/plugin-selection/react';
import { SpreadMode, SpreadPluginPackage } from '@embedpdf/plugin-spread/react';
import { TilingLayer, TilingPluginPackage } from '@embedpdf/plugin-tiling/react';
import { Viewport, ViewportPluginPackage } from '@embedpdf/plugin-viewport/react';
import { ZoomMode, ZoomPluginPackage, type ZoomCapability } from '@embedpdf/plugin-zoom/react';
import './viewer.css';
import {
  EMPTY_CLEANUP,
  getActiveDocumentId,
  getDocumentScrollStrategy,
  getFileNameFromUrl,
  getPluginCapability,
  type ScrollCapability,
} from './utils';
import {
  BottomNavigationControl,
  Outline,
  getCurrentBookmarkTitle,
  installCurrentTitleTracker,
  installOutlinePrefetch,
  installPageKeyboardNavigation,
  type OutlineCache,
} from './outline';
import { installSearchKeyboardShortcut } from './search';
import {
  initializeViewerTheme,
  setViewerScrollStrategyAttribute,
} from './theme';
import { Toolbar } from './toolbar';
import { Thumbnails } from './thumbnails';
import { ColorPalette } from './color-palette';
import { Comments } from './comments';
import { PrintDialog, ProtectDialog } from './document-dialogs';
import { ContextMenu } from './context-menu';
import { TooltipProvider } from './components';
import { ZoomGesture } from './zoom-gesture';
import { savePdf } from './pdf-save';
import { SelectionTranslate, type SelectionTranslationRequest } from './selection-translate';
import { installReadingHistory as installPlatformReadingHistory } from './reading-history';
import { documentEditingEnabled, platform } from '#platform';
import type { ManagedResource, ViewerResources } from './platform/types';

const RENDER_IMAGE_TYPE = 'image/bmp';
const TILING_TILE_SIZE = 768;
const TILING_OVERLAP_PX = 2;
const TILING_EXTRA_RINGS = 0;
const MAX_RENDER_DPR = 1.75;
const NAVIGATION_AUTO_HIDE_DELAY_MS = 1200;
const BUNDLED_PDFIUM_WASM_URL = new URL(pdfiumWasmUrl, import.meta.url).href;
// usePdfiumEngine tracks fontFallback by reference. Keep it module-stable so
// ordinary React re-renders cannot tear down and recreate the WASM engine.
const PDFIUM_FONT_FALLBACK = { fonts: {} };
const bmpConfiguredEngines = new WeakSet<object>();

function configureBundledBmpEngine(engine: PdfEngine<Blob> | null) {
  if (!engine || bmpConfiguredEngines.has(engine)) return engine;
  const internalEngine = engine as PdfEngine<Blob> & {
    options?: { imageConverter: ImageDataConverter<Blob> };
  };
  const currentConverter = internalEngine.options?.imageConverter;
  if (!currentConverter || !internalEngine.options) return engine;

  currentConverter.destroy?.();
  internalEngine.options.imageConverter = (getImageData, imageType, quality) => (
    browserImageDataToBlobConverter(getImageData, imageType ?? RENDER_IMAGE_TYPE, quality)
  );
  bmpConfiguredEngines.add(engine);
  return engine;
}

function handleBeforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault();
  event.returnValue = '';
}

function ActiveDocumentTracker({ documentId, onChange }: {
  documentId: string | null;
  onChange(documentId: string | null): void;
}) {
  useEffect(() => onChange(documentId), [documentId, onChange]);
  return null;
}

function ResourceConsumedNotifier({ resource, onConsumed }: {
  resource?: ManagedResource;
  onConsumed(resource?: ManagedResource): void;
}) {
  useEffect(() => onConsumed(resource), [onConsumed, resource]);
  return null;
}

function installUnsavedChangesTracker(registry: PluginRegistry, onDirtyChange: (dirty: boolean) => void) {
  const annotation = getPluginCapability<AnnotationCapability>(registry, 'annotation');

  if (!annotation) {
    return EMPTY_CLEANUP;
  }

  return annotation.onAnnotationEvent((event) => {
    // Each edit emits an uncommitted event immediately and another event after
    // PDFium catches up. Mark it dirty at the first event so a quick close/save
    // cannot slip through the asynchronous commit window.
    if (event.type !== 'loaded' && !event.committed) {
      onDirtyChange(true);
    }
  });
}

function installAnnotationUriNavigation(registry: PluginRegistry) {
  const annotation = getPluginCapability<AnnotationCapability>(registry, 'annotation');
  if (!annotation) return EMPTY_CLEANUP;

  return annotation.onNavigate((event) => {
    if (event.result.outcome === 'uri') platform.openExternal(event.result.uri);
  });
}

function installAll(installers: Array<() => () => void>) {
  const cleanups: Array<() => void> = [];
  const cleanup = () => {
    while (cleanups.length) cleanups.pop()!();
  };

  try {
    for (const install of installers) cleanups.push(install());
  } catch (error) {
    cleanup();
    throw error;
  }

  return cleanup;
}

function installScrollStrategyAttribute(registry: PluginRegistry) {
  const scroll = getPluginCapability<ScrollCapability>(registry, 'scroll');
  if (!scroll) {
    return EMPTY_CLEANUP;
  }

  const sync = (strategy?: ScrollStrategy) => {
    const documentId = getActiveDocumentId(registry);
    const current = strategy ?? (documentId ? getDocumentScrollStrategy(registry, documentId) : ScrollStrategy.Vertical);
    setViewerScrollStrategyAttribute(current === ScrollStrategy.Horizontal ? 'horizontal' : 'vertical');
  };

  sync();
  return scroll.onStateChange((state) => sync(state.strategy));
}

function installRenderDprCap(maxDpr: number) {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
  const originalDpr = window.devicePixelRatio || 1;
  let nativeDescriptor: PropertyDescriptor | undefined = descriptor;

  for (let target = Object.getPrototypeOf(window); !nativeDescriptor && target; target = Object.getPrototypeOf(target)) {
    nativeDescriptor = Object.getOwnPropertyDescriptor(target, 'devicePixelRatio');
  }

  const getNativeDpr = () => {
    if (nativeDescriptor?.get) {
      return nativeDescriptor.get.call(window) || originalDpr;
    }

    return originalDpr;
  };

  try {
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      get: () => Math.min(getNativeDpr(), maxDpr),
    });
  } catch {
    return EMPTY_CLEANUP;
  }

  return () => {
    try {
      if (descriptor) {
        Object.defineProperty(window, 'devicePixelRatio', descriptor);
      } else {
        Reflect.deleteProperty(window, 'devicePixelRatio');
      }
    } catch {
      // Leaving the capped DPR in place is safer than throwing during unmount.
    }
  };
}

function installPdfZoomKeyboardShortcuts(registry: PluginRegistry) {
  const onKeyDown = (event: KeyboardEvent) => {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }

    if (event.key !== '+' && event.key !== '=' && event.key !== '-' && event.key !== '_' && event.key !== '0') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const documentId = getActiveDocumentId(registry);
    const zoom = getPluginCapability<ZoomCapability>(registry, 'zoom');
    if (!documentId || !zoom) {
      return;
    }

    const zoomScope = zoom.forDocument(documentId);
    if (event.key === '0') {
      zoomScope.requestZoom(ZoomMode.FitPage);
    } else if (event.key === '-' || event.key === '_') {
      zoomScope.zoomOut();
    } else {
      zoomScope.zoomIn();
    }
  };

  window.addEventListener('keydown', onKeyDown, { capture: true });

  return () => {
    window.removeEventListener('keydown', onKeyDown, { capture: true });
  };
}

function installMiddleMousePanInterceptor(registry: PluginRegistry) {
  let activeDocumentId: string | null = null;
  let restorePan = false;
  let restoreTimer = 0;
  let pendingRestore: { documentId: string; shouldRestorePan: boolean } | null = null;

  const getPanScope = () => {
    const documentId = getActiveDocumentId(registry);
    const pan = getPluginCapability<PanCapability>(registry, 'pan');

    if (!documentId || !pan) {
      return null;
    }

    return {
      documentId,
      scope: pan.forDocument(documentId),
    };
  };

  const startMiddleMousePan = (event: PointerEvent) => {
    if (event.button !== 1) {
      return;
    }

    event.preventDefault();

    if (activeDocumentId) {
      return;
    }

    const panScope = getPanScope();
    if (!panScope) {
      return;
    }

    let inheritedRestorePan = false;
    if (restoreTimer && pendingRestore) {
      window.clearTimeout(restoreTimer);
      restoreTimer = 0;
      if (pendingRestore.documentId === panScope.documentId) {
        inheritedRestorePan = pendingRestore.shouldRestorePan;
      } else if (pendingRestore.shouldRestorePan) {
        const pan = getPluginCapability<PanCapability>(registry, 'pan');
        pan?.forDocument(pendingRestore.documentId).disablePan();
      }
      pendingRestore = null;
    }
    activeDocumentId = panScope.documentId;
    // A quick second press can arrive before the previous delayed restore. In
    // that case isPanMode() still reflects our temporary mode, so carry the
    // original mode across presses instead of treating PAN as user-selected.
    restorePan = inheritedRestorePan || !panScope.scope.isPanMode();
    panScope.scope.enablePan();
  };

  const finishMiddleMousePan = (event?: PointerEvent | Event) => {
    if (!activeDocumentId || (event instanceof PointerEvent && event.type !== 'pointercancel' && event.button !== 1)) {
      return;
    }

    if (event?.cancelable) event.preventDefault();
    pendingRestore = { documentId: activeDocumentId, shouldRestorePan: restorePan };
    activeDocumentId = null;
    restorePan = false;

    restoreTimer = window.setTimeout(() => {
      restoreTimer = 0;
      const restore = pendingRestore;
      pendingRestore = null;
      if (!restore?.shouldRestorePan) {
        return;
      }

      const pan = getPluginCapability<PanCapability>(registry, 'pan');
      pan?.forDocument(restore.documentId).disablePan();
    }, 120);
  };

  const finishIfMiddleButtonWasLost = (event: PointerEvent) => {
    if (activeDocumentId && (event.buttons & 4) === 0) finishMiddleMousePan(event);
  };

  const stopBrowserMiddleMouse = (event: MouseEvent) => {
    if (event.button !== 1) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  };

  window.addEventListener('pointerdown', startMiddleMousePan, { capture: true });
  window.addEventListener('pointerup', finishMiddleMousePan);
  window.addEventListener('pointercancel', finishMiddleMousePan);
  window.addEventListener('pointermove', finishIfMiddleButtonWasLost);
  window.addEventListener('blur', finishMiddleMousePan);
  window.addEventListener('auxclick', stopBrowserMiddleMouse, { capture: true });

  return () => {
    if (restoreTimer) window.clearTimeout(restoreTimer);
    window.removeEventListener('pointerdown', startMiddleMousePan, { capture: true });
    window.removeEventListener('pointerup', finishMiddleMousePan);
    window.removeEventListener('pointercancel', finishMiddleMousePan);
    window.removeEventListener('pointermove', finishIfMiddleButtonWasLost);
    window.removeEventListener('blur', finishMiddleMousePan);
    window.removeEventListener('auxclick', stopBrowserMiddleMouse, { capture: true });
  };
}

interface AppProps {
  fileUrl?: string;
  sourceUrl?: string;
  documentKey?: string;
  documentName?: string;
  wasmResource: ManagedResource;
  documentResource?: ManagedResource;
  onResourceConsumed(resource?: ManagedResource): void;
}

type CommentTarget = { annotationId: string; isNew: boolean };
type SidePanel =
  | { type: 'outline' | 'thumbnails' | 'colors' }
  | { type: 'comments'; target: CommentTarget | null }
  | null;
type ActiveDialog = 'print' | 'protect' | null;
type DocumentViewState = { pageNumber: number; totalPages: number; title: string };

const INITIAL_DOCUMENT_VIEW: DocumentViewState = { pageNumber: 1, totalPages: 0, title: '' };

function createViewerPlugins(fileUrl?: string) {
  return [
    createPluginRegistration(DocumentManagerPluginPackage, {
      initialDocuments: fileUrl ? [{ url: fileUrl }] : [],
    }),
    createPluginRegistration(ViewportPluginPackage, { viewportGap: 10 }),
    createPluginRegistration(ScrollPluginPackage, {
      defaultStrategy: ScrollStrategy.Vertical,
      defaultPageGap: 10,
      defaultBufferSize: 2,
    }),
    createPluginRegistration(RenderPluginPackage, { defaultImageType: RENDER_IMAGE_TYPE }),
    createPluginRegistration(TilingPluginPackage, {
      defaultImageType: RENDER_IMAGE_TYPE,
      tileSize: TILING_TILE_SIZE,
      overlapPx: TILING_OVERLAP_PX,
      extraRings: TILING_EXTRA_RINGS,
    }),
    createPluginRegistration(ZoomPluginPackage, { defaultZoomLevel: ZoomMode.FitPage }),
    createPluginRegistration(SpreadPluginPackage, { defaultSpreadMode: SpreadMode.None }),
    createPluginRegistration(RotatePluginPackage, { defaultRotation: Rotation.Degree0 }),
    createPluginRegistration(InteractionManagerPluginPackage),
    createPluginRegistration(PanPluginPackage, { defaultMode: 'mobile' }),
    createPluginRegistration(SelectionPluginPackage, { maxCachedGeometries: 8 }),
    createPluginRegistration(AnnotationPluginPackage, documentEditingEnabled ? {
      locked: { type: LockModeType.Include, categories: ['form', 'link'] },
      autoOpenLinks: false,
      deactivateToolAfterCreate: true,
      tools: [
        ...['square', 'lineArrow', 'ink'].map((id) => ({ id, defaults: { strokeWidth: 2 } })),
        // Locked link annotations remain interactive for URI and destination navigation.
        { id: 'link', categories: ['link'] },
      ],
    } : {
      // The read-only viewer still needs annotations for clickable PDF links.
      locked: { type: LockModeType.All },
      autoOpenLinks: false,
    }),
    ...(documentEditingEnabled ? [
      createPluginRegistration(HistoryPluginPackage),
      createPluginRegistration(FormPluginPackage),
    ] : []),
    createPluginRegistration(SearchPluginPackage),
    createPluginRegistration(BookmarkPluginPackage),
    createPluginRegistration(PrintPluginPackage),
    ...(documentEditingEnabled ? [
      createPluginRegistration(ExportPluginPackage, { defaultFileName: 'document.pdf' }),
    ] : []),
  ];
}

function App({
  fileUrl,
  sourceUrl,
  documentKey,
  documentName,
  wasmResource,
  documentResource,
  onResourceConsumed,
}: AppProps) {
  const { engine: workerEngine, isLoading: engineLoading, error: engineError } = usePdfiumEngine({
    wasmUrl: wasmResource.url,
    worker: true,
    encoderPoolSize: 0, // Bundled BMP conversion uses no encoder workers.
    fontFallback: PDFIUM_FONT_FALLBACK,
  });
  const engine = configureBundledBmpEngine(workerEngine);
  const saveInProgressRef = useRef(false);
  const [registry, setRegistry] = useState<PluginRegistry>();
  const [toolbarDocumentId, setToolbarDocumentId] = useState<string | null>(null);
  const [toolbarInset, setToolbarInset] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sidePanel, setSidePanel] = useState<SidePanel>(null);
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null);
  const [translationRequest, setTranslationRequest] = useState<SelectionTranslationRequest | null>(null);
  const [outlineCache, setOutlineCache] = useState<OutlineCache>({
    status: 'idle',
    bookmarks: [],
  });
  const [documentView, setDocumentView] = useState(INITIAL_DOCUMENT_VIEW);
  const [navigationVisible, setNavigationVisible] = useState(false);
  const { pageNumber: currentPageNumber, totalPages, title: currentTitle } = documentView;
  const commentTarget = sidePanel?.type === 'comments' ? sidePanel.target : null;
  const viewerRootRef = useRef<HTMLElement>(null);
  const registryCleanupRef = useRef<(() => void) | null>(null);
  const outlineCacheRef = useRef(outlineCache);
  const currentPageNumberRef = useRef(1);
  const titleTrackerRefreshRef = useRef<(() => void) | null>(null);
  const changeTrackerRef = useRef({ dirty: false, version: 0 });
  const cleanDocumentTitleRef = useRef(document.title);
  const navigationHideTimerRef = useRef<number>(0);
  const navigationVisibleRef = useRef(false);

  const renderDocumentTitle = () => {
    document.title = `${changeTrackerRef.current.dirty ? '*' : ''}${cleanDocumentTitleRef.current}`;
  };

  const setHasUnsavedChanges = (dirty: boolean) => {
    if (dirty) changeTrackerRef.current.version++;
    changeTrackerRef.current.dirty = dirty;
    if (dirty) {
      window.addEventListener('beforeunload', handleBeforeUnload);
    } else {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    }
    renderDocumentTitle();
  };

  const revealNavigation = () => {
    if (!navigationVisibleRef.current) {
      navigationVisibleRef.current = true;
      setNavigationVisible(true);
    }

    if (navigationHideTimerRef.current) {
      window.clearTimeout(navigationHideTimerRef.current);
    }

    navigationHideTimerRef.current = window.setTimeout(() => {
      if (navigationVisibleRef.current) {
        navigationVisibleRef.current = false;
        setNavigationVisible(false);
      }
      navigationHideTimerRef.current = 0;
    }, NAVIGATION_AUTO_HIDE_DELAY_MS);
  };

  useEffect(() => {
    outlineCacheRef.current = outlineCache;
    titleTrackerRefreshRef.current?.();
  }, [outlineCache]);

  useEffect(() => {
    currentPageNumberRef.current = currentPageNumber;
    revealNavigation();
  }, [currentPageNumber]);

  useEffect(() => {
    initializeViewerTheme();
  }, []);

  useEffect(() => {
    if (!documentEditingEnabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (saveInProgressRef.current) return;

        const changeVersionAtSaveStart = changeTrackerRef.current.version;
        saveInProgressRef.current = true;
        savePdf(registry, { sourceUrl, fileName: documentName })
          .then((saved) => {
            if (!saved) {
              return;
            }

            // A new edit may have landed while PDF serialization or disk I/O
            // was in progress. Keep the dirty marker in that case.
            if (changeTrackerRef.current.version === changeVersionAtSaveStart) {
              setHasUnsavedChanges(false);
            }
          })
          .catch((error) => {
            if (!(error instanceof DOMException && error.name === 'AbortError')) {
              console.error('[pdf-ts] failed to save PDF', error);
            }
          })
          .finally(() => {
            saveInProgressRef.current = false;
          });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [documentName, registry, sourceUrl]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (window.innerHeight - event.clientY <= 96) {
        revealNavigation();
      }
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });

    return () => {
      if (navigationHideTimerRef.current) {
        window.clearTimeout(navigationHideTimerRef.current);
      }
      window.removeEventListener('pointermove', onPointerMove);
    };
  }, []);

  const plugins = useMemo(() => createViewerPlugins(fileUrl), [fileUrl]);

  useEffect(() => {
    cleanDocumentTitleRef.current = documentName ?? (fileUrl ? getFileNameFromUrl(fileUrl) : undefined) ?? 'PDF';
    renderDocumentTitle();
  }, [documentName, fileUrl]);

  useEffect(() => {
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      registryCleanupRef.current?.();
      registryCleanupRef.current = null;
    };
  }, []);

  return (
    <main ref={viewerRootRef} className="app-shell" style={{ paddingTop: toolbarInset }}>
      {engine ? (
        <EmbedPDF
          engine={engine}
          plugins={plugins}
          onInitialized={async (nextRegistry) => {
            registryCleanupRef.current?.();
            registryCleanupRef.current = null;

            setRegistry(nextRegistry);
            setOutlineCache({ status: 'idle', bookmarks: [] });
            setDocumentView(INITIAL_DOCUMENT_VIEW);
            setSidePanel(null);
            setActiveDialog(null);
            setTranslationRequest(null);
            setHasUnsavedChanges(false);
            if (navigationVisibleRef.current) {
              navigationVisibleRef.current = false;
              setNavigationVisible(false);
            }

            const refreshCurrentTitle = () => {
              const pageNumber = currentPageNumberRef.current;
              const title = getCurrentBookmarkTitle(outlineCacheRef.current.bookmarks, pageNumber);
              setDocumentView((current) => current.title === title ? current : { ...current, title });
            };

            titleTrackerRefreshRef.current = refreshCurrentTitle;

            const installers = [
              () => installPageKeyboardNavigation(nextRegistry, revealNavigation),
              () => installPdfZoomKeyboardShortcuts(nextRegistry),
              () => installScrollStrategyAttribute(nextRegistry),
              () => installMiddleMousePanInterceptor(nextRegistry),
              () => installAnnotationUriNavigation(nextRegistry),
              ...(documentEditingEnabled ? [() => installUnsavedChangesTracker(nextRegistry, setHasUnsavedChanges)] : []),
              () => installPlatformReadingHistory(nextRegistry, documentKey),
              () => installCurrentTitleTracker(nextRegistry, () => outlineCacheRef.current.bookmarks, ({ pageNumber, title, totalPages: nextTotalPages }) => {
                currentPageNumberRef.current = pageNumber;
                setDocumentView({ pageNumber, title, totalPages: nextTotalPages });
              }),
              () => installSearchKeyboardShortcut(() => setSearchOpen(true)),
              () => installOutlinePrefetch(nextRegistry, setOutlineCache, documentKey),
            ];

            const cleanupPlugins = installAll(installers);

            registryCleanupRef.current = () => {
              titleTrackerRefreshRef.current = null;
              cleanupPlugins();
            };
          }}
        >
          {({ activeDocumentId }) => (
            <>
              <ActiveDocumentTracker documentId={activeDocumentId} onChange={setToolbarDocumentId} />
              {activeDocumentId ? (
                <DocumentContent documentId={activeDocumentId}>
                  {({ isLoading, isError, isLoaded }) => (
                    <>
                      {isLoading && <div className="viewer-status">Loading document...</div>}
                      {isError && <div className="viewer-status viewer-status-error">Unable to load PDF.</div>}
                      {isLoaded && (
                        <>
                          <ResourceConsumedNotifier resource={wasmResource} onConsumed={onResourceConsumed} />
                          <ResourceConsumedNotifier resource={documentResource} onConsumed={onResourceConsumed} />
                          <GlobalPointerProvider documentId={activeDocumentId}>
                            <Viewport
                              documentId={activeDocumentId}
                              className="viewer"
                              onDragStart={(event) => event.preventDefault()}
                            >
                              <ZoomGesture documentId={activeDocumentId}>
                                <Scroller
                                  documentId={activeDocumentId}
                                  className="pdf-scroller"
                                  renderPage={({ pageIndex, width, height }) => (
                                    <Rotate documentId={activeDocumentId} pageIndex={pageIndex}>
                                      <PagePointerProvider
                                        documentId={activeDocumentId}
                                        pageIndex={pageIndex}
                                        style={{ position: 'relative', width, height, backgroundColor: '#fff' }}
                                      >
                                        <RenderLayer
                                          documentId={activeDocumentId}
                                          pageIndex={pageIndex}
                                          scale={0.5}
                                          className="shnctl-page-render-image"
                                          draggable={false}
                                          style={{ pointerEvents: 'none' }}
                                        />
                                        <TilingLayer
                                          documentId={activeDocumentId}
                                          pageIndex={pageIndex}
                                          className="shnctl-page-tiling-layer"
                                        />
                                        <SearchLayer documentId={activeDocumentId} pageIndex={pageIndex} />
                                        <SelectionLayer documentId={activeDocumentId} pageIndex={pageIndex} />
                                        <AnnotationLayer documentId={activeDocumentId} pageIndex={pageIndex} />
                                      </PagePointerProvider>
                                    </Rotate>
                                  )}
                                />
                              </ZoomGesture>
                            </Viewport>
                          </GlobalPointerProvider>
                        </>
                      )}
                    </>
                  )}
                </DocumentContent>
              ) : (
                <div className="viewer-status">No PDF document.</div>
              )}
              <Thumbnails
                registry={registry}
                open={sidePanel?.type === 'thumbnails'}
                totalPages={totalPages}
                currentPageNumber={currentPageNumber}
                onClose={() => setSidePanel(null)}
              />
            </>
          )}
        </EmbedPDF>
      ) : (
        <div className="viewer-status viewer-status-error">
          {engineError ? `Unable to initialize PDF engine: ${engineError.message}` : engineLoading ? 'Loading PDF engine...' : 'PDF engine unavailable.'}
        </div>
      )}
      <Toolbar
        registry={registry}
        activeDocumentId={toolbarDocumentId}
        searchOpen={searchOpen}
        thumbnailsOpen={sidePanel?.type === 'thumbnails'}
        colorPaletteOpen={sidePanel?.type === 'colors'}
        commentsOpen={sidePanel?.type === 'comments'}
        onSearchOpenChange={setSearchOpen}
        onToggleThumbnails={() => setSidePanel((current) => (
          current?.type === 'thumbnails' ? null : { type: 'thumbnails' }
        ))}
        onToggleColorPalette={() => setSidePanel((current) => (
          current?.type === 'colors' ? null : { type: 'colors' }
        ))}
        onToggleComments={() => setSidePanel((current) => (
          current?.type === 'comments' ? null : { type: 'comments', target: null }
        ))}
        onOpenPrint={() => {
          setSidePanel(null);
          setActiveDialog('print');
        }}
        onOpenProtect={() => {
          setSidePanel(null);
          setActiveDialog('protect');
        }}
        onPinnedInsetChange={setToolbarInset}
      />
      <Outline
        registry={registry}
        open={sidePanel?.type === 'outline'}
        cache={outlineCache}
        currentTitle={currentTitle}
        onCacheChange={setOutlineCache}
        onClose={() => setSidePanel(null)}
      />
      {documentEditingEnabled ? <ColorPalette
        registry={registry}
        open={sidePanel?.type === 'colors'}
        onClose={() => setSidePanel(null)}
      /> : null}
      {documentEditingEnabled ? <Comments
        engine={engine}
        registry={registry}
        open={sidePanel?.type === 'comments'}
        currentPageNumber={currentPageNumber}
        targetAnnotationId={commentTarget?.annotationId}
        targetAnnotationIsNew={commentTarget?.isNew}
        onClose={() => setSidePanel(null)}
      /> : null}
      <ContextMenu
        registry={registry}
        container={viewerRootRef.current}
        canEdit={documentEditingEnabled}
        canTranslate={Boolean(platform.translate)}
        onOpenComments={(annotationId, isNew) => setSidePanel({
          type: 'comments',
          target: { annotationId, isNew },
        })}
        onOpenColorPalette={() => setSidePanel({ type: 'colors' })}
        onTranslate={(documentId, anchor) => setTranslationRequest({
          documentId,
          anchor,
        })}
      />
      {platform.translate && translationRequest ? (
        <SelectionTranslate
          registry={registry}
          request={translationRequest}
          onClose={() => setTranslationRequest(null)}
        />
      ) : null}
      <PrintDialog
        registry={registry}
        open={activeDialog === 'print'}
        currentPageNumber={currentPageNumber}
        totalPages={totalPages}
        onClose={() => setActiveDialog(null)}
      />
      {documentEditingEnabled ? <ProtectDialog
        registry={registry}
        open={activeDialog === 'protect'}
        onClose={() => setActiveDialog(null)}
        onProtected={() => setHasUnsavedChanges(true)}
      /> : null}
      <BottomNavigationControl
        registry={registry}
        title={currentTitle}
        pageNumber={currentPageNumber}
        totalPages={totalPages}
        outlineStatus={outlineCache.status}
        visible={navigationVisible}
        onReveal={revealNavigation}
        onOpenOutline={() => {
          setSearchOpen(false);
          setSidePanel({ type: 'outline' });
        }}
      />
    </main>
  );
}

function WebDocumentPicker({ onSelect }: { onSelect(file: File): void }) {
  const [dragging, setDragging] = useState(false);
  const [selectionError, setSelectionError] = useState('');

  const selectFile = (file?: File) => {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setSelectionError('Please select a PDF file.');
      return;
    }
    setSelectionError('');
    onSelect(file);
  };

  return (
    <main className="web-welcome">
      <section
        className={`web-welcome-card${dragging ? ' is-dragging' : ''}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
            setDragging(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          selectFile(event.dataTransfer.files[0]);
        }}
      >
        <img className="web-welcome-logo" src="./logo.svg" alt="" />
        <h1>PDF.ts Web Viewer</h1>
        <label className="web-file-button">
          Choose a PDF file
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event) => selectFile(event.target.files?.[0])}
          />
        </label>
        <span className="web-drop-hint">or drop a PDF here</span>
        {selectionError ? <p className="web-selection-error" role="alert">{selectionError}</p> : null}
        <small>Local files are processed only in this browser tab and are never uploaded.</small>
      </section>
    </main>
  );
}

function ViewerBootstrap() {
  const [resources, setResources] = useState<ViewerResources>();
  const [error, setError] = useState<Error>();
  const managedResourcesRef = useRef(new Set<ManagedResource>());

  const trackResource = (resource?: ManagedResource) => {
    if (resource) managedResourcesRef.current.add(resource);
  };

  const releaseResource = (resource?: ManagedResource) => {
    if (!resource || !managedResourcesRef.current.delete(resource)) return;
    resource.release?.();
  };

  useEffect(() => installRenderDprCap(MAX_RENDER_DPR), []);

  useEffect(() => {
    let cancelled = false;
    platform.loadViewerResources(BUNDLED_PDFIUM_WASM_URL).then((loaded) => {
      trackResource(loaded.wasm);
      trackResource(loaded.document?.resource);
      if (cancelled) {
        releaseResource(loaded.wasm);
        releaseResource(loaded.document?.resource);
      } else {
        setResources(loaded);
      }
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason : new Error(String(reason)));
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => {
    for (const resource of managedResourcesRef.current) resource.release?.();
    managedResourcesRef.current.clear();
  }, []);

  if (error) {
    return <div className="viewer-status viewer-status-error">Unable to load PDF resources: {error.message}</div>;
  }

  if (!resources) {
    return <div className="viewer-status">Loading PDF resources...</div>;
  }

  if (platform.openLocalDocument && !resources.document) {
    const openLocalDocument = platform.openLocalDocument;
    return <WebDocumentPicker onSelect={(file) => {
      const document = openLocalDocument(file);
      trackResource(document.resource);
      setResources({ ...resources, document });
    }} />;
  }

  return (
    <App
      key={resources.document?.resource.url}
      fileUrl={resources.document?.resource.url}
      sourceUrl={resources.document?.sourceUrl}
      documentKey={resources.document?.key}
      documentName={resources.document?.name}
      wasmResource={resources.wasm}
      documentResource={resources.document?.resource}
      onResourceConsumed={releaseResource}
    />
  );
}

createRoot(document.getElementById('root')!).render(
  <TooltipProvider>
    <ViewerBootstrap />
  </TooltipProvider>,
);
