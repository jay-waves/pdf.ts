import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPluginRegistration, type PluginRegistry } from '@embedpdf/core';
import { EmbedPDF } from '@embedpdf/core/react';
import { browserImageDataToBlobConverter, type ImageDataConverter } from '@embedpdf/engines/converters';
import { FontCharset, type FontFallbackConfig } from '@embedpdf/engines/pdfium';
import { Rotation, type PdfEngine, type PdfSignatureObject } from '@embedpdf/models';
import pdfiumWasmUrl from '@embedpdf/pdfium/pdfium.wasm?url';
import notoSansVariableUrl from '#noto-sans-variable.ttf';
import { AnnotationLayer, AnnotationPluginPackage } from '@embedpdf/plugin-annotation/react';
import { BookmarkPluginPackage } from '@embedpdf/plugin-bookmark/react';
import { DocumentContent, DocumentManagerPluginPackage } from '@embedpdf/plugin-document-manager/react';
import type { DocumentManagerCapability } from '@embedpdf/plugin-document-manager';
import { FormPluginPackage } from '@embedpdf/plugin-form/react';
import type { FormCapability } from '@embedpdf/plugin-form';
import { HistoryPluginPackage } from '@embedpdf/plugin-history/react';
import { GlobalPointerProvider, InteractionManagerPluginPackage, PagePointerProvider } from '@embedpdf/plugin-interaction-manager/react';
import { PrintPluginPackage } from '@embedpdf/plugin-print/react';
import { RenderLayer, RenderPluginPackage } from '@embedpdf/plugin-render/react';
import { Rotate, RotatePluginPackage } from '@embedpdf/plugin-rotate/react';
import { Scroller, ScrollPluginPackage, ScrollStrategy } from '@embedpdf/plugin-scroll/react';
import { SearchLayer, SearchPluginPackage } from '@embedpdf/plugin-search/react';
import { SelectionLayer, SelectionPluginPackage } from '@embedpdf/plugin-selection/react';
import { SpreadMode, SpreadPluginPackage } from '@embedpdf/plugin-spread/react';
import { TilingLayer, TilingPluginPackage } from '@embedpdf/plugin-tiling/react';
import { ViewportPluginPackage } from '@embedpdf/plugin-viewport/react';
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
  getCurrentBookmark,
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
import {
  createAnnotationPluginConfig,
  installAnnotationDirtyTracker,
  installAnnotationUriNavigation,
  installNewCommentEditor,
} from './annotations';
import { Comments } from './comments';
import { PrintDialog, ProtectDialog, SignatureDialog } from './document-dialogs';
import { ContextMenu } from './context-menu';
import { Dialog, TooltipProvider } from './components';
import { ViewportInput } from './viewport-input';
import { ViewerViewport } from './viewer-viewport';
import { exportPdf, savePdf } from './pdf-save';
import { useDocflowPdfiumEngine } from './pdf-engine';
import { SelectionTranslate, type SelectionTranslationRequest } from './selection-translate';
import { installReadingHistory as installPlatformReadingHistory } from './reading-history';
import { signatureWidgetRenderer } from './signature-widget';
import {
  verifyPdfSignatures,
  type SignatureVerificationResult,
} from './signature-certificate';
import { platform } from '#platform';
import type { ManagedResource, PdfFileHandle, ViewerResources } from './platform/types';

const RENDER_IMAGE_TYPE = 'image/bmp';
const TILING_TILE_SIZE = 768;
const TILING_OVERLAP_PX = 2;
const TILING_EXTRA_RINGS = 0;
const MAX_RENDER_DPR = 1.75;
const NAVIGATION_AUTO_HIDE_DELAY_MS = 1200;
const BUNDLED_PDFIUM_WASM_URL = new URL(pdfiumWasmUrl, import.meta.url).href;
// The engine tracks fontFallback by reference. Keep it module-stable so
// ordinary React re-renders cannot tear down and recreate the WASM engine.
const PDFIUM_FONT_FALLBACK: FontFallbackConfig = {
  fonts: {
    [FontCharset.ANSI]: notoSansVariableUrl,
    [FontCharset.DEFAULT]: notoSansVariableUrl,
    [FontCharset.CYRILLIC]: notoSansVariableUrl,
    [FontCharset.GREEK]: notoSansVariableUrl,
    [FontCharset.VIETNAMESE]: notoSansVariableUrl,
    [FontCharset.EASTERNEUROPEAN]: notoSansVariableUrl,
  },
};
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

