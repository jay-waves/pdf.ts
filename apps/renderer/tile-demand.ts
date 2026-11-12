import { samePageViewDemand, type ViewDemand, type ViewDemandInput } from '@embedpdf/plugin-render/contract/host';
import type { PageRef } from '@embedpdf/core';

/** Share deduplication between React commits and the immediate motion-end flush. */
export function tileDemandSubmitter(view: ViewDemand, page: PageRef) {
  let previous: { demand: ViewDemandInput; overlays: boolean; paused: boolean } | undefined;
  return (demand: ViewDemandInput, overlays: boolean, paused: boolean) => {
    if (previous && previous.overlays === overlays && previous.paused === paused &&
      samePageViewDemand(previous.demand, demand)) return;
    view.setPaused(page, paused);
    view.setDemand(page, demand, overlays ? { includeAnnotations: false, includeFormFields: false } : {});
    previous = { demand, overlays, paused };
  };
}
