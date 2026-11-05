export const NAME_WHITESPACE = '[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+';

export function normalizeMatchingName(name: string): string {
  return name.toLowerCase().replace(new RegExp(NAME_WHITESPACE, 'g'), ' ').trim();
}

export function matchingNameKey(productName: string, optionName: string | null): string {
  const option = (optionName ?? '').trim();
  const noOption = !option || option === '단일상품' || option === '단일옵션' || /^(P0|PN)[0-9A-Z]+$/.test(option);

  return normalizeMatchingName(noOption ? productName : `${productName} ${option}`);
}

export interface NameMatchCandidate {
  matchingId: string;
  productName: string;
  optionName: string;
  skuId: string;
  skuName: string;
  waitingOrder: boolean;
}
