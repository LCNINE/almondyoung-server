import { confirmBlockers, deriveShipmentStatus, lineEditable } from './inbound-shipment.rules';

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
