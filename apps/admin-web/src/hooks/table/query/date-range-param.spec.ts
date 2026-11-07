import { parseDateRangeParam, toDayBoundInstants } from './date-range-param';

describe('parseDateRangeParam', () => {
  it('returns empty object for undefined/empty input', () => {
    expect(parseDateRangeParam(undefined)).toEqual({});
    expect(parseDateRangeParam('')).toEqual({});
  });

  it('extracts $gte/$lte into from/to', () => {
    const raw = JSON.stringify({
      $gte: '2026-01-01T00:00:00.000Z',
      $lte: '2026-01-31T00:00:00.000Z',
    });
    expect(parseDateRangeParam(raw)).toEqual({
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-31T00:00:00.000Z',
    });
  });

  it('tolerates a partial range', () => {
    expect(
      parseDateRangeParam(JSON.stringify({ $gte: '2026-01-01T00:00:00.000Z' }))
    ).toEqual({
      from: '2026-01-01T00:00:00.000Z',
      to: undefined,
    });
  });

  it('returns empty object on malformed JSON', () => {
    expect(parseDateRangeParam('not-json')).toEqual({});
  });
});

describe('toDayBoundInstants', () => {
  it('turns a date-only range into the whole KST days — 「오늘」 is the full day, not an empty instant', () => {
    expect(toDayBoundInstants({ from: '2026-11-03', to: '2026-11-03' })).toEqual({
      from: '2026-11-03T00:00:00.000+09:00',
      to: '2026-11-03T23:59:59.999+09:00',
    });
  });

  it('covers a product created at 04:06 KST (19:06 UTC the day before)', () => {
    const { from, to } = toDayBoundInstants({ from: '2026-11-03', to: '2026-11-03' });
    const created = new Date('2026-11-02T19:06:00.000Z');
    expect(created >= new Date(from!) && created <= new Date(to!)).toBe(true);
  });

  it('leaves instants and missing ends untouched', () => {
    expect(toDayBoundInstants({ from: '2026-01-01T00:00:00.000Z', to: undefined })).toEqual({
      from: '2026-01-01T00:00:00.000Z',
      to: undefined,
    });
  });
});
