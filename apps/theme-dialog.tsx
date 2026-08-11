import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { RadioGroup as RadixRadioGroup } from 'radix-ui';
import { Button, DialogActions } from './components';
import {
  getViewerThemeOptions,
  getViewerThemeSettings,
  setViewerThemeSettings,
} from './theme';
import styles from './document-dialogs.module.css';
import { DocumentDialog } from './document-dialog-shared';

const LIGHT_THEME_OPTIONS = getViewerThemeOptions('light');
const DARK_THEME_OPTIONS = getViewerThemeOptions('dark');

function ThemeOptionRow<Option extends string>({
  label,
  value,
  options,
  onValueChange,
}: {
  label: string;
  value: Option;
  options: Array<{ value: Option; label: string }>;
  onValueChange(value: Option): void;
}) {
  const gridStyle = { '--theme-option-count': options.length } as CSSProperties;
  return <div className={styles.themeRow}>
    <span>{label}</span>
    <RadixRadioGroup.Root
      className={styles.themeOptions}
      style={gridStyle}
      value={value}
      onValueChange={(nextValue) => {
        const option = options.find((candidate) => candidate.value === nextValue);
        if (option) onValueChange(option.value);
      }}
      aria-label={`${label} appearance theme`}
    >
      {options.map((option) => (
        <RadixRadioGroup.Item key={option.value} value={option.value} className={styles.themeOption}>
          {option.label}
        </RadixRadioGroup.Item>
      ))}
    </RadixRadioGroup.Root>
  </div>;
}

export function ThemeDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const [settings, setSettings] = useState(getViewerThemeSettings);

  useEffect(() => {
    if (open) setSettings(getViewerThemeSettings());
  }, [open]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setViewerThemeSettings(settings);
    onClose();
  };

  return (
    <DocumentDialog open={open} onClose={onClose} title="Themes">
      <form className={`${styles.form} ${styles.themeForm}`} onSubmit={submit}>
        <ThemeOptionRow
          label="Light"
          value={settings.light}
          options={LIGHT_THEME_OPTIONS}
          onValueChange={(light) => setSettings((current) => ({ ...current, light }))}
        />
        <ThemeOptionRow
          label="Dark"
          value={settings.dark}
          options={DARK_THEME_OPTIONS}
          onValueChange={(dark) => setSettings((current) => ({ ...current, dark }))}
        />
        <DialogActions className={styles.flatActions}>
          <Button className={styles.flatButton} onClick={onClose}>Cancel</Button>
          <Button className={styles.flatButton} type="submit" variant="primary">Save</Button>
        </DialogActions>
      </form>
    </DocumentDialog>
  );
}
