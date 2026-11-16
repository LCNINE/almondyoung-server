import { companyRevenueRows } from './company-revenue';
import type { ExternalRevenueRow } from './model';

const row = (
  changes: Partial<ExternalRevenueRow> = {}
): ExternalRevenueRow => ({
  channel: 'naver',
  account: 'sample',
  month: '2026-01',
  basis: 'purchase_confirmed',
  amount: 100,
  source: 'test fixture',
  ...changes,
});

describe('provisional company revenue', () => {
  it('includes uploaded marketplace months without requiring a false confirmed status', () => {
    const result = companyRevenueRows(
      [row(), row({ channel: 'coupang', amount: 50, month: '2026-11' })],
      '2026-11-16',
      false
    );
    expect(result.amount).toBe(150);
    expect(result.currentMonthAmount).toBe(50);
    expect(result.rows.every((r) => r.included)).toBe(true);
    expect(result.rows[0].duplicateStatus).toBeUndefined();
  });

  it('never adds legacy mall or phone totals to the existing baseline', () => {
    const result = companyRevenueRows(
      [row(), row({ channel: 'cafe24' }), row({ channel: 'phone' })],
      '2026-11-16',
      false
    );
    expect(result.amount).toBe(100);
    expect(result.excludedCount).toBe(2);
  });

  it('excludes every conflicting basis for an account-month rather than selecting or summing arbitrarily', () => {
    const result = companyRevenueRows(
      [row(), row({ basis: 'paid' }), row({ account: 'other' })],
      '2026-11-16',
      false
    );
    expect(result.amount).toBe(100);
    expect(result.excludedCount).toBe(2);
  });

  it('stops combining uploads when integrated external channels exist', () => {
    expect(companyRevenueRows([row()], '2026-11-16', true).amount).toBe(0);
  });

  it('excludes future periods, other years, and unsupported bases while retaining corrections and zeros', () => {
    const result = companyRevenueRows(
      [
        row({ month: '2025-12' }),
        row({ month: '2026-12' }),
        row({ basis: 'operational_net', account: 'unsupported' }),
        row({ amount: -20 }),
        row({ month: '2026-02', amount: 0 }),
      ],
      '2026-11-16',
      false
    );
    expect(result.amount).toBe(-20);
    expect(result.includedCount).toBe(2);
    expect(result.excludedCount).toBe(1);
  });
});
