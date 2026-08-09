const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:']);

export function parseUrl(value: string, base?: string | URL) {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}

export function getExternalUrl(value: string, base?: string | URL) {
  const url = parseUrl(value, base);
  return url && EXTERNAL_PROTOCOLS.has(url.protocol) ? url.href : null;
}

export function getFileNameFromUrl(value: string) {
  const url = parseUrl(value);
  const encodedName = url?.pathname.split('/').filter(Boolean).at(-1);
  if (!encodedName) return undefined;

  try {
    return decodeURIComponent(encodedName);
  } catch {
    return undefined;
  }
}

export function getSelectedExternalUrl(text: string) {
  const value = text.trim();
  if (!value || /\s|@/.test(value)) return null;
  if (/^https?:\/\//i.test(value)) return getExternalUrl(value);
  if (/^(?:www\.)?(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/i.test(value)) {
    return getExternalUrl(`https://${value}`);
  }
  return null;
}
