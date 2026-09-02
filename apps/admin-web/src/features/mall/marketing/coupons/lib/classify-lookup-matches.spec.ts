import { classifyLookupMatches } from './classify-lookup-matches';

describe('classifyLookupMatches', () => {
  it('0건이면 not_found 다', () => {
    expect(classifyLookupMatches([])).toEqual({ kind: 'not_found' });
  });

  it('1건이면 그 값을 담아 resolved 다', () => {
    const match = { id: 'u1' };
    expect(classifyLookupMatches([match])).toEqual({ kind: 'resolved', match });
  });

  it('2건이면 ambiguous 다', () => {
    expect(classifyLookupMatches([{ id: 'u1' }, { id: 'u2' }])).toEqual({ kind: 'ambiguous' });
  });

  it('3건 이상이어도 ambiguous 다 — 몇 건인지는 판정에 영향 없다', () => {
    expect(
      classifyLookupMatches([{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }]),
    ).toEqual({ kind: 'ambiguous' });
  });
});
