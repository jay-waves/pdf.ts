import type { ViewerPlatform } from './types';

export function supportsLlm(platform: Pick<ViewerPlatform, 'requestAi' | 'getAiConfig' | 'setAiConfig'>) {
  return Boolean(platform.requestAi && platform.getAiConfig && platform.setAiConfig);
}