function installFormDirtyTracker(registry: PluginRegistry, onDirty: () => void) {
  const form = getPluginCapability<FormCapability>(registry, 'form');
  return form?.onFieldValueChange(onDirty) ?? EMPTY_CLEANUP;
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

interface AppProps {
  engine: PdfEngine<Blob>;
  fileUrl?: string;
  documentKey?: string;
  documentName?: string;
  fileHandle?: PdfFileHandle;
  wasmResource: ManagedResource;
  documentResource?: ManagedResource;
  onResourceConsumed(resource?: ManagedResource): void;
}

type CommentTarget = { annotationId: string; isNew: boolean };
type SidePanel =
  | { type: 'outline' | 'thumbnails' | 'colors' }
  | { type: 'comments'; target: CommentTarget | null }
  | null;
type ActiveDialog = 'print' | 'protect' | 'signatures' | null;
type DocumentViewState = { pageNumber: number; totalPages: number; bookmarkKey: string; title: string };

type DocumentPane = Exclude<NonNullable<SidePanel>['type'], 'colors'>;
const DOCUMENT_PANE_TITLES: Record<DocumentPane, string> = {
  thumbnails: 'PDF Thumbnails',
  outline: 'PDF Outline',
  comments: 'PDF Comments',
};

const INITIAL_DOCUMENT_VIEW: DocumentViewState = { pageNumber: 1, totalPages: 0, bookmarkKey: '', title: '' };

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
    createPluginRegistration(SelectionPluginPackage, { maxCachedGeometries: 8 }),
    createPluginRegistration(
      AnnotationPluginPackage,
      createAnnotationPluginConfig(),
    ),
    createPluginRegistration(HistoryPluginPackage),
    createPluginRegistration(FormPluginPackage),
    createPluginRegistration(SearchPluginPackage),
    createPluginRegistration(BookmarkPluginPackage),
    createPluginRegistration(PrintPluginPackage),
  ];
}

