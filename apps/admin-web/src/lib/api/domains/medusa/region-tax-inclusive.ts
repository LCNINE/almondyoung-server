export interface RegionTaxInclusiveSource {
  currency_code: string;
  is_tax_inclusive?: boolean;
}

export interface TaxInclusivePricePreference {
  attribute: string;
  value: string;
  is_tax_inclusive: boolean;
}

export const CURRENCY_TAX_INCLUSIVE_ATTRIBUTE = 'currency_code';

const normalizePreferenceValue = (value: string) => value.trim().toLowerCase();

export function findCurrencyTaxInclusivePreference<T extends TaxInclusivePricePreference>(
  pricePreferences: T[],
  currencyCode: string,
): T | undefined {
  const normalizedCurrencyCode = normalizePreferenceValue(currencyCode);

  return pricePreferences.find(
    (preference) =>
      preference.attribute === CURRENCY_TAX_INCLUSIVE_ATTRIBUTE &&
      normalizePreferenceValue(preference.value) === normalizedCurrencyCode,
  );
}

export function applyCurrencyTaxInclusivePreferences<T extends RegionTaxInclusiveSource>(
  regions: T[],
  pricePreferences: TaxInclusivePricePreference[],
): Array<T & { is_tax_inclusive: boolean }> {
  return regions.map((region) => {
    const preference = findCurrencyTaxInclusivePreference(pricePreferences, region.currency_code);

    return {
      ...region,
      is_tax_inclusive: preference?.is_tax_inclusive ?? false,
    };
  });
}
