import { platform as launcherPlatform } from './launcher';
import { platform as webPlatform } from './web';
import type { ViewerPlatform } from './types';

/**
 * The daemon creates URLs containing an opaque document capability. A normal
 * web deployment never adds this parameter, so both modes can safely share one
 * browser bundle without probing localhost or guessing whether a daemon exists.
 */
const isLauncherDocument = Boolean(
  new URLSearchParams(window.location.search).get('launcherDocument'),
);

export const platform: ViewerPlatform = isLauncherDocument
  ? launcherPlatform
  : webPlatform;
