import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import { PdfAnnotationSubtype, PdfAnnotationSubtypeName, type PdfAnnotationObject } from '@embedpdf/models';
import type { AnnotationCapability } from '@embedpdf/plugin-annotation';
import { Highlighter, MessageSquareMore, PenLine, Shapes, Strikethrough, Type, Underline, X } from 'lucide-react';
import { Dialog, DialogClose } from './components';
import { getActiveDocumentId, type ScrollCapability } from './utils';

type CommentEntry = { annotation: PdfAnnotationObject; pageIndex: number };
type CommentPageGroup = { pageIndex: number; entries: CommentEntry[] };

const HIDDEN_ANNOTATION_TYPES = new Set([
  PdfAnnotationSubtype.LINK,
  PdfAnnotationSubtype.POPUP,
  PdfAnnotationSubtype.WIDGET,
]);

function getAnnotationCapability(registry: PluginRegistry | undefined) {
  const documentId = registry ? getActiveDocumentId(registry) : undefined;
  const annotation = registry?.getPlugin('annotation')?.provides?.() as AnnotationCapability | undefined;
  return documentId && annotation ? { documentId, annotation } : null;
}

function getEntries(registry: PluginRegistry | undefined): CommentEntry[] {
  const capability = getAnnotationCapability(registry);
  if (!capability) return [];

  return capability.annotation.forDocument(capability.documentId).getAnnotations()
    .map(({ object }) => ({ annotation: object, pageIndex: object.pageIndex }))
    .filter(({ annotation }) => !HIDDEN_ANNOTATION_TYPES.has(annotation.type))
    .sort((left, right) => left.pageIndex - right.pageIndex ||
      left.annotation.rect.origin.y - right.annotation.rect.origin.y ||
      left.annotation.rect.origin.x - right.annotation.rect.origin.x ||
      left.annotation.id.localeCompare(right.annotation.id));
}

function getEntryLabel(annotation: PdfAnnotationObject) {
  switch (annotation.type) {
    case PdfAnnotationSubtype.TEXT: return 'Comment';
    case PdfAnnotationSubtype.HIGHLIGHT: return 'Highlight';
    case PdfAnnotationSubtype.UNDERLINE: return 'Underline';
    case PdfAnnotationSubtype.STRIKEOUT: return 'Strikeout';
    case PdfAnnotationSubtype.SQUIGGLY: return 'Squiggly';
    case PdfAnnotationSubtype.FREETEXT: return 'Text';
    case PdfAnnotationSubtype.STAMP: return 'Stamp';
    case PdfAnnotationSubtype.INK: return 'Drawing';
    default: return PdfAnnotationSubtypeName[annotation.type] || 'Annotation';
  }
}

function getEntryIcon(annotation: PdfAnnotationObject) {
  switch (annotation.type) {
    case PdfAnnotationSubtype.TEXT: return MessageSquareMore;
    case PdfAnnotationSubtype.HIGHLIGHT: return Highlighter;
    case PdfAnnotationSubtype.UNDERLINE: return Underline;
    case PdfAnnotationSubtype.STRIKEOUT: return Strikethrough;
    case PdfAnnotationSubtype.FREETEXT: return Type;
    case PdfAnnotationSubtype.STAMP: return Shapes;
    case PdfAnnotationSubtype.INK: return PenLine;
    default: return Shapes;
  }
}

function navigateToAnnotation(registry: PluginRegistry, entry: CommentEntry) {
  const capability = getAnnotationCapability(registry);
  const scroll = registry.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;
  if (!capability || !scroll) return;

  capability.annotation.forDocument(capability.documentId).selectAnnotation(entry.pageIndex, entry.annotation.id);
  scroll.forDocument(capability.documentId).scrollToPage({
    pageNumber: entry.pageIndex + 1,
    pageCoordinates: { x: entry.annotation.rect.origin.x, y: entry.annotation.rect.origin.y },
    behavior: 'instant',
  });
}

