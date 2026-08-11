import type { ButtonHTMLAttributes, ComponentType } from 'react';
import { Tooltip } from './tooltip';
import styles from './icon-button.module.css';

const CONTROL_BUTTON_CLASS = [
  'inline-grid size-6.5 flex-none cursor-pointer place-items-center rounded-md',
  'border border-transparent bg-transparent p-0 text-inherit outline-none',
  'transition-[background-color,border-color,box-shadow,color] duration-150 ease-control',
  'hover:border-accent hover:shadow-control focus-visible:border-accent focus-visible:shadow-control',
  'disabled:cursor-default disabled:opacity-48 motion-reduce:transition-none',
].join(' ');

export function ControlButton({ className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={`${CONTROL_BUTTON_CLASS} ${className}`.trim()} {...props} />;
}

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
    <ControlButton
      className={`${styles.button} ${className}`.trim()}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      data-active={active ? 'true' : undefined}
      title={disabled ? label : undefined}
    >
      <Icon size={iconSize} strokeWidth={2} />
    </ControlButton>
  );

  return disabled ? button : <Tooltip content={label}>{button}</Tooltip>;
}
