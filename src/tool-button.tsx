import type { ComponentType } from 'react';

export interface ShnctlIconButtonProps {
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  className: string;
  active?: boolean;
  disabled?: boolean;
  iconSize?: number;
  tooltip?: 'data' | 'title';
  onClick(): void;
}

export function ShnctlIconButton({
  label,
  icon: Icon,
  className,
  active,
  disabled,
  iconSize = 14,
  tooltip = 'title',
  onClick,
}: ShnctlIconButtonProps) {
  return (
    <button
      type="button"
      className={`shnctl-action ${className}${active ? ' is-active' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      data-shnctl-tooltip={tooltip === 'data' ? label : undefined}
      title={tooltip === 'title' ? label : undefined}
    >
      <Icon size={iconSize} strokeWidth={2} />
    </button>
  );
}
