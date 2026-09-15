import { expect, it } from 'vitest';
import { validatePutawaySearch } from './putawaySearch';
it('normalizes explicit route filters and never silently widens invalid links', () => {
  expect(
    validatePutawaySearch({
      skuId: '  ABCDEF01-0000-4000-8000-000000000001 ',
      originLocationId: 'abcdef01-0000-4000-8000-000000000002',
    })
  ).toEqual({
    skuId: 'abcdef01-0000-4000-8000-000000000001',
    originLocationId: 'abcdef01-0000-4000-8000-000000000002',
  });
  expect(validatePutawaySearch({})).toEqual({});
  for (const value of [
    '',
    'invalid',
    ['abcdef01-0000-4000-8000-000000000001'],
    1,
  ])
    expect(() => validatePutawaySearch({ skuId: value })).toThrow('적치 링크');
});
