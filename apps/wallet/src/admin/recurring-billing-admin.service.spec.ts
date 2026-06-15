import { aggregateAgreementStatus } from './recurring-billing-admin.service';

describe('aggregateAgreementStatus', () => {
  it('returns null when no agreement exists', () => {
    expect(aggregateAgreementStatus([])).toBeNull();
  });

  it('preserves provider status instead of collapsing unknown statuses to unregistered', () => {
    expect(
      aggregateAgreementStatus([
        { status: '확인', createdAt: new Date('2026-06-15T09:34:51.296Z') },
      ]),
    ).toBe('확인');
  });

  it('uses the latest agreement status instead of any historical registered status', () => {
    expect(
      aggregateAgreementStatus([
        { status: '등록', createdAt: new Date('2026-06-14T00:00:00.000Z') },
        { status: '확인', createdAt: new Date('2026-06-15T00:00:00.000Z') },
      ]),
    ).toBe('확인');
  });
});
