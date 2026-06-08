import { applyCurrencyTaxInclusivePreferences } from './region-tax-inclusive';

describe('applyCurrencyTaxInclusivePreferences', () => {
  it('fills region tax-inclusive state from currency-level price preferences', () => {
    const regions = [
      { id: 'reg_kr', currency_code: 'krw' },
      { id: 'reg_us', currency_code: 'usd' },
    ];

    const result = applyCurrencyTaxInclusivePreferences(regions, [
      {
        attribute: 'currency_code',
        value: 'krw',
        is_tax_inclusive: true,
      },
      {
        attribute: 'currency_code',
        value: 'usd',
        is_tax_inclusive: false,
      },
    ]);

    expect(result).toEqual([
      { id: 'reg_kr', currency_code: 'krw', is_tax_inclusive: true },
      { id: 'reg_us', currency_code: 'usd', is_tax_inclusive: false },
    ]);
  });

  it('matches currency codes case-insensitively and ignores region-level preferences', () => {
    const result = applyCurrencyTaxInclusivePreferences(
      [{ id: 'reg_kr', currency_code: 'KRW' }],
      [
        {
          attribute: 'region_id',
          value: 'reg_kr',
          is_tax_inclusive: false,
        },
        {
          attribute: 'currency_code',
          value: 'krw',
          is_tax_inclusive: true,
        },
      ],
    );

    expect(result[0].is_tax_inclusive).toBe(true);
  });

  it('defaults tax-inclusive state to false when there is no currency preference', () => {
    const result = applyCurrencyTaxInclusivePreferences(
      [{ id: 'reg_jp', currency_code: 'jpy' }],
      [],
    );

    expect(result[0].is_tax_inclusive).toBe(false);
  });
});
