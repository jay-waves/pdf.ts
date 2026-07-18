import type { ReactNode } from 'react';
import { RadioGroup as RadixRadioGroup } from 'radix-ui';

export function RadioGroup<T extends string>({
  value,
  onValueChange,
  label,
  className,
  children,
}: {
  value: T;
  onValueChange(value: T): void;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <RadixRadioGroup.Root value={value} onValueChange={(nextValue) => onValueChange(nextValue as T)} aria-label={label} className={className}>
      {children}
    </RadixRadioGroup.Root>
  );
}

export function RadioGroupItem({
  value,
  children,
  detail,
}: {
  value: string;
  children: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <label className="shnctl-radio-item">
      <RadixRadioGroup.Item className="shnctl-radio-control" value={value}>
        <RadixRadioGroup.Indicator className="shnctl-radio-indicator" />
      </RadixRadioGroup.Item>
      <span>{children}</span>
      {detail === undefined ? null : <small>{detail}</small>}
    </label>
  );
}
