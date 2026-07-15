import {
  FULFILLMENT_SCOPES,
  canRecallShipment,
  canShowFulfillmentAction,
  isRecoverableOperation,
} from './operation-policy';

describe('fulfillment admin operation policy', () => {
  it('hides privileged actions without treating visibility as authorization', () => {
    const scopes = [FULFILLMENT_SCOPES.operate];
    expect(canShowFulfillmentAction('split', scopes)).toBe(true);
    expect(canShowFulfillmentAction('recall', scopes)).toBe(false);
    expect(canShowFulfillmentAction('consolidate', scopes)).toBe(false);
    expect(canShowFulfillmentAction('forceDispatch', scopes)).toBe(false);
  });

  it('only marks durable non-terminal states recoverable', () => {
    expect(isRecoverableOperation('pending')).toBe(true);
    expect(isRecoverableOperation('in_progress')).toBe(true);
    expect(isRecoverableOperation('recovery_required')).toBe(true);
    expect(isRecoverableOperation('completed')).toBe(false);
    expect(isRecoverableOperation('succeeded')).toBe(false);
  });

  it('only offers recall for a shipped shipment with a dispatched attempt', () => {
    expect(canRecallShipment('shipped', ['dispatched'])).toBe(true);
    expect(canRecallShipment('delivered', ['dispatched'])).toBe(false);
    expect(canRecallShipment('shipped', ['delivered'])).toBe(false);
    expect(canRecallShipment('in_transit', ['dispatched'])).toBe(false);
  });
});