export function Comments({ registry, open, currentPageNumber, targetAnnotationId, onClose }: {
  registry?: PluginRegistry;
  open: boolean;
  currentPageNumber: number;
  targetAnnotationId?: string | null;
  onClose(): void;
}) {
  const [revision, setRevision] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);
  const entries = useMemo(() => open ? getEntries(registry) : [], [open, registry, revision]);
  const pageGroups = useMemo(() => entries.reduce<CommentPageGroup[]>((groups, entry) => {
    const lastGroup = groups.at(-1);
    if (lastGroup?.pageIndex === entry.pageIndex) {
      lastGroup.entries.push(entry);
    } else {
      groups.push({ pageIndex: entry.pageIndex, entries: [entry] });
    }
    return groups;
  }, []), [entries]);

  useEffect(() => {
    if (!open) return;
    const capability = getAnnotationCapability(registry);
    if (!capability) return;
    return capability.annotation.onAnnotationEvent((event) => {
      if (event.documentId === capability.documentId) setRevision((value) => value + 1);
    });
  }, [open, registry]);

  useEffect(() => {
    if (!open || !targetAnnotationId) return;
    const target = entries.find(({ annotation }) => annotation.id === targetAnnotationId);
    if (!target) return;
    setEditingId(target.annotation.id);
    setDraft(target.annotation.contents?.trim() ?? '');
  }, [entries, open, targetAnnotationId]);

  useLayoutEffect(() => {
    if (!open) {
      setEditingId(null);
      return;
    }
    const scrollToCurrentPage = () => {
      const root = contentRef.current;
      if (!root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>('[data-comment-page]'));
      const current = items.find((item) => Number(item.dataset.commentPage) >= currentPageNumber) ?? items.at(-1);
      if (!current) {
        root.scrollTo({ top: 0, behavior: 'auto' });
        return;
      }
      const rootRect = root.getBoundingClientRect();
      const currentRect = current.getBoundingClientRect();
      root.scrollTo({ top: Math.max(0, root.scrollTop + currentRect.top - rootRect.top - 12), behavior: 'smooth' });
    };
    scrollToCurrentPage();
  }, [currentPageNumber, entries.length, open]);

  const saveComment = (entry: CommentEntry) => {
    const capability = getAnnotationCapability(registry);
    if (!capability) return;
    capability.annotation.forDocument(capability.documentId)
      .updateAnnotation(entry.pageIndex, entry.annotation.id, { contents: draft.trim() });
    setEditingId(null);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="PDF Comments"
      contentClassName="shnctl-panel shnctl-comment-panel"
    >
          <div className="shnctl-comment-header">
            <div className="shnctl-comment-title">
              <span className="shnctl-comment-title-icon"><MessageSquareMore size={16} strokeWidth={1.8} /></span>
              <span>
                <span className="shnctl-comment-heading">Comments</span>
                <span className="shnctl-comment-summary">
                  {entries.length ? `${entries.length} annotation${entries.length === 1 ? '' : 's'} · ${pageGroups.length} page${pageGroups.length === 1 ? '' : 's'}` : 'Annotations and notes'}
                </span>
              </span>
            </div>
            <DialogClose asChild>
              <button type="button" className="shnctl-action shnctl-comment-close" aria-label="Close comments">
                <X size={14} strokeWidth={2} />
              </button>
            </DialogClose>
          </div>
          <div className="shnctl-content shnctl-comment-content" ref={contentRef}>
            {!registry ? <div className="shnctl-state">Loading comments...</div> : null}
            {registry && !entries.length ? <div className="shnctl-comment-empty">
              <span className="shnctl-comment-empty-icon"><MessageSquareMore size={20} strokeWidth={1.6} /></span>
              <strong>No comments yet</strong>
              <span>Annotations and notes added to this PDF will appear here.</span>
            </div> : null}
            {pageGroups.length ? <ol className="shnctl-comment-list">
              {pageGroups.map((group) => <li key={group.pageIndex} className="shnctl-comment-page-group" data-comment-page={group.pageIndex + 1} data-current={group.pageIndex + 1 === currentPageNumber ? 'true' : undefined}>
                <div className="shnctl-comment-page-header">
                  <span>Page {group.pageIndex + 1}</span>
                  <span className="shnctl-comment-page-count">{group.entries.length}</span>
                </div>
                <ol className="shnctl-comment-page-entries">
                  {group.entries.map((entry) => {
                    const { annotation } = entry;
                    const Icon = getEntryIcon(annotation);
                    const label = getEntryLabel(annotation);
                    const contents = annotation.contents?.trim();
                    const isEditing = editingId === annotation.id;
                    return <li key={annotation.id} className="shnctl-comment-item" data-editing={isEditing ? 'true' : undefined}>
                      <button type="button" className="shnctl-action shnctl-comment-target" onClick={() => registry && navigateToAnnotation(registry, entry)}>
                        <span className="shnctl-comment-icon"><Icon size={15} strokeWidth={2} /></span>
                        <span className="shnctl-comment-meta"><span className="shnctl-comment-type">{label}</span></span>
                      </button>
                      {isEditing ? <form className="shnctl-comment-editor" onSubmit={(event) => { event.preventDefault(); saveComment(entry); }}>
                        <textarea value={draft} onChange={(event) => setDraft(event.currentTarget.value)} autoFocus aria-label={`Comment for ${label}`} />
                        <div className="shnctl-comment-editor-actions"><button type="button" onClick={() => setEditingId(null)}>Cancel</button><button type="submit" className="shnctl-comment-save">Save</button></div>
                      </form> : <button type="button" className="shnctl-comment-body" onClick={() => { setEditingId(annotation.id); setDraft(contents ?? ''); }}>{contents || 'Add a note'}</button>}
                    </li>;
                  })}
                </ol>
              </li>)}
            </ol> : null}
          </div>
    </Dialog>
  );
}
