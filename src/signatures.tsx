import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { PluginRegistry } from '@embedpdf/core';
import { Plus, Signature as SignatureIcon, Trash2 } from 'lucide-react';
import { getActiveDocumentId } from './utils';

interface SignatureFieldDefinition {
  label?: string;
  previewDataUrl: string;
}

interface SignatureEntry {
  id: string;
  createdAt: number;
  signature: SignatureFieldDefinition;
  initials?: SignatureFieldDefinition;
}

interface SignatureScope {
  activateSignaturePlacement(entryId: string): void;
  activateInitialsPlacement(entryId: string): void;
  deactivatePlacement(): void;
}

interface SignatureCapability {
  getEntries(): SignatureEntry[];
  removeEntry(id: string): void;
  onEntriesChange(listener: (entries: SignatureEntry[]) => void): () => void;
  forDocument(documentId: string): SignatureScope;
}

interface UICapability {
  forDocument(documentId: string): {
    openModal(modalId: string, props?: Record<string, unknown>): void;
  };
}

function getSignatureCapability(registry?: PluginRegistry) {
  return registry?.getPlugin('signature')?.provides?.() as SignatureCapability | undefined;
}

export function ShnctlSignatures({
  registry,
  open,
  onClose,
}: {
  registry?: PluginRegistry;
  open: boolean;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<SignatureEntry[]>([]);
  const signature = useMemo(() => getSignatureCapability(registry), [registry]);

  useEffect(() => {
    if (!open || !signature) {
      return;
    }

    setEntries(signature.getEntries());
    return signature.onEntriesChange(setEntries);
  }, [open, signature]);

  const openCreateModal = () => {
    const documentId = registry ? getActiveDocumentId(registry) : undefined;
    const ui = registry?.getPlugin('ui')?.provides?.() as UICapability | undefined;
    if (!documentId || !ui) {
      return;
    }

    onClose();
    requestAnimationFrame(() => {
      ui.forDocument(documentId).openModal('signature-create-modal');
    });
  };

  const placeSignature = (entryId: string, kind: 'signature' | 'initials') => {
    const documentId = registry ? getActiveDocumentId(registry) : undefined;
    if (!documentId || !signature) {
      return;
    }

    const scope = signature.forDocument(documentId);
    if (kind === 'initials') {
      scope.activateInitialsPlacement(entryId);
    } else {
      scope.activateSignaturePlacement(entryId);
    }
    onClose();
  };

  const removeSignature = (entryId: string) => {
    signature?.removeEntry(entryId);
  };

  const body = (() => {
    if (!signature) {
      return <div className="shnctl-state">Signatures are not ready.</div>;
    }

    if (entries.length === 0) {
      return <div className="shnctl-state">No signatures yet.</div>;
    }

    return (
      <ol className="shnctl-list shnctl-signature-list">
        {entries.map((entry) => (
          <li key={entry.id} className="shnctl-item">
            <div className="shnctl-signature-entry-stack">
              <button type="button" className="shnctl-bookmark shnctl-signature-entry" onClick={() => placeSignature(entry.id, 'signature')}>
                <span className="shnctl-signature-preview">
                  <img src={entry.signature.previewDataUrl} alt="" />
                </span>
                <span className="shnctl-bookmark-title">{entry.signature.label || 'Signature'}</span>
                <span className="shnctl-bookmark-page">Place</span>
              </button>
              {entry.initials ? (
                <button type="button" className="shnctl-bookmark shnctl-signature-entry" onClick={() => placeSignature(entry.id, 'initials')}>
                  <span className="shnctl-signature-preview">
                    <img src={entry.initials.previewDataUrl} alt="" />
                  </span>
                  <span className="shnctl-bookmark-title">{entry.initials.label || 'Initials'}</span>
                  <span className="shnctl-bookmark-page">Place</span>
                </button>
              ) : null}
            </div>
            <button type="button" className="shnctl-signature-delete" onClick={() => removeSignature(entry.id)} aria-label="Delete signature">
              <Trash2 size={14} strokeWidth={2} />
            </button>
          </li>
        ))}
      </ol>
    );
  })();

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="shnctl-overlay" />
        <Dialog.Content className="shnctl-panel shnctl-signature-panel" aria-describedby={undefined}>
          <Dialog.Title className="shnctl-visually-hidden">PDF Signatures</Dialog.Title>
          <div className="shnctl-content">
            <div className="shnctl-signature-actions">
              <button type="button" className="shnctl-bookmark shnctl-signature-create" onClick={openCreateModal}>
                <SignatureIcon size={14} strokeWidth={2} />
                <span className="shnctl-bookmark-title">Create signature</span>
                <Plus size={14} strokeWidth={2} />
              </button>
            </div>
            {body}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
