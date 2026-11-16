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

  it('holds legacy mall without original evidence and phone without duplicate review', () => {
    const result = companyRevenueRows(
      [row(), row({ channel: 'cafe24' }), row({ channel: 'phone' })],
      '2026-11-16',
      false
    );
    expect(result.amount).toBe(100);
    expect(result.excludedCount).toBe(2);
  });

  it('includes only complete legacy months before daily coverage and leaves transition months pending', () => {
    const legacy = row({
      channel: 'cafe24',
      basis: 'operational_net',
      originalStatus: 'confirmed',
    });
    const result = companyRevenueRows(
      [
        { ...legacy, month: '2026-05', amount: 500 },
        { ...legacy, month: '2026-06', amount: 200 },
        { ...legacy, month: '2026-07', amount: 30 },
      ],
      '2026-11-16',
      false,
      '2026-06-15'
    );
    expect(result.amount).toBe(500);
    expect(result.excludedCount).toBe(2);
    expect(result.rows[0].reason).toContain('수기 누적액 대신');
    expect(result.rows[0].duplicateStatus).toBeUndefined();
  });

  it('does not infer a cutover from missing coverage or allow conflicting legacy bases', () => {
    const legacy = row({
      channel: 'cafe24',
      basis: 'operational_net',
      originalStatus: 'confirmed',
    });
    expect(companyRevenueRows([legacy], '2026-11-16', false).amount).toBe(0);
    expect(
      companyRevenueRows(
        [legacy, { ...legacy, basis: 'paid' }],
        '2026-11-16',
        false,
        '2026-06-01'
      ).amount
    ).toBe(0);
    expect(
      companyRevenueRows([legacy], '2026-11-16', true, '2026-06-01').amount
    ).toBe(0);
  });

  it('requires source and duplicate review for overlapping legacy and phone orders', () => {
    const reviewed = {
      originalStatus: 'confirmed',
      duplicateStatus: 'confirmed',
    };
    const result = companyRevenueRows(
      [
        row({
          channel: 'cafe24',
          month: '2026-07',
          basis: 'operational_net',
          ...reviewed,
        }),
        row({ channel: 'phone', basis: 'paid', ...reviewed }),
        row({
          channel: 'phone',
          account: 'pending',
          basis: 'paid',
          originalStatus: 'confirmed',
        }),
        row({
          channel: 'phone',
          account: 'no-source',
          basis: 'paid',
          duplicateStatus: 'confirmed',
        }),
      ],
      '2026-11-16',
      false,
      '2026-06-01'
    );
    expect(result.amount).toBe(200);
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

import { annualCompanyRevenue } from './company-revenue';

describe('annual company revenue', () => {
  const input = {
    today: '2026-06-16',
    coverageStart: '2026-06-01',
    hasIntegratedChannels: false,
    refunds: new Map([['2026-06-15', 20]]),
    daily: [
      { date: '2025-12-31', ownMall: 900, allChannels: 900 },
      { date: '2026-06-15', ownMall: 200, allChannels: 200 },
      { date: '2026-06-16', ownMall: 800, allChannels: 800 },
    ],
    external: [
      row({
        channel: 'cafe24',
        month: '2026-05',
        basis: 'operational_net',
        originalStatus: 'confirmed',
        amount: 500,
      }),
      row({
        channel: 'cafe24',
        month: '2026-06',
        basis: 'operational_net',
        originalStatus: 'confirmed',
        amount: 300,
      }),
      row({ channel: 'naver', month: '2026-05', amount: 100 }),
      row({ channel: 'coupang', month: '2026-06', amount: 50 }),
      row({
        channel: 'coupang',
        account: 'rocket',
        month: '2026-06',
        amount: 30,
      }),
    ],
  };

  it('merges legacy mall into own mall, combines marketplace accounts, and reconciles all monthly totals', () => {
    const result = annualCompanyRevenue(input);
    expect(result.totals).toEqual({
      own_mall: 680,
      naver: 100,
      coupang: 80,
      phone: 0,
      other: 0,
      all: 860,
    });
    expect(result.dailyAmount).toBe(180);
    expect(result.monthly[4].all).toBe(600);
    expect(result.monthly[5].all).toBe(260);
    expect(result.monthly.reduce((sum, month) => sum + month.all, 0)).toBe(
      result.totals!.all
    );
    expect(result.imported.excludedCount).toBe(1);
  });

  it('does not invent an opening balance from a legacy goal or spread monthly imports over days', () => {
    const result = annualCompanyRevenue({ ...input, daily: [] });
    expect(result.monthly[0].all).toBe(0);
    expect(result.monthly[4].own_mall).toBe(500);
    expect(result.totals!.all).toBe(680);
  });

  it('fails closed when refund data is unavailable', () => {
    expect(annualCompanyRevenue({ ...input, refunds: null }).totals).toBeNull();
  });

  it('preserves integrated channel revenue separately without labeling it own mall or adding duplicate uploads', () => {
    const result = annualCompanyRevenue({
      ...input,
      hasIntegratedChannels: true,
      daily: [{ date: '2026-06-15', ownMall: 200, allChannels: 270 }],
    });
    expect(result.totals!.all).toBe(250);
    expect(result.totals!.own_mall).toBe(180);
    expect(result.totals!.other).toBe(70);
    expect(result.imported.amount).toBe(0);
  });
});
