import { Switch } from 'radix-ui';
import styles from './llm-settings.module.css';

export function SettingsToggle({ label, checked, onCheckedChange }: {
  label: string;
  checked: boolean;
  onCheckedChange(checked: boolean): void;
}) {
  return <Switch.Root type="button" className={styles.toggle} aria-label={label}
    checked={checked} onCheckedChange={onCheckedChange}>
    <Switch.Thumb className={styles.toggleThumb} />
  </Switch.Root>;
}
