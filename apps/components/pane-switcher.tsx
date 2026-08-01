import { BookImage, ListTree, MessageSquareMore } from 'lucide-react';

export type DocumentPane = 'thumbnails' | 'outline' | 'comments';

const PANES = [
  { id: 'thumbnails', label: 'Thumbnails', icon: BookImage },
  { id: 'outline', label: 'Contents', icon: ListTree },
  { id: 'comments', label: 'Comments', icon: MessageSquareMore },
] as const;

export function PaneSwitcher({ active, onSelect }: {
  active: DocumentPane;
  onSelect(pane: DocumentPane): void;
}) {
  return (
    <div className="shnctl-pane-switcher" role="radiogroup" aria-label="Document pane">
      {PANES.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          className="shnctl-pane-switcher-button"
          role="radio"
          aria-checked={active === id}
          aria-label={label}
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
