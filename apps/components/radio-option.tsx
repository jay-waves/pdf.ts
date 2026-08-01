import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { RadioGroup as RadixRadioGroup } from 'radix-ui';

export function RadioOption({ value, children, trailing }: {
  value: string;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <RadixRadioGroup.Item
      className={[
        'grid min-h-8.25 w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2',
        'border-0 border-b border-border bg-transparent px-2 py-1.25 text-left text-inherit outline-none last:border-b-0',
        'transition-[background-color,box-shadow] duration-150 ease-control',
        'hover:bg-hover focus-visible:relative focus-visible:z-1 focus-visible:shadow-[inset_0_0_0_1px_var(--pdf-accent)]',
        'data-[state=checked]:bg-selected',
        'motion-reduce:transition-none',
      ].join(' ')}
      value={value}
    >
      <span className="grid size-4 shrink-0 place-items-center rounded border border-border-strong bg-input">
        <RadixRadioGroup.Indicator className="grid size-full place-items-center text-accent">
          <Check size={11} strokeWidth={3} />
        </RadixRadioGroup.Indicator>
      </span>
      <span>{children}</span>
      {trailing ? <small className="text-muted tabular-nums">{trailing}</small> : null}
    </RadixRadioGroup.Item>
  );
}
