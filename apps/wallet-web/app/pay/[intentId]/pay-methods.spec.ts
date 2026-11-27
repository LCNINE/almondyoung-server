import { filterExternalMethods, isInstantOnly } from './pay-methods';

const methods = [{ type: 'TOSS' }, { type: 'BANK_TRANSFER' }, { type: 'POINTS' }];
const base = {
  isAvailableInRegion: () => true,
  isMembership: false,
  widgetCoversBankTransfer: false,
  instantOnly: false,
};

describe('filterExternalMethods', () => {
  it('평소엔 포인트만 뺀다', () => {
    expect(filterExternalMethods(methods, base).map((m) => m.type)).toEqual(['TOSS', 'BANK_TRANSFER']);
  });

  it('즉시 결제만이면 무통장을 뺀다', () => {
    expect(filterExternalMethods(methods, { ...base, instantOnly: true }).map((m) => m.type)).toEqual(['TOSS']);
  });

  it('instantOnly 표식은 true 일 때만 켜진다', () => {
    expect(isInstantOnly({ instantOnly: true })).toBe(true);
    expect(isInstantOnly({ instantOnly: 'true' })).toBe(false);
    expect(isInstantOnly(undefined)).toBe(false);
  });
});
