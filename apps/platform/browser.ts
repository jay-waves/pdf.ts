import { platform as chromePlatform } from './chrome';
import { platform as launcherPlatform } from './launcher';
import { platform as webPlatform } from './web';
import type { ViewerPlatform } from './types';

/**
 * The daemon creates URLs containing an opaque document capability. A normal
 * web deployment never adds this parameter, so both modes can safely share one
 * browser bundle without probing localhost or guessing whether a daemon exists.
 * Chrome extension pages are identified by their protocol and use that same
 * bundle with the extension adapter.
 */
const isLauncher = window.location.hostname === 'pdf.ts.localhost'
  || new URLSearchParams(window.location.search).has('launcherDocument');
const isChromeExtension = window.location.protocol === 'chrome-extension:';

export const platform: ViewerPlatform = isChromeExtension
  ? chromePlatform
  : isLauncher
    ? launcherPlatform
    : webPlatform;
