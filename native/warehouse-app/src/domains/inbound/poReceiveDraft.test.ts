import { expect, it } from 'vitest';
import {
  normalizePoReceiveDraft,
  scanReceiptQuantity,
  type PoReceiveDraft,
} from './poReceiveDraft';

it.each([
  ['10', 'manual', 1, '11'],
  ['12', 'suggested', 1, '1'],
  ['10', 'manual', 20, '30'],
  ['3', 'scanned', 1, '4'],
  ['0', 'manual', 1, '1'],
  ['2147483646', 'manual', 1, '2147483647'],
] as const)('adds %s (%s) + %i as %s', (text, source, step, expected) => {
  expect(scanReceiptQuantity({ text, source }, step)).toEqual({
    text: expected,
    source: 'scanned',
  });
});
it.each(['', ' ', '-1', '1.5', 'abc', '2147483648'])(
  'preserves invalid input %j by refusing the scan',
  (text) => {
    const quantity = { text, source: 'manual' as const };
    expect(() => scanReceiptQuantity(quantity, 1)).toThrow();
    expect(quantity.text).toBe(text);
  }
);
it.each([0, -1, 1.5, NaN, Infinity, 2147483648])(
  'rejects invalid scan increment %s',
  (step) => {
    expect(() =>
      scanReceiptQuantity({ text: '1', source: 'manual' }, step)
    ).toThrow();
  }
);
it('refuses integer overflow without losing the current quantity', () => {
  expect(() =>
    scanReceiptQuantity({ text: '2147483647', source: 'scanned' }, 1)
  ).toThrow();
});
const active = {
  skuId: 'a',
  skuCode: 'A',
  skuName: 'A',
  orderedQty: 12,
  receivedQty: 0,
  outstandingQty: 12,
  expectedArrival: null,
};
const legacy: PoReceiveDraft = {
  active,
  scanBump: 3,
  seen: ['first'],
  fresh: null,
  submitted: { target: active, quantity: 3, key: 'original-key' },
};
it('restores the legacy scan count and preserves the submitted key and seen IDs', () => {
  expect(normalizePoReceiveDraft(legacy)).toEqual({
    ...legacy,
    quantity: { text: '3', source: 'scanned' },
  });
});
it('restores an unscanned active draft as a suggestion', () => {
  expect(normalizePoReceiveDraft({ ...legacy, scanBump: 0 }).quantity).toEqual({
    text: '12',
    source: 'suggested',
  });
});
it('preserves saved manual text, including empty input, over legacy scan counts', () => {
  expect(
    normalizePoReceiveDraft({
      ...legacy,
      quantity: { text: '', source: 'manual' },
    }).quantity
  ).toEqual({ text: '', source: 'manual' });
});
it('leaves an inactive draft without a suggested quantity and preserves fresh receipt data', () => {
  const fresh = {
    lineId: 'receipt',
    skuId: 'a',
    skuName: 'A',
    skuCode: 'A',
    quantity: 3,
    putawayDoneQty: 1,
  };
  expect(normalizePoReceiveDraft({ ...legacy, active: null, fresh })).toEqual({
    ...legacy,
    active: null,
    fresh,
    quantity: null,
  });
});
