import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPluginRegistration, type PluginRegistry } from '@embedpdf/core';
import { EmbedPDF } from '@embedpdf/core/react';
import { usePdfiumEngine } from '@embedpdf/engines/react';
import { Rotation } from '@embedpdf/models';
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
import { savePdfToOriginalFile } from './file-handle';
import { SelectionTranslate, type SelectionTranslationRequest } from './selection-translate';
import { installReadingHistory as installPlatformReadingHistory } from './reading-history';
import { documentEditingEnabled, platform } from '#platform';

const MAX_RENDER_DPR = 1.5;
const RENDER_IMAGE_TYPE = 'image/bmp';
const TILING_TILE_SIZE = 768;
const TILING_OVERLAP_PX = 2;
const TILING_EXTRA_RINGS = 0;
const NAVIGATION_AUTO_HIDE_DELAY_MS = 1200;
const PDFIUM_WASM_URL = platform.getPdfiumWasmUrl(new URL(pdfiumWasmUrl, import.meta.url).href);
// usePdfiumEngine tracks fontFallback by reference. Keep it module-stable so
// ordinary React re-renders cannot tear down and recreate the WASM engine.
const PDFIUM_FONT_FALLBACK = { fonts: {} };

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

function installUnsavedChangesTracker(registry: PluginRegistry, onDirtyChange: (dirty: boolean) => void) {
  const annotation = registry.getPlugin('annotation')?.provides?.() as AnnotationCapability | undefined;

  if (!annotation) {
    return EMPTY_CLEANUP;
  }

  return annotation.onAnnotationEvent((event) => {
    if (event.type !== 'loaded' && event.committed) {
      onDirtyChange(true);
    }
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
  const scroll = registry.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;
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

function installRenderDprCap(maxDpr = MAX_RENDER_DPR) {
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
    const zoom = registry.getPlugin('zoom')?.provides?.() as ZoomCapability | undefined;
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
  let suppressMiddleMouseUntil = 0;

  const getPanScope = () => {
    const documentId = getActiveDocumentId(registry);
    const pan = registry.getPlugin('pan')?.provides?.() as PanCapability | undefined;

    if (!documentId || !pan) {
      return null;
    }

    return {
      documentId,
      scope: pan.forDocument(documentId),
    };
  };

  const startMiddleMousePan = (event: MouseEvent | PointerEvent) => {
    if (event.button !== 1) {
      return;
    }

    const isPointerEvent = event instanceof PointerEvent;

    if (activeDocumentId) {
      if (!isPointerEvent) {
        event.preventDefault();
      }
      return;
    }

    const panScope = getPanScope();
    if (!panScope) {
      return;
    }

    if (restoreTimer) {
      window.clearTimeout(restoreTimer);
      restoreTimer = 0;
    }
    if (!isPointerEvent) {
      event.preventDefault();
    }
    activeDocumentId = panScope.documentId;
    restorePan = !panScope.scope.isPanMode();
    panScope.scope.enablePan();
  };

  const finishMiddleMousePan = (event: MouseEvent | PointerEvent) => {
    if (event.button !== 1 || !activeDocumentId) {
      return;
    }

    event.preventDefault();
    suppressMiddleMouseUntil = performance.now() + 180;
    const documentId = activeDocumentId;
    const shouldRestorePan = restorePan;
    activeDocumentId = null;
    restorePan = false;

    restoreTimer = window.setTimeout(() => {
      restoreTimer = 0;
      if (!shouldRestorePan) {
        return;
      }

      const pan = registry.getPlugin('pan')?.provides?.() as PanCapability | undefined;
      pan?.forDocument(documentId).disablePan();
    }, 120);
  };

  const stopBrowserMiddleMouse = (event: MouseEvent | PointerEvent) => {
    if (event.button !== 1) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  };

  const suppressTailEvent = (event: MouseEvent | PointerEvent) => {
    if (event.button !== 1 || performance.now() > suppressMiddleMouseUntil) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  };

  window.addEventListener('pointerdown', startMiddleMousePan, { capture: true });
  window.addEventListener('mousedown', startMiddleMousePan, { capture: true });
  window.addEventListener('pointerup', finishMiddleMousePan);
  window.addEventListener('mouseup', finishMiddleMousePan);
  window.addEventListener('auxclick', stopBrowserMiddleMouse, { capture: true });
  window.addEventListener('pointermove', suppressTailEvent, { capture: true });
  window.addEventListener('pointerup', suppressTailEvent, { capture: true });
  window.addEventListener('click', suppressTailEvent, { capture: true });

  return () => {
    if (restoreTimer) window.clearTimeout(restoreTimer);
    window.removeEventListener('pointerdown', startMiddleMousePan, { capture: true });
    window.removeEventListener('mousedown', startMiddleMousePan, { capture: true });
    window.removeEventListener('pointerup', finishMiddleMousePan);
    window.removeEventListener('mouseup', finishMiddleMousePan);
    window.removeEventListener('auxclick', stopBrowserMiddleMouse, { capture: true });
    window.removeEventListener('pointermove', suppressTailEvent, { capture: true });
    window.removeEventListener('pointerup', suppressTailEvent, { capture: true });
    window.removeEventListener('click', suppressTailEvent, { capture: true });
  };
}

interface AppProps {
  fileUrl?: string;
  wasmUrl: string;
}

type SidePanel = 'outline' | 'thumbnails' | 'colors' | 'comments';

function App({ fileUrl, wasmUrl }: AppProps) {
  const documentKey = platform.getDocumentKey();
  const editingEnabled = documentEditingEnabled;
  const { engine, isLoading: engineLoading, error: engineError } = usePdfiumEngine({
    wasmUrl,
    worker: true,
    fontFallback: PDFIUM_FONT_FALLBACK,
  });
  const fileHandleRef = useRef<FileSystemFileHandle | null>(null);
  const saveInProgressRef = useRef(false);
  const [registry, setRegistry] = useState<PluginRegistry>();
  const [toolbarDocumentId, setToolbarDocumentId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sidePanel, setSidePanel] = useState<SidePanel | null>(null);
  const [commentTargetId, setCommentTargetId] = useState<string | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [protectOpen, setProtectOpen] = useState(false);
  const [translationRequest, setTranslationRequest] = useState<SelectionTranslationRequest | null>(null);
  const [outlineCache, setOutlineCache] = useState<OutlineCache>({
    status: 'idle',
    bookmarks: [],
  });
  const [currentPageNumber, setCurrentPageNumber] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [currentTitle, setCurrentTitle] = useState('');
  const [navigationVisible, setNavigationVisible] = useState(false);
  const viewerRootRef = useRef<HTMLElement>(null);
  const registryCleanupRef = useRef<(() => void) | null>(null);
  const outlineCacheRef = useRef(outlineCache);
  const currentPageNumberRef = useRef(1);
  const titleTrackerRefreshRef = useRef<(() => void) | null>(null);
  const hasUnsavedChangesRef = useRef(false);
  const cleanDocumentTitleRef = useRef(document.title);
  const navigationHideTimerRef = useRef<number>(0);
  const navigationVisibleRef = useRef(false);
  const translationRequestIdRef = useRef(0);

  const renderDocumentTitle = () => {
    const title = `${hasUnsavedChangesRef.current ? '*' : ''}${cleanDocumentTitleRef.current}`;
    document.title = title;
  };

  const setHasUnsavedChanges = (dirty: boolean) => {
    hasUnsavedChangesRef.current = dirty;
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
    if (!editingEnabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (saveInProgressRef.current) return;

        saveInProgressRef.current = true;
        savePdfToOriginalFile(registry, fileHandleRef, fileUrl)
          .then((saved) => {
            if (!saved) {
              return;
            }

            setHasUnsavedChanges(false);
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
  }, [editingEnabled, fileUrl, registry]);

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

  const plugins = useMemo(
    () => [
      createPluginRegistration(DocumentManagerPluginPackage, {
        initialDocuments: fileUrl ? [{ url: fileUrl }] : [],
      }),
      createPluginRegistration(ViewportPluginPackage, { viewportGap: 10 }),
      createPluginRegistration(ScrollPluginPackage, {
        defaultStrategy: ScrollStrategy.Vertical,
        defaultPageGap: 10,
      }),
      createPluginRegistration(RenderPluginPackage, {
        defaultImageType: RENDER_IMAGE_TYPE,
      }),
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
      createPluginRegistration(SelectionPluginPackage),
      ...(editingEnabled ? [
        createPluginRegistration(HistoryPluginPackage),
        createPluginRegistration(AnnotationPluginPackage, {
          locked: { type: LockModeType.Include, categories: ['form'] },
          deactivateToolAfterCreate: true,
          tools: ['square', 'lineArrow', 'ink'].map((id) => ({
            id,
            defaults: { strokeWidth: 2 },
          })),
        }),
        createPluginRegistration(FormPluginPackage),
      ] : []),
      createPluginRegistration(SearchPluginPackage),
      createPluginRegistration(BookmarkPluginPackage),
      createPluginRegistration(PrintPluginPackage),
      ...(editingEnabled ? [
        createPluginRegistration(ExportPluginPackage, { defaultFileName: 'document.pdf' }),
      ] : []),
    ],
    [editingEnabled, fileUrl],
  );

  useEffect(() => {
    cleanDocumentTitleRef.current = fileUrl ? getFileNameFromUrl(fileUrl) ?? 'PDF' : 'PDF';
    renderDocumentTitle();
  }, [fileUrl]);

  useEffect(() => {
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      registryCleanupRef.current?.();
      registryCleanupRef.current = null;
    };
  }, []);

  return (
    <main ref={viewerRootRef} className="app-shell">
      {engine ? (
        <EmbedPDF
          engine={engine}
          plugins={plugins}
          onInitialized={async (nextRegistry) => {
            registryCleanupRef.current?.();
            registryCleanupRef.current = null;

            setRegistry(nextRegistry);
            setOutlineCache({ status: 'idle', bookmarks: [] });
            setCurrentPageNumber(1);
            setTotalPages(0);
            setCurrentTitle('');
            setSidePanel(null);
            setCommentTargetId(null);
            setPrintOpen(false);
            setProtectOpen(false);
            setTranslationRequest(null);
            setHasUnsavedChanges(false);
            if (navigationVisibleRef.current) {
              navigationVisibleRef.current = false;
              setNavigationVisible(false);
            }

            const refreshCurrentTitle = () => {
              const pageNumber = currentPageNumberRef.current;
              setCurrentTitle(getCurrentBookmarkTitle(outlineCacheRef.current.bookmarks, pageNumber));
            };

            titleTrackerRefreshRef.current = refreshCurrentTitle;

            const installers: Array<() => () => void> = [
              () => installPageKeyboardNavigation(nextRegistry, revealNavigation),
              () => installPdfZoomKeyboardShortcuts(nextRegistry),
              () => installScrollStrategyAttribute(nextRegistry),
              () => installMiddleMousePanInterceptor(nextRegistry),
              ...(editingEnabled ? [() => installUnsavedChangesTracker(nextRegistry, setHasUnsavedChanges)] : []),
              () => installPlatformReadingHistory(nextRegistry, documentKey),
              () => installCurrentTitleTracker(nextRegistry, () => outlineCacheRef.current.bookmarks, ({ pageNumber, title, totalPages: nextTotalPages }) => {
                currentPageNumberRef.current = pageNumber;
                setCurrentPageNumber(pageNumber);
                setCurrentTitle(title);
                setTotalPages(nextTotalPages);
              }),
              () => installSearchKeyboardShortcut(() => setSearchOpen(true)),
              () => installOutlinePrefetch(nextRegistry, setOutlineCache, fileUrl),
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
                        <GlobalPointerProvider documentId={activeDocumentId}>
                          <Viewport
                            documentId={activeDocumentId}
                            className="viewer"
                            onDragStart={(event) => event.preventDefault()}
                          >
                            <ZoomGesture documentId={activeDocumentId}>
                              <Scroller
                                documentId={activeDocumentId}
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
                                      {editingEnabled ? (
                                        <AnnotationLayer documentId={activeDocumentId} pageIndex={pageIndex} />
                                      ) : null}
                                    </PagePointerProvider>
                                  </Rotate>
                                )}
                              />
                            </ZoomGesture>
                          </Viewport>
                        </GlobalPointerProvider>
                      )}
                    </>
                  )}
                </DocumentContent>
              ) : (
                <div className="viewer-status">No PDF document.</div>
              )}
              <Thumbnails
                registry={registry}
                open={sidePanel === 'thumbnails'}
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
        thumbnailsOpen={sidePanel === 'thumbnails'}
        colorPaletteOpen={sidePanel === 'colors'}
        commentsOpen={sidePanel === 'comments'}
        onSearchOpenChange={setSearchOpen}
        onToggleThumbnails={() => setSidePanel((current) => current === 'thumbnails' ? null : 'thumbnails')}
        onToggleColorPalette={() => setSidePanel((current) => current === 'colors' ? null : 'colors')}
        onToggleComments={() => {
          setCommentTargetId(null);
          setSidePanel((current) => current === 'comments' ? null : 'comments');
        }}
        onOpenPrint={() => {
          setSidePanel(null);
          setPrintOpen(true);
        }}
        onOpenProtect={() => {
          setSidePanel(null);
          setProtectOpen(true);
        }}
      />
      <Outline
        registry={registry}
        open={sidePanel === 'outline'}
        cache={outlineCache}
        currentTitle={currentTitle}
        onCacheChange={setOutlineCache}
        onClose={() => setSidePanel(null)}
      />
      {editingEnabled ? <ColorPalette
        registry={registry}
        open={sidePanel === 'colors'}
        onClose={() => setSidePanel(null)}
      /> : null}
      {editingEnabled ? <Comments
        registry={registry}
        open={sidePanel === 'comments'}
        currentPageNumber={currentPageNumber}
        targetAnnotationId={commentTargetId}
        onClose={() => {
          setSidePanel(null);
          setCommentTargetId(null);
        }}
      /> : null}
      {editingEnabled ? <ContextMenu
        registry={registry}
        container={viewerRootRef.current}
        onOpenComments={(annotationId) => {
          setCommentTargetId(annotationId);
          setSidePanel('comments');
        }}
        onOpenColorPalette={() => setSidePanel('colors')}
        onTranslate={(documentId, anchor) => {
          setTranslationRequest({ id: ++translationRequestIdRef.current, documentId, anchor });
        }}
      /> : null}
      {platform.capabilities.translation && translationRequest ? (
        <SelectionTranslate
          key={translationRequest.id}
          registry={registry}
          request={translationRequest}
          onClose={() => setTranslationRequest(null)}
        />
      ) : null}
      <PrintDialog
        registry={registry}
        open={printOpen}
        currentPageNumber={currentPageNumber}
        totalPages={totalPages}
        onClose={() => setPrintOpen(false)}
      />
      {editingEnabled ? <ProtectDialog
        registry={registry}
        open={protectOpen}
        onClose={() => setProtectOpen(false)}
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
          setSidePanel('outline');
        }}
      />
    </main>
  );
}

