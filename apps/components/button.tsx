import type { ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'secondary';
type ButtonAppearance = 'raised' | 'flat';

const BASE_CLASSES = [
  'inline-flex h-7 min-w-16 cursor-pointer items-center justify-center rounded',
  'border px-2.5 text-inherit',
  'shadow-[0_1px_2px_rgb(0_0_0_/_8%)]',
  'transition-[background-color,border-color,box-shadow,color,transform] duration-150',
  'ease-control',
  'hover:-translate-y-px hover:shadow-[0_3px_8px_rgb(0_0_0_/_13%)]',
  'focus-visible:outline-none focus-visible:ring-[0.5px] focus-visible:ring-inset',
  'active:translate-y-0 active:shadow-none',
  'disabled:cursor-default disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none',
  'motion-reduce:transition-none motion-reduce:hover:translate-y-0',
].join(' ');

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: [
    'border-accent bg-accent text-surface',
    'hover:border-accent hover:bg-accent-hover',
    'focus-visible:ring-accent',
  ].join(' '),
  secondary: [
    'border-control-border bg-surface-alt text-foreground',
    'hover:border-accent hover:bg-hover',
    'focus-visible:ring-accent',
  ].join(' '),
};

const FLAT_CLASSES = 'shadow-none hover:translate-y-0 hover:shadow-none active:translate-y-0 active:shadow-none';

export function Button({
  variant = 'secondary',
  appearance = 'raised',
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  appearance?: ButtonAppearance;
}) {
  return (
    <button
      type={type}
      className={`${BASE_CLASSES} ${VARIANT_CLASSES[variant]} ${appearance === 'flat' ? FLAT_CLASSES : ''} ${className}`.trim()}
      {...props}
    />
  );
}
