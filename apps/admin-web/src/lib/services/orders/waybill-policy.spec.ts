import {
  isCarrierSupported,
  isWaybillIssued,
  isWaybillPendingIssue,
  isWaybillFailed,
  WAYBILL_CARRIERS,
  WAYBILL_LIVE_CARRIERS,
} from './waybill-policy';

describe('waybill-policy', () => {
  it('lists all enum carriers but only HANJIN is live', () => {
    expect(WAYBILL_CARRIERS).toEqual([
      'CJ',
      'HANJIN',
      'LOTTE',
      'LOGEN',
      'KDEXP',
      'CJGLS',
    ]);
    expect(WAYBILL_LIVE_CARRIERS).toEqual(['HANJIN']);
    expect(isCarrierSupported('HANJIN')).toBe(true);
    expect(isCarrierSupported('CJ')).toBe(false);
  });

  it('treats only registered/used as issued', () => {
    expect(isWaybillIssued('registered')).toBe(true);
    expect(isWaybillIssued('used')).toBe(true);
    expect(isWaybillIssued('allocated')).toBe(false);
    expect(isWaybillIssued('pending')).toBe(false);
    expect(isWaybillIssued(null)).toBe(false);
  });

  it('classifies pending and failed states', () => {
    expect(isWaybillPendingIssue('pending')).toBe(true);
    expect(isWaybillPendingIssue('allocated')).toBe(true);
    expect(isWaybillPendingIssue('registered')).toBe(false);
    expect(isWaybillFailed('failed')).toBe(true);
    expect(isWaybillFailed('abandoned')).toBe(true);
    expect(isWaybillFailed('pending')).toBe(false);
  });
});
