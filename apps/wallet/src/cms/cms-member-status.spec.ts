import { interpretLiveCmsMemberStatus } from './cms-member-status';

describe('interpretLiveCmsMemberStatus', () => {
  it('maps 효성 terminal statuses', () => {
    expect(interpretLiveCmsMemberStatus('신청완료')).toBe('REGISTERED');
    expect(interpretLiveCmsMemberStatus('신청실패')).toBe('FAILED');
  });

  it('treats 신청중/unknown/empty as in-flight', () => {
    expect(interpretLiveCmsMemberStatus('신청중')).toBe('IN_FLIGHT');
    expect(interpretLiveCmsMemberStatus('')).toBe('IN_FLIGHT');
    expect(interpretLiveCmsMemberStatus(undefined)).toBe('IN_FLIGHT');
    expect(interpretLiveCmsMemberStatus(null)).toBe('IN_FLIGHT');
  });
});
