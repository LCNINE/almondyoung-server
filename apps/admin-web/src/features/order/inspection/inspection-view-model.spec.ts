import {
  FORCE_DISPATCH_SCOPE,
  canShowForceDispatch,
  inspectionServerDenyMessage,
} from './inspection-view-model';

describe('inspection operation UI policy', () => {
  it('hides force dispatch unless the exact scope is granted', () => {
    expect(canShowForceDispatch([])).toBe(false);
    expect(canShowForceDispatch(['fulfillment.warehouse.operate'])).toBe(false);
    expect(canShowForceDispatch([FORCE_DISPATCH_SCOPE])).toBe(true);
  });

  it('keeps server authorization and conflict denials visible', () => {
    expect(
      inspectionServerDenyMessage({ status: 403, message: 'missing scope' })
    ).toContain('서버가 강제 출고를 거부');
    expect(
      inspectionServerDenyMessage({ status: 409, message: 'manifest changed' })
    ).toContain('충돌');
    expect(inspectionServerDenyMessage({ status: 500 })).toBeNull();
  });
});
