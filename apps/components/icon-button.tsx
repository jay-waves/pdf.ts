import type { ComponentType } from 'react';
import { Tooltip } from './tooltip';
import styles from './icon-button.module.css';

interface IconButtonProps {
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  className?: string;
  active?: boolean;
  disabled?: boolean;
  iconSize?: number;
  onClick(): void;
}

export function IconButton({
  label,
  icon: Icon,
  className = '',
  active,
  disabled,
  iconSize = 14,
  onClick,
}: IconButtonProps) {
  const button = (
    <button
      type="button"
      className={[
        'cursor-pointer border border-transparent bg-transparent text-inherit',
        styles.button,
        className,
      ].join(' ')}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      data-active={active ? 'true' : undefined}
      title={disabled ? label : undefined}
    >
      <Icon size={iconSize} strokeWidth={2} />
    </button>
  );

  return disabled ? button : <Tooltip content={label}>{button}</Tooltip>;
}