function App({
  engine,
  fileUrl,
  documentKey,
  documentName,
  fileHandle,
  wasmResource,
  documentResource,
  onResourceConsumed,
}: AppProps) {
  const saveInProgressRef = useRef<Promise<boolean> | null>(null);
  const [registry, setRegistry] = useState<PluginRegistry>();
  const [toolbarDocumentId, setToolbarDocumentId] = useState<string | null>(null);
  const [toolbarInset, setToolbarInset] = useState(0);
  const [panMode, setPanMode] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sidePanel, setSidePanel] = useState<SidePanel>(null);
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null);
  const [translationRequest, setTranslationRequest] = useState<SelectionTranslationRequest | null>(null);
  const [outlineCache, setOutlineCache] = useState<OutlineCache>({
    status: 'idle',
    bookmarks: [],
  });
  const [documentView, setDocumentView] = useState(INITIAL_DOCUMENT_VIEW);
  const [signatures, setSignatures] = useState<PdfSignatureObject[]>([]);
  const [signatureVerifications, setSignatureVerifications] = useState<SignatureVerificationResult[]>([]);
  const [navigationVisible, setNavigationVisible] = useState(false);
  const { pageNumber: currentPageNumber, totalPages, bookmarkKey: currentBookmarkKey, title: currentTitle } = documentView;
  const commentTarget = sidePanel?.type === 'comments' ? sidePanel.target : null;
  const documentPane: DocumentPane | null = sidePanel && sidePanel.type !== 'colors' ? sidePanel.type : null;
  const viewerRootRef = useRef<HTMLElement>(null);
  const registryCleanupRef = useRef<(() => void) | null>(null);
  const outlineCacheRef = useRef(outlineCache);
  const currentPageNumberRef = useRef(1);
  const titleTrackerRefreshRef = useRef<(() => void) | null>(null);
  const changeTrackerRef = useRef({ dirty: false, version: 0, forceFullSave: false });
  const cleanDocumentTitleRef = useRef(document.title);
  const navigationHideTimerRef = useRef<number>(0);
  const navigationVisibleRef = useRef(false);

  const renderDocumentTitle = () => {
    document.title = `${changeTrackerRef.current.dirty ? '*' : ''}${cleanDocumentTitleRef.current}`;
  };

  const setHasUnsavedChanges = (dirty: boolean, forceFullSave = false) => {
    if (dirty) changeTrackerRef.current.version++;
    changeTrackerRef.current.dirty = dirty;
    if (forceFullSave) changeTrackerRef.current.forceFullSave = true;
    if (!dirty) changeTrackerRef.current.forceFullSave = false;
    if (dirty) {
      window.addEventListener('beforeunload', handleBeforeUnload);
    } else {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    }
    platform.setDocumentDirty?.(dirty);
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

  const saveDocument = useCallback((
    options: { fromHost?: boolean; preserveDirty?: boolean } = {},
  ): Promise<boolean> => {
    if (!changeTrackerRef.current.dirty) return Promise.resolve(true);
    if (platform.requestDocumentSave && !options.fromHost) {
      platform.requestDocumentSave();
      return Promise.resolve(false);
    }
    if (saveInProgressRef.current) return saveInProgressRef.current;

    const changeVersionAtSaveStart = changeTrackerRef.current.version;
    const save = savePdf(engine, registry, fileHandle, {
      forceFullSave: changeTrackerRef.current.forceFullSave,
    })
      .then((saved) => {
        if (
          saved &&
          !options.preserveDirty &&
          changeTrackerRef.current.version === changeVersionAtSaveStart
        ) {
          // A new edit may have landed while PDF serialization or disk I/O
          // was in progress. Keep the dirty marker in that case.
          setHasUnsavedChanges(false);
        }
        return saved;
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.error('[pdf-ts] failed to save PDF', error);
        }
        return false;
      })
      .finally(() => {
        saveInProgressRef.current = null;
      });
    saveInProgressRef.current = save;
    return save;
  }, [engine, fileHandle, registry]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveDocument();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saveDocument]);

  useEffect(() => platform.onDocumentSaveRequested?.(
    (preserveDirty) => saveDocument({ fromHost: true, preserveDirty }),
  ), [saveDocument]);

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
    setSignatures([]);
    setSignatureVerifications([]);
    if (!registry || !toolbarDocumentId) return;
    let active = true;
    let verificationController: AbortController | undefined;
    const documentManager = getPluginCapability<DocumentManagerCapability>(registry, 'document-manager');
    const readSignatures = () => {
      const document = documentManager?.getDocument(toolbarDocumentId);
      if (!document) return;
      engine.getSignatures(document).wait(
        (nextSignatures) => {
          if (!active) return;
          verificationController?.abort();
          setSignatures(nextSignatures);
          setSignatureVerifications(nextSignatures.map(() => ({
            state: 'pending',
            detail: 'Verification in progress.',
          })));
          if (!nextSignatures.length) return;
          if (!documentResource) {
            setSignatureVerifications(nextSignatures.map(() => ({
              state: 'unsupported',
              detail: 'The original PDF byte stream is unavailable.',
            })));
            return;
          }
          const controller = new AbortController();
          verificationController = controller;
          void verifyPdfSignatures(
            documentResource,
            nextSignatures,
            controller.signal,
          ).then((results) => {
            if (active && !controller.signal.aborted) {
              setSignatureVerifications(results);
            }
          }).catch((error) => {
            if (!controller.signal.aborted) {
              console.error('[pdf-ts] failed to verify digital signatures', error);
            }
          });
        },
        (error) => console.error('[pdf-ts] failed to read digital signatures', error),
      );
    };

    readSignatures();
    const unsubscribe = documentManager?.onDocumentOpened(() => readSignatures());
    return () => {
      active = false;
      verificationController?.abort();
      unsubscribe?.();
    };
  }, [documentResource, engine, registry, toolbarDocumentId]);

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
            setPanMode(false);
            setHasUnsavedChanges(false);
            if (navigationVisibleRef.current) {
              navigationVisibleRef.current = false;
              setNavigationVisible(false);
            }

            const refreshCurrentTitle = () => {
              const pageNumber = currentPageNumberRef.current;
              const currentBookmark = getCurrentBookmark(outlineCacheRef.current.bookmarks, pageNumber);
              const bookmarkKey = currentBookmark?.key ?? '';
              const title = currentBookmark?.title ?? '';
              setDocumentView((current) => current.bookmarkKey === bookmarkKey && current.title === title
                ? current
                : { ...current, bookmarkKey, title });
            };

            titleTrackerRefreshRef.current = refreshCurrentTitle;

            const installers = [
              () => installPageKeyboardNavigation(nextRegistry, revealNavigation),
              () => installPdfZoomKeyboardShortcuts(nextRegistry),
              () => installScrollStrategyAttribute(nextRegistry),
              () => installAnnotationUriNavigation(nextRegistry, platform.openExternal),
              () => installNewCommentEditor(nextRegistry, (annotationId) => {
                setSidePanel({ type: 'comments', target: { annotationId, isNew: true } });
              }),
              () => installAnnotationDirtyTracker(
                nextRegistry,
                () => setHasUnsavedChanges(true),
              ),
              () => installFormDirtyTracker(
                nextRegistry,
                () => setHasUnsavedChanges(true),
              ),
              () => installPlatformReadingHistory(nextRegistry, documentKey),
              () => installCurrentTitleTracker(nextRegistry, () => outlineCacheRef.current.bookmarks, ({ pageNumber, bookmarkKey, title, totalPages: nextTotalPages }) => {
                currentPageNumberRef.current = pageNumber;
                setDocumentView({ pageNumber, bookmarkKey, title, totalPages: nextTotalPages });
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
                            <ViewerViewport
                              documentId={activeDocumentId}
                              className={`viewer${panMode ? ' is-pan-mode' : ''}`}
                              onDragStart={(event) => event.preventDefault()}
                            >
                              <ViewportInput documentId={activeDocumentId} panMode={panMode}>
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
                                        <AnnotationLayer
                                          documentId={activeDocumentId}
                                          pageIndex={pageIndex}
                                          annotationRenderers={[signatureWidgetRenderer]}
                                        />
                                      </PagePointerProvider>
                                    </Rotate>
                                  )}
                                />
                              </ViewportInput>
                            </ViewerViewport>
                          </GlobalPointerProvider>
                        </>
                      )}
                    </>
                  )}
                </DocumentContent>
              ) : (
                <div className="viewer-status">No PDF document.</div>
              )}
            </>
          )}
        </EmbedPDF>
      <Toolbar
        registry={registry}
        activeDocumentId={toolbarDocumentId}
        searchOpen={searchOpen}
        thumbnailsOpen={sidePanel?.type === 'thumbnails'}
        colorPaletteOpen={sidePanel?.type === 'colors'}
        panMode={panMode}
        onPanModeChange={setPanMode}
        onSearchOpenChange={setSearchOpen}
        onToggleThumbnails={() => setSidePanel((current) => (
          current?.type === 'thumbnails' ? null : { type: 'thumbnails' }
        ))}
        onToggleColorPalette={() => setSidePanel((current) => (
          current?.type === 'colors' ? null : { type: 'colors' }
        ))}
        onOpenPrint={() => {
          setSidePanel(null);
          setActiveDialog('print');
        }}
        onOpenProtect={() => {
          setSidePanel(null);
          setActiveDialog('protect');
        }}
        signatureCount={signatures.length}
        onOpenSignatures={() => setActiveDialog('signatures')}
        onExport={() => {
          const fileName = documentName
            ?? fileHandle?.name
            ?? (fileUrl ? getFileNameFromUrl(fileUrl) : undefined)
            ?? 'document.pdf';
          void exportPdf(engine, registry, fileName).catch((error) => {
            console.error('[pdf-ts] failed to export PDF', error);
          });
        }}
        onSave={() => void saveDocument()}
        onPinnedInsetChange={setToolbarInset}
      />
      <Dialog
        open={documentPane !== null}
        onClose={() => setSidePanel(null)}
        title={documentPane ? DOCUMENT_PANE_TITLES[documentPane] : 'PDF Document'}
        contentClassName="shnctl-panel"
      >
        <Thumbnails
          registry={registry}
          open={documentPane === 'thumbnails'}
          totalPages={totalPages}
          currentPageNumber={currentPageNumber}
          onClose={() => setSidePanel(null)}
        />
        <Outline
          registry={registry}
          open={documentPane === 'outline'}
          cache={outlineCache}
          currentBookmarkKey={currentBookmarkKey}
          onCacheChange={setOutlineCache}
        />
        <Comments
          engine={engine}
          registry={registry}
          open={documentPane === 'comments'}
          currentPageNumber={currentPageNumber}
          targetAnnotationId={commentTarget?.annotationId}
          targetAnnotationIsNew={commentTarget?.isNew}
        />
      </Dialog>
      <ColorPalette
        registry={registry}
        open={sidePanel?.type === 'colors'}
        onClose={() => setSidePanel(null)}
      />
      <ContextMenu
        engine={engine}
        registry={registry}
        container={viewerRootRef.current}
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
      {translationRequest ? (
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
      <ProtectDialog
        registry={registry}
        open={activeDialog === 'protect'}
        onClose={() => setActiveDialog(null)}
        onProtected={() => setHasUnsavedChanges(true, true)}
      />
      <SignatureDialog
        signatures={signatures}
        verifications={signatureVerifications}
        open={activeDialog === 'signatures'}
        onClose={() => setActiveDialog(null)}
      />
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
        onOpenThumbnails={() => {
          setSearchOpen(false);
          setSidePanel({ type: 'thumbnails' });
        }}
      />
    </main>
  );
}

