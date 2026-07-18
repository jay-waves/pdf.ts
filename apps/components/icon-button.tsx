import type { ComponentType } from 'react';
import { Tooltip } from './tooltip';

export interface IconButtonProps {
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  className?: string;
  active?: boolean;
  disabled?: boolean;
  iconSize?: number;
  tooltip?: boolean;
  onClick(): void;
}

export function IconButton({
  label,
  icon: Icon,
  className = '',
  active,
  disabled,
  iconSize = 14,
  tooltip = true,
  onClick,
}: IconButtonProps) {
  const button = (
    <button
      type="button"
      className={`shnctl-action ${className}${active ? ' is-active' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      title={!tooltip || disabled ? label : undefined}
    >
      <Icon size={iconSize} strokeWidth={2} />
    </button>
  );

  return tooltip && !disabled
    ? <Tooltip content={label}>{button}</Tooltip>
    : button;
}
