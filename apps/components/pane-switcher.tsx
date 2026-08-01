import { BookImage, ListTree, MessageSquareMore } from 'lucide-react';

const PANES = [
  { id: 'thumbnails', label: 'Thumbnails', icon: BookImage },
  { id: 'outline', label: 'Contents', icon: ListTree },
  { id: 'comments', label: 'Comments', icon: MessageSquareMore },
] as const;

export type DocumentPane = typeof PANES[number]['id'];

export function PaneSwitcher({ active, onSelect }: {
  active: DocumentPane;
  onSelect(pane: DocumentPane): void;
}) {
  return (
    <div className="shnctl-pane-switcher" role="group" aria-label="Document pane">
      {PANES.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          className="shnctl-pane-switcher-button"
          aria-pressed={active === id}
          title={label}
          onClick={() => onSelect(id)}
        >
          <Icon size={15} strokeWidth={2} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
