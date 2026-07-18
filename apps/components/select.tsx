import { Check, ChevronDown } from 'lucide-react';
import { Select as RadixSelect } from 'radix-ui';

export interface SelectOption {
  label: string;
  value: string;
}

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
  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <RadixSelect.Trigger className={className} aria-label={label}>
        <RadixSelect.Value>{displayValue}</RadixSelect.Value>
        <RadixSelect.Icon className="shnctl-select-chevron">
          <ChevronDown size={12} strokeWidth={2} />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content className="shnctl-select-content" position="popper" sideOffset={5} collisionPadding={6}>
          <RadixSelect.Viewport className="shnctl-select-viewport">
            {options.map((option) => (
              <RadixSelect.Item className="shnctl-select-item" key={option.value} value={option.value}>
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                <RadixSelect.ItemIndicator className="shnctl-select-indicator">
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
