import { useEffect, useState } from 'react';
import { RadioGroup as RadixRadioGroup } from 'radix-ui';
import {
  getViewerThemeOptions,
  getViewerThemeSettings,
  isDarkViewerTheme,
  setViewerThemeSettings,
  type ViewerTheme,
  useViewerTheme,
} from './theme';
import styles from './document-dialogs.module.css';
import { DocumentDialog } from './document-dialog-shared';

const LIGHT_THEME_OPTIONS = getViewerThemeOptions('light');
const DARK_THEME_OPTIONS = getViewerThemeOptions('dark');

const THEME_PREVIEWS: Record<ViewerTheme, readonly [string, string, string]> = {
  light: ['#f8fafc', '#ffffff', '#2563eb'],
  solar: ['#f7f5ef', '#fbfaf6', '#5f8f86'],
  'catppuccin-latte': ['#dce0e8', '#eff1f5', '#8839ef'],
  dark: ['#161616', '#333333', '#f4f4f4'],
  nord: ['#2e3440', '#434c5e', '#88c0d0'],
  gruvbox: ['#2d2c2a', '#504945', '#c7ce94'],
  'catppuccin-mocha': ['#292c3c', '#383c4f', '#cba6f7'],
};

function ThemeOptionRow<Option extends ViewerTheme>({
  label,
  value,
  options,
  disabled,
  onValueChange,
}: {
  label: string;
  value: Option;
  options: Array<{ value: Option; label: string }>;
  disabled: boolean;
  onValueChange(value: Option): void;
}) {
  return <fieldset className={styles.themeGroup} disabled={disabled}>
    <legend className={styles.themeGroupLabel}>{label}</legend>
    <RadixRadioGroup.Root
      className={styles.themeOptions}
      value={value}
      onValueChange={(nextValue) => {
        const option = options.find((candidate) => candidate.value === nextValue);
        if (option) onValueChange(option.value);
      }}
      aria-label={`${label} appearance theme`}
    >
      {options.map((option) => {
        const preview = THEME_PREVIEWS[option.value];
        return (
          <RadixRadioGroup.Item
            key={option.value}
            value={option.value}
            className={styles.themeOption}
            disabled={disabled}
          >
            <span className={styles.themePreview} aria-hidden="true">
              {preview.map((color) => <span key={color} style={{ backgroundColor: color }} />)}
            </span>
            <span className={styles.themeOptionLabel}>{option.label}</span>
          </RadixRadioGroup.Item>
        );
      })}
    </RadixRadioGroup.Root>
  </fieldset>;
}

export function ThemeDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const [settings, setSettings] = useState(getViewerThemeSettings);
  const darkMode = isDarkViewerTheme(useViewerTheme());

  useEffect(() => {
    if (open) setSettings(getViewerThemeSettings());
  }, [open]);

  const selectTheme = <Key extends keyof typeof settings>(key: Key, value: typeof settings[Key]) => {
    const nextSettings = { ...settings, [key]: value };
    setSettings(nextSettings);
    setViewerThemeSettings(nextSettings);
  };

  return (
    <DocumentDialog open={open} onClose={onClose} title="Themes">
      <div className={`${styles.form} ${styles.themeForm}`}>
        <ThemeOptionRow
          label="Light"
          value={settings.light}
          options={LIGHT_THEME_OPTIONS}
          disabled={darkMode}
          onValueChange={(light) => selectTheme('light', light)}
        />
        <ThemeOptionRow
          label="Dark"
          value={settings.dark}
          options={DARK_THEME_OPTIONS}
          disabled={!darkMode}
          onValueChange={(dark) => selectTheme('dark', dark)}
        />
      </div>
    </DocumentDialog>
  );
}
