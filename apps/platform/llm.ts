import type { ViewerPlatform } from './types';

export function supportsLlm(platform: Pick<ViewerPlatform, 'ai'>) {
  return platform.ai !== undefined;
}
