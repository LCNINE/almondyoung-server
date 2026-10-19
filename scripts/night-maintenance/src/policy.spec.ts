import { assertWriteWindow, emptyApprovedFields, jobWindow, validateReviewManifest } from './policy';

const window = {
  startsAt: '2026-10-16T17:00:00.000Z',
  writesStopAt: '2026-10-16T17:45:00.000Z',
  endsAt: '2026-10-16T17:50:00.000Z',
};

describe('dated maintenance policy', () => {
  it('allows the rescheduled 01:00 KST review run and closes writes at 01:45', () => {
    const reviewWindow = jobWindow('2026-10-20', 'reviews');

    expect(reviewWindow).toEqual({
      startsAt: '2026-10-19T16:00:00.000Z',
      writesStopAt: '2026-10-19T16:45:00.000Z',
      endsAt: '2026-10-19T16:50:00.000Z',
    });

    expect(() => assertWriteWindow(reviewWindow, new Date('2026-10-20T01:00:00+09:00'))).not.toThrow();
    expect(() => assertWriteWindow(reviewWindow, new Date('2026-10-20T01:45:00+09:00'))).toThrow();
  });

  it('keeps product writes within the approved 03:00–05:50 KST window', () => {
    expect(jobWindow('2026-10-20', 'products')).toEqual({
      startsAt: '2026-10-19T18:00:00.000Z',
      writesStopAt: '2026-10-19T20:50:00.000Z',
      endsAt: '2026-10-19T21:00:00.000Z',
    });
  });

  it('allows the intended KST night but rejects daytime, late and subsequent-day invocations', () => {
    expect(() => assertWriteWindow(window, new Date('2026-10-17T02:00:00+09:00'))).not.toThrow();
    for (const value of ['2026-10-16T16:00:00+09:00', '2026-10-17T02:45:00+09:00', '2026-10-18T02:00:00+09:00']) {
      expect(() => assertWriteWindow(window, new Date(value))).toThrow('write window');
    }
  });

  it('rejects an invalid window rather than allowing comparisons with NaN', () => {
    expect(() => assertWriteWindow({ ...window, startsAt: 'invalid' }, new Date())).toThrow();
  });

  it('fills approved empty metadata only and preserves existing or unrecognized values', () => {
    expect(
      emptyApprovedFields({ origin: '한국', usage: ' ' }, { origin: '중국', usage: '① 사용', capacity: '10ml' }),
    ).toEqual({ usage: '① 사용', capacity: '10ml' });
    expect(() => emptyApprovedFields({}, { price: '100' })).toThrow('field');
    expect(() => emptyApprovedFields({}, { origin: '' })).toThrow('empty');
  });

  it('rejects review scope drift, duplicated IDs and non-approved ratings', () => {
    const rows = [
      { id: 'a', productId: 'p', rating: 2 },
      { id: 'b', productId: 'q', rating: 3 },
    ];
    const expected = { count: 2, rating2: 1, rating3: 1, products: 2 };
    expect(() => validateReviewManifest(rows, expected)).not.toThrow();
    expect(() => validateReviewManifest(rows.slice(1), expected)).toThrow();
    expect(() => validateReviewManifest([rows[0], rows[0]], expected)).toThrow();
    expect(() => validateReviewManifest([{ ...rows[0], rating: 5 }, rows[1]], expected)).toThrow();
  });
});