function WebDocumentPicker({
  onSelect,
  onPick,
}: {
  onSelect(file: File): void;
  onPick?(): Promise<void>;
}) {
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
        {onPick ? (
          <button className="web-file-button" type="button" onClick={() => {
            void onPick().catch((error: unknown) => {
              if (!(error instanceof DOMException && error.name === 'AbortError')) {
                setSelectionError(error instanceof Error ? error.message : 'Unable to open PDF.');
              }
            });
          }}>
            Choose a PDF file
          </button>
        ) : (
          <label className="web-file-button">
            Choose a PDF file
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(event) => selectFile(event.target.files?.[0])}
            />
          </label>
        )}
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

  return (
    <ReadyViewer
      resources={resources}
      setResources={setResources}
      trackResource={trackResource}
      releaseResource={releaseResource}
    />
  );
}

function ReadyViewer({
  resources,
  setResources,
  trackResource,
  releaseResource,
}: {
  resources: ViewerResources;
  setResources(resources: ViewerResources): void;
  trackResource(resource?: ManagedResource): void;
  releaseResource(resource?: ManagedResource): void;
}) {
  const { engine: workerEngine, isLoading, error } = useDocflowPdfiumEngine({
    wasmUrl: resources.wasm.url,
    fontFallback: PDFIUM_FONT_FALLBACK,
  });
  const engine = configureBundledBmpEngine(workerEngine);

  if (platform.openLocalDocument && !resources.document) {
    const openLocalDocument = platform.openLocalDocument;
    const useDocument = (document: NonNullable<ViewerResources['document']>) => {
      trackResource(document.resource);
      setResources({ ...resources, document });
    };
    return <WebDocumentPicker
      onSelect={(file) => useDocument(openLocalDocument(file))}
      onPick={platform.pickLocalDocument ? async () => {
        const document = await platform.pickLocalDocument!();
        if (document) useDocument(document);
      } : undefined}
    />;
  }

  if (!engine) {
    return (
      <div className={`viewer-status${error ? ' viewer-status-error' : ''}`}>
        {error ? `Unable to initialize PDF engine: ${error.message}` : isLoading ? 'Loading PDF engine...' : 'PDF engine unavailable.'}
      </div>
    );
  }

  return (
    <App
      key={resources.document?.resource.url}
      engine={engine}
      fileUrl={resources.document?.resource.url}
      documentKey={resources.document?.key}
      documentName={resources.document?.name}
      fileHandle={resources.document?.fileHandle}
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
