jest.mock('@/const', () => ({ MEDUSA_BASE_URL: '/medusa' }), {
  virtual: true,
});

jest.mock('../../client', () => ({
  client: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('./price-preferences', () => ({
  medusaPricePreferencesApi: {
    list: jest.fn(),
    upsertCurrencyTaxInclusive: jest.fn(),
  },
}));

import { client } from '../../client';
import { medusaPricePreferencesApi } from './price-preferences';
import { medusaRegionsApi, type MedusaRegion } from './regions';

const mockedClient = client as unknown as {
  get: jest.Mock;
  post: jest.Mock;
};

const mockedPricePreferencesApi = medusaPricePreferencesApi as unknown as {
  list: jest.Mock;
  upsertCurrencyTaxInclusive: jest.Mock;
};

const region: MedusaRegion = {
  id: 'reg_kr',
  name: 'Korea',
  currency_code: 'krw',
  automatic_taxes: true,
  countries: [{ iso_2: 'kr', display_name: 'Korea' }],
  created_at: '2026-06-08T00:00:00.000Z',
  updated_at: '2026-06-08T00:00:00.000Z',
};

describe('medusaRegionsApi tax-inclusive price preferences', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fills listed regions from currency-level price preferences', async () => {
    mockedClient.get
      .mockResolvedValueOnce({
        data: {
          regions: [{ id: 'reg_kr' }],
          count: 1,
          offset: 0,
          limit: 100,
        },
      })
      .mockResolvedValueOnce({ data: { region } });
    mockedPricePreferencesApi.list.mockResolvedValue({
      price_preferences: [
        {
          id: 'pref_krw',
          attribute: 'currency_code',
          value: 'krw',
          is_tax_inclusive: true,
        },
      ],
      count: 1,
      offset: 0,
      limit: 1000,
    });

    const result = await medusaRegionsApi.list({ limit: 100 });

    expect(result.regions[0].is_tax_inclusive).toBe(true);
  });

  it('stores tax-inclusive state as a currency-level price preference when creating a region', async () => {
    mockedClient.post.mockResolvedValueOnce({ data: { region } });
    mockedPricePreferencesApi.upsertCurrencyTaxInclusive.mockResolvedValue({
      id: 'pref_krw',
      attribute: 'currency_code',
      value: 'krw',
      is_tax_inclusive: true,
    });

    const result = await medusaRegionsApi.create({
      name: 'Korea',
      currency_code: 'krw',
      countries: ['kr'],
      automatic_taxes: true,
      is_tax_inclusive: true,
    });

    expect(mockedClient.post).toHaveBeenCalledWith('/medusa/admin/regions', {
      name: 'Korea',
      currency_code: 'krw',
      countries: ['kr'],
      automatic_taxes: true,
    });
    expect(mockedPricePreferencesApi.upsertCurrencyTaxInclusive).toHaveBeenCalledWith(
      'krw',
      true,
    );
    expect(result.is_tax_inclusive).toBe(true);
  });
});
