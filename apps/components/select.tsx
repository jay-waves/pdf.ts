import { Check, ChevronDown } from 'lucide-react';
import { Select as RadixSelect, Toolbar } from 'radix-ui';
import { usePortalContainer } from './portal-container';
import { useViewerFocus } from './viewer-focus';
import { useInToolbar } from './floating-toolbar';

interface SelectOption {
  label: string;
  value: string;
  onSelect?: () => void;
}

const TRIGGER_CLASSES = 'group inline-flex h-6.5 items-center justify-between gap-1 rounded-lg border border-border-subtle bg-[var(--pdf-control-background)] px-2 text-inherit leading-3.5 outline-none transition-[background-color,border-color,box-shadow] duration-150 ease-control hover:bg-hover focus-visible:border-accent focus-visible:shadow-control disabled:opacity-50 disabled:hover:bg-input disabled:hover:border-border-subtle disabled:hover:shadow-none';

export function Select({
  value,
  options,
  label,
  className,
  contentClassName,
  disabled,
  iconOnly = false,
  sideOffset = 5,
  onValueChange,
  onCloseAutoFocus,
}: {
  value: string;
  options: SelectOption[];
  label: string;
  className?: string;
  contentClassName?: string;
  disabled?: boolean;
  iconOnly?: boolean;
  sideOffset?: number;
  onValueChange(value: string): void;
  onCloseAutoFocus?(event: Event): void;
}) {
  const portalContainer = usePortalContainer();
  const focusViewer = useViewerFocus();
  const inToolbar = useInToolbar();
  const trigger = (
    <RadixSelect.Trigger
      className={`${TRIGGER_CLASSES} ${className ?? ''}`.trim()}
      aria-label={label}
    >
      {iconOnly ? null : <RadixSelect.Value />}
      <RadixSelect.Icon className="inline-flex text-muted transition-[color,transform] duration-150 group-hover:text-foreground group-data-[state=open]:rotate-180">
        <ChevronDown size={12} strokeWidth={2} />
      </RadixSelect.Icon>
    </RadixSelect.Trigger>
  );
  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      {inToolbar ? <Toolbar.Button asChild disabled={disabled}>{trigger}</Toolbar.Button> : trigger}
      <RadixSelect.Portal container={portalContainer ?? undefined}>
        <RadixSelect.Content
          className={`pdf-select-content pdf-glass-surface pdf-glass-popover z-50 min-w-[var(--radix-select-trigger-width)] max-h-[var(--radix-select-content-available-height)] overflow-hidden rounded-lg border text-foreground ${contentClassName ?? ''}`.trim()}
          position="popper"
          sideOffset={sideOffset}
          collisionPadding={6}
          onCloseAutoFocus={(event) => {
            if (onCloseAutoFocus) onCloseAutoFocus(event);
            else if (focusViewer) {
              event.preventDefault();
              focusViewer();
            }
          }}
        >
          <RadixSelect.Viewport className="p-1.5">
            {options.map((option) => (
              <RadixSelect.Item
                className="relative flex h-6.5 min-w-23 cursor-pointer items-center rounded-md py-0 pr-6 pl-2 outline-none data-[highlighted]:bg-hover data-[state=checked]:text-accent"
                key={option.value}
                value={option.value}
                onPointerUp={option.onSelect}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') option.onSelect?.();
                }}
              >
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                <RadixSelect.ItemIndicator className="absolute right-1.75 inline-flex">
                  <Check size={12} strokeWidth={2} />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
