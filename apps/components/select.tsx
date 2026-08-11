import { Check, ChevronDown } from 'lucide-react';
import { Select as RadixSelect } from 'radix-ui';
import { usePortalContainer } from './portal-container';

interface SelectOption {
  label: string;
  value: string;
}

const TRIGGER_CLASSES = 'inline-flex h-6.5 items-center justify-between gap-1 rounded-md border border-border-subtle bg-input px-1.5 text-inherit leading-3.5 outline-none focus-visible:border-accent disabled:opacity-50';

export function Select({
  value,
  displayValue,
  options,
  label,
  className,
  disabled,
  onValueChange,
}: {
  value: string;
  displayValue?: string;
  options: SelectOption[];
  label: string;
  className?: string;
  disabled?: boolean;
  onValueChange(value: string): void;
}) {
  const portalContainer = usePortalContainer();
  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <RadixSelect.Trigger
        className={`${TRIGGER_CLASSES} ${className ?? ''}`.trim()}
        aria-label={label}
      >
        <RadixSelect.Value>{displayValue}</RadixSelect.Value>
        <RadixSelect.Icon className="inline-flex text-muted">
          <ChevronDown size={12} strokeWidth={2} />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal container={portalContainer ?? undefined}>
        <RadixSelect.Content
          className="z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-border bg-toolbar-secondary text-foreground shadow-popover"
          position="popper"
          sideOffset={5}
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
