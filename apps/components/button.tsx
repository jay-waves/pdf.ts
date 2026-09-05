import type { ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'secondary';
type ButtonAppearance = 'raised' | 'flat';

const BASE_CLASSES = [
  'inline-flex h-7 min-w-16 cursor-pointer items-center justify-center rounded-lg',
  'border px-2.5 text-inherit',
  'shadow-none',
  'transition-[background-color,border-color,box-shadow,color,transform] duration-150',
  'ease-control',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
  'active:scale-[0.97]',
  'disabled:cursor-default disabled:opacity-50 disabled:active:scale-100',
  'motion-reduce:transition-none motion-reduce:active:scale-100',
].join(' ');

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: [
    'border-accent bg-accent text-surface',
    'hover:border-accent hover:bg-accent-hover',
    'focus-visible:ring-accent',
  ].join(' '),
  secondary: [
    'border-border-subtle bg-[var(--pdf-control-background)] text-foreground',
    'hover:border-border hover:bg-hover',
    'focus-visible:ring-accent',
  ].join(' '),
};

const FLAT_CLASSES = 'border-transparent bg-transparent shadow-none';

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
      className={`${BASE_CLASSES} ${VARIANT_CLASSES[variant]} ${appearance === 'flat' && variant === 'secondary' ? FLAT_CLASSES : ''} ${className}`.trim()}
      {...props}
    />
  );
}
