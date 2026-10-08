import type { ButtonHTMLAttributes, ComponentType } from 'react';
import { Tooltip } from './tooltip';
import styles from './icon-button.module.css';
import { Toolbar } from 'radix-ui';
import { useInToolbar } from './floating-toolbar';

const CONTROL_BUTTON_CLASS = [
  'inline-grid size-6.5 flex-none cursor-pointer place-items-center rounded-lg',
  'border border-transparent bg-transparent p-0 text-inherit outline-none',
  'transition-[background-color,border-color,box-shadow,color,transform] duration-150 ease-control',
  'hover:bg-hover focus-visible:border-accent focus-visible:shadow-control active:scale-[0.96]',
  'disabled:cursor-default disabled:opacity-48 disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100',
].join(' ');

export function ControlButton({ className = '', type = 'button', toggleValue, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { toggleValue?: string }) {
  const inToolbar = useInToolbar();
  const classNames = `${CONTROL_BUTTON_CLASS} ${className}`.trim();
  if (toggleValue !== undefined) return <Toolbar.ToggleItem type={type} className={classNames} {...props} value={toggleValue} />;
  const Component = inToolbar ? Toolbar.Button : 'button';
  return <Component type={type} className={classNames} {...props} />;
}

interface IconButtonProps {
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  className?: string;
  active?: boolean;
  disabled?: boolean;
  iconSize?: number;
  toggleValue?: string;
  onClick?(): void;
}

export function IconButton({
  label,
  icon: Icon,
  className = '',
  active,
  disabled,
  iconSize = 14,
  onClick,
  toggleValue,
}: IconButtonProps) {
  const button = (
    <ControlButton
      className={`${styles.button} ${className}`.trim()}
      onClick={onClick}
      toggleValue={toggleValue}
      disabled={disabled}
      aria-label={label}
      {...(toggleValue === undefined ? {
        'aria-pressed': active,
        'data-active': active ? 'true' : undefined,
      } : {})}
      title={disabled ? label : undefined}
    >
      <Icon size={iconSize} strokeWidth={2} />
    </ControlButton>
  );

  return disabled ? button : <Tooltip content={label}>{button}</Tooltip>;
}
