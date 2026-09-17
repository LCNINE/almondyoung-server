import type { PlanInvalidationCode } from '../picking/plan/plan-invalidation';
export function canReplaceDraft(input: {
  reasonCode?: PlanInvalidationCode;
  supportedIndividual: boolean;
  shipmentSnapshotUnchanged: boolean;
  hasSession: boolean;
  hasCustody: boolean;
  hasPickHistory: boolean;
  hasInspection: boolean;
  hasOtherActiveClaim: boolean;
}): boolean {
  return (
    input.reasonCode === 'SOURCE_STOCK_CHANGED' &&
    input.supportedIndividual &&
    input.shipmentSnapshotUnchanged &&
    !input.hasSession &&
    !input.hasCustody &&
    !input.hasPickHistory &&
    !input.hasInspection &&
    !input.hasOtherActiveClaim
  );
}
