import { nextCmsPaymentDate } from './cms-date.util';

describe('nextCmsPaymentDate', () => {
  it('uses Monday when Friday request is before the previous-business-day cutoff', () => {
    const fridayBeforeCutoffKst = new Date(Date.UTC(2026, 5, 12, 16, 0, 0));

    expect(nextCmsPaymentDate(fridayBeforeCutoffKst)).toBe('20260615');
  });

  it('skips Monday when Friday request is after the cutoff for Monday withdrawal', () => {
    const fridayAfterCutoffKst = new Date(Date.UTC(2026, 5, 12, 18, 0, 0));

    expect(nextCmsPaymentDate(fridayAfterCutoffKst)).toBe('20260616');
  });

  it('skips configured Korean holidays and validates the cutoff against the previous business day', () => {
    const beforeChuseokCutoffKst = new Date(Date.UTC(2026, 8, 23, 16, 0, 0));
    const afterChuseokCutoffKst = new Date(Date.UTC(2026, 8, 23, 18, 0, 0));

    expect(nextCmsPaymentDate(beforeChuseokCutoffKst)).toBe('20260928');
    expect(nextCmsPaymentDate(afterChuseokCutoffKst)).toBe('20260929');
  });
});
