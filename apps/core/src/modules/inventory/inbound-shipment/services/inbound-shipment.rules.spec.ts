import { BadRequestError } from '@app/shared';
import {
  confirmBlockers,
  deriveShipmentStatus,
  lineDifference,
  lineEditable,
  normalizeSingleBoxLabel,
} from './inbound-shipment.rules';

const box = (id: string, disposition: 'stock' | 'forward' = 'stock', origin: 'list' | 'added' = 'list') => ({
  id,
  disposition,
  origin,
});

describe('confirmBlockers', () => {
  it('unresolved line on a stock box blocks confirm', () => {
    expect(confirmBlockers([box('b1')], [{ id: 'l1', kind: 'unresolved', boxIds: ['b1'] }])).toEqual([
      { code: 'unresolved_line', lineId: 'l1' },
    ]);
  });

  it('unresolved line only on forward boxes does not block', () => {
    expect(confirmBlockers([box('b1', 'forward')], [{ id: 'l1', kind: 'unresolved', boxIds: ['b1'] }])).toEqual([]);
  });

  it('line covering stock and forward boxes blocks', () => {
    expect(
      confirmBlockers([box('b1'), box('b2', 'forward')], [{ id: 'l1', kind: 'sku', boxIds: ['b1', 'b2'] }]),
    ).toEqual([{ code: 'mixed_disposition', lineId: 'l1' }]);
  });

  it('unresolved line covering stock and forward boxes yields both blockers', () => {
    expect(
      confirmBlockers([box('b1'), box('b2', 'forward')], [{ id: 'l1', kind: 'unresolved', boxIds: ['b1', 'b2'] }]),
    ).toEqual([
      { code: 'unresolved_line', lineId: 'l1' },
      { code: 'mixed_disposition', lineId: 'l1' },
    ]);
  });

  it('list box without lines blocks, added box does not', () => {
    expect(confirmBlockers([box('b1', 'stock', 'list'), box('b2', 'stock', 'added')], [])).toEqual([
      { code: 'empty_box', boxId: 'b1' },
    ]);
  });
});

describe('lineEditable', () => {
  it('draft is always editable', () => expect(lineEditable('draft', [])).toBe(true));
  it('expected with only open boxes is editable', () => expect(lineEditable('expected', ['open', 'open'])).toBe(true));
  it('receiving with a received box is not', () => expect(lineEditable('receiving', ['open', 'received'])).toBe(false));
  it('closed is not', () => expect(lineEditable('closed', ['open'])).toBe(false));
});

describe('deriveShipmentStatus', () => {
  const b = (disposition: 'stock' | 'forward', status: 'open' | 'received') => ({ disposition, status });

  it('one received stock box of two makes it receiving', () =>
    expect(deriveShipmentStatus('expected', [b('stock', 'received'), b('stock', 'open')], false)).toBe('receiving'));
  it('every stock box received closes it even with an open forward box', () =>
    expect(deriveShipmentStatus('receiving', [b('stock', 'received'), b('forward', 'open')], false)).toBe('closed'));
  it('no received stock box is expected', () =>
    expect(deriveShipmentStatus('receiving', [b('stock', 'open'), b('forward', 'open')], false)).toBe('expected'));
  it('manually closed stays closed with open boxes', () =>
    expect(deriveShipmentStatus('closed', [b('stock', 'open'), b('stock', 'received')], true)).toBe('closed'));
  it('only forward boxes never closes by itself', () =>
    expect(deriveShipmentStatus('expected', [b('forward', 'open')], false)).toBe('expected'));
  it('draft and canceled are not derived', () => {
    expect(deriveShipmentStatus('draft', [b('stock', 'received')], false)).toBe('draft');
    expect(deriveShipmentStatus('canceled', [b('stock', 'received')], true)).toBe('canceled');
  });
});

describe('normalizeSingleBoxLabel', () => {
  it('normalizes a single label', () => expect(normalizeSingleBoxLabel(' l5 ')).toBe('L5'));
  it('refuses ranges and guesses', () => {
    expect(() => normalizeSingleBoxLabel('L5-L9')).toThrow(BadRequestError);
    expect(() => normalizeSingleBoxLabel('L86-')).toThrow(BadRequestError);
    expect(() => normalizeSingleBoxLabel('')).toThrow(BadRequestError);
  });
});

describe('lineDifference', () => {
  it('range line difference is pending until every covered box is received', () => {
    const four = [200, 200, 200, 200];
    expect(lineDifference(1076, four, ['received', 'received', 'received', 'received', 'open'])).toEqual({
      state: 'pending',
      counted: 800,
      expected: 1076,
    });
    expect(lineDifference(1076, [...four, 276], ['received', 'received', 'received', 'received', 'received'])).toEqual({
      state: 'match',
      counted: 1076,
      expected: 1076,
    });
    expect(lineDifference(1076, [...four, 276], ['received', 'received', 'received', 'received', 'open'])).toEqual({
      state: 'pending',
      counted: 1076,
      expected: 1076,
    });
  });

  it('short and over', () => {
    expect(lineDifference(10, [8], ['received'])).toEqual({ state: 'short', counted: 8, expected: 10 });
    expect(lineDifference(10, [12], ['received'])).toEqual({ state: 'over', counted: 12, expected: 10 });
  });

  it('no expected quantity is always pending', () =>
    expect(lineDifference(null, [3], ['received'])).toEqual({ state: 'pending', counted: 3, expected: null }));

  it('a line with no covering box is never judged', () =>
    expect(lineDifference(5, [], [])).toEqual({ state: 'pending', counted: 0, expected: 5 }));
});