function ViewerBootstrap() {
  const [resources, setResources] = useState<{ fileUrl?: string; wasmUrl: string }>();
  const [error, setError] = useState<Error>();

  useEffect(() => installRenderDprCap(), []);

  useEffect(() => {
    let cancelled = false;
    const preparedUrls: string[] = [];
    const releasePreparedUrls = () => {
      preparedUrls.filter((url) => url.startsWith('blob:')).forEach(URL.revokeObjectURL);
    };
    const initialFileUrl = platform.getInitialDocumentUrl();

    Promise.all([
      platform.prepareResourceUrl(PDFIUM_WASM_URL, 'application/wasm'),
      initialFileUrl
        ? platform.prepareResourceUrl(initialFileUrl, 'application/pdf')
        : Promise.resolve(undefined),
    ]).then(([wasmUrl, fileUrl]) => {
      preparedUrls.push(wasmUrl);
      if (fileUrl) preparedUrls.push(fileUrl);
      if (cancelled) {
        releasePreparedUrls();
      } else {
        setResources({ wasmUrl, fileUrl });
      }
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason : new Error(String(reason)));
    });

    return () => {
      cancelled = true;
      releasePreparedUrls();
    };
  }, []);

  if (error) {
    return <div className="viewer-status viewer-status-error">Unable to load PDF resources: {error.message}</div>;
  }

  if (!resources) {
    return <div className="viewer-status">Loading PDF resources...</div>;
  }

  return <App fileUrl={resources.fileUrl} wasmUrl={resources.wasmUrl} />;
}

createRoot(document.getElementById('root')!).render(
  <TooltipProvider>
    <ViewerBootstrap />
  </TooltipProvider>,
);
