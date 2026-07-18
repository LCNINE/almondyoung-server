import { parseDateRangeParam } from './date-range-param';

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
