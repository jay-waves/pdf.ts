import { Check, ChevronDown } from 'lucide-react';
import { Select as RadixSelect } from 'radix-ui';
import { usePortalContainer } from './portal-container';

interface SelectOption {
  label: string;
  value: string;
}

const TRIGGER_CLASSES = 'group inline-flex h-6.5 items-center justify-between gap-1 rounded-md border border-border-subtle bg-input px-1.5 text-inherit leading-3.5 outline-none transition-[background-color,border-color,box-shadow] duration-150 ease-control hover:border-accent hover:shadow-control focus-visible:border-accent focus-visible:shadow-control disabled:opacity-50 disabled:hover:border-border-subtle disabled:hover:shadow-none';

export function Select({
  value,
  options,
  label,
  className,
  disabled,
  iconOnly = false,
  sideOffset = 5,
  onValueChange,
}: {
  value: string;
  options: SelectOption[];
  label: string;
  className?: string;
  disabled?: boolean;
  iconOnly?: boolean;
  sideOffset?: number;
  onValueChange(value: string): void;
}) {
  const portalContainer = usePortalContainer();
  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <RadixSelect.Trigger
        className={`${TRIGGER_CLASSES} ${className ?? ''}`.trim()}
        aria-label={label}
      >
        {iconOnly ? null : <RadixSelect.Value />}
        <RadixSelect.Icon className="inline-flex text-muted transition-[color,transform] duration-150 group-hover:text-foreground group-data-[state=open]:rotate-180">
          <ChevronDown size={12} strokeWidth={2} />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal container={portalContainer ?? undefined}>
        <RadixSelect.Content
          className="pdf-select-content z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-border bg-toolbar-secondary text-foreground shadow-popover"
          position="popper"
          sideOffset={sideOffset}
          collisionPadding={6}
        >
          <RadixSelect.Viewport className="p-1">
            {options.map((option) => (
              <RadixSelect.Item
                className="relative flex h-6.5 min-w-23 cursor-pointer items-center rounded-md py-0 pr-6 pl-2 outline-none data-[highlighted]:bg-hover data-[state=checked]:text-accent"
                key={option.value}
                value={option.value}
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
