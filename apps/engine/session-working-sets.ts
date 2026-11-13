import type { WorkingSetPage } from '@embedpdf/engine-core/runtime';

/** Retain the latest view hints while hidden, but withdraw their cache protection. */
export class SessionWorkingSets {
  private readonly documents = new Map<string, Map<string, readonly WorkingSetPage[]>>();
  private visible = true;
  private readonly publish: (document: string, view: string, pages: readonly WorkingSetPage[]) => void;

  constructor(publish: (document: string, view: string, pages: readonly WorkingSetPage[]) => void) {
    this.publish = publish;
  }

  get(document: string) { return this.visible ? this.documents.get(document) : undefined; }

  // All allowlisted foreground reads precede hidden reads within the same epoch.
  priority(rank: number) { return rank - (this.visible ? 0 : 1000); }

  set(document: string, view: string, pages: readonly WorkingSetPage[]) {
    let views = this.documents.get(document);
    if (pages.length) {
      if (!views) this.documents.set(document, views = new Map());
      views.set(view, pages);
    } else {
      views?.delete(view);
      if (!views?.size) this.documents.delete(document);
    }
    this.publish(document, view, this.visible ? pages : []);
  }

  setVisible(visible: boolean) {
    if (visible === this.visible) return;
    this.visible = visible;
    for (const [document, views] of this.documents) {
      for (const [view, pages] of views) this.publish(document, view, visible ? pages : []);
    }
  }

  delete(document: string) {
    for (const view of this.documents.get(document)?.keys() ?? []) this.publish(document, view, []);
    this.documents.delete(document);
  }
}
