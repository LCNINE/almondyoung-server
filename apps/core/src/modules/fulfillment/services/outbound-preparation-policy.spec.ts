import { canReplaceDraft } from './outbound-preparation-policy';
import { isPreparationBlocked } from './outbound-preparation-result';
import { unwrapPreparedOutbound } from '../controllers/outbound-preparation-http';
const eligible = {
  reasonCode: 'SOURCE_STOCK_CHANGED' as const,
  supportedIndividual: true,
  shipmentSnapshotUnchanged: true,
  hasSession: false,
  hasCustody: false,
  hasPickHistory: false,
  hasInspection: false,
  hasOtherActiveClaim: false,
};
describe('outbound preparation policy and HTTP boundary', () => {
  it('replaces only an untouched source-stale individual draft', () => {
    expect(canReplaceDraft(eligible)).toBe(true);
    for (const field of ['hasSession', 'hasCustody', 'hasPickHistory', 'hasInspection', 'hasOtherActiveClaim'])
      expect(canReplaceDraft({ ...eligible, [field]: true })).toBe(false);
    expect(canReplaceDraft({ ...eligible, reasonCode: undefined })).toBe(false);
    expect(canReplaceDraft({ ...eligible, reasonCode: 'SHIPMENT_SNAPSHOT_CHANGED' })).toBe(false);
    expect(canReplaceDraft({ ...eligible, supportedIndividual: false })).toBe(false);
    expect(canReplaceDraft({ ...eligible, shipmentSnapshotUnchanged: false })).toBe(false);
  });
  it('maps only known durable markers and preserves success snapshots', () => {
    const marker = {
      outcome: 'preparation_blocked',
      code: 'SIMPLE_OUTBOUND_PLAN_INVALIDATED',
      reasonCode: 'SOURCE_INSUFFICIENT',
      batchId: 'b',
      invalidatedPlanId: null,
      recovery: 'retry_preparation',
    } as const;
    expect(isPreparationBlocked(marker)).toBe(true);
    expect(isPreparationBlocked({ ...marker, reasonCode: 'DB_ERROR' })).toBe(false);
    expect(() => unwrapPreparedOutbound(marker)).toThrow('재고');
    const success = { shipmentId: 's' };
    expect(unwrapPreparedOutbound(success)).toBe(success);
  });
});
