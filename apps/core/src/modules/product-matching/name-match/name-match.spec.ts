import { matchingNameKey, normalizeMatchingName } from './name-match';

describe('exact name matching', () => {
  it('normalizes case and whitespace only', () => {
    expect(normalizeMatchingName('  BAG\t Blue\n Large\u00a0')).toBe('bag blue large');
    expect(normalizeMatchingName('가방 / Blue-1')).toBe('가방 / blue-1');
    expect(normalizeMatchingName('가방/Blue-1')).not.toBe(normalizeMatchingName('가방 / Blue-1'));
  });

  it.each([null, '', '  ', '단일상품', ' 단일옵션 ', 'P012ABC', 'PN123AZ'])(
    'ignores placeholder option %s',
    (option) => {
      expect(matchingNameKey('  BAG  ', option)).toBe('bag');
    },
  );

  it.each(['Blue Large', 'P0', 'PN', 'PN-123', 'pn123', 'P012_ABC'])('keeps real option %s', (option) => {
    expect(matchingNameKey('BAG', option)).toBe(`bag ${option.toLowerCase()}`);
  });
});
