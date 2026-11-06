/** @jest-environment jsdom */
import {
  COMBO_LIMIT,
  applyTimes,
  blockers,
  combos,
  defaultAwk,
  draftKey,
  gridSize,
  quoteBatches,
  quoteId,
  quoteSignature,
  loadDraft,
  memberPriceFor,
  parseTemplateSize,
  priceFor,
  qtyAllowed,
  saveDraft,
  type PublishDraft,
  type PublishRow,
} from './publish-model';

const row = (over: Partial<PublishRow>): PublishRow => ({
  key: 'k1',
  cost: 3100,
  price: 7800,
  memberPrice: null,
  on: true,
  ...over,
});

describe('priceFor', () => {
  it('rounds cost times the multiplier up to 100 won', () => {
    expect(priceFor(3100, 2.5)).toBe(7800);
    expect(priceFor(3100, 2)).toBe(6200);
  });

  it('does not round up a float error past an exact hundred', () => {
    expect(priceFor(1000, 1.1)).toBe(1100);
  });
});

describe('memberPriceFor', () => {
  it('discounts then rounds down to 100 won', () => {
    expect(memberPriceFor(7800, 10)).toBe(7000);
    expect(memberPriceFor(7800, 5)).toBe(7400);
  });

  it('keeps the price without a discount', () => {
    expect(memberPriceFor(7800, 0)).toBe(7800);
  });
});

describe('applyTimes', () => {
  it('fills every priced cost and keeps the edited ones', () => {
    const next = applyTimes({ a: 5000, b: 9999 }, new Set(['b']), { a: 3100, b: 4100, c: 5400 }, 2.5);

    expect(next).toEqual({ a: 7800, b: 9999, c: 13500 });
  });
});

describe('combos', () => {
  it('crosses the picked axes and carries the required post-processing', () => {
    const list = combos({ papers: [1, 2], colors: [10], qtys: [500, 1000] }, [77]);

    expect(list.map((c) => c.key)).toEqual(['1-10-500', '1-10-1000', '2-10-500', '2-10-1000']);
    expect(list[0]).toEqual({ key: '1-10-500', paperno: 1, colorno: 10, qty: 500, awk: [77] });
  });

  it('drops a quantity the paper and color do not allow', () => {
    const quantities = [
      { key: 'paperno:1', values: [500] },
      { key: 'paperno:2', values: [500, 1000] },
    ];
    const list = combos({ papers: [1, 2], colors: [10], qtys: [500, 1000] }, [], (p, c, q) => qtyAllowed(quantities, p, c, q));

    expect(list.map((c) => c.key)).toEqual(['1-10-500', '2-10-500', '2-10-1000']);
  });
});

describe('qtyAllowed', () => {
  it('reads the all list and the condition lists', () => {
    expect(qtyAllowed([{ key: 'all', values: [100] }], 1, 2, 100)).toBe(true);
    expect(qtyAllowed([{ key: 'all', values: [100] }], 1, 2, 200)).toBe(false);
    expect(qtyAllowed([{ key: 'paperno:1|colorno:2', values: [200] }], 1, 2, 200)).toBe(true);
    expect(qtyAllowed([{ key: 'paperno:1|colorno:2', values: [200] }], 1, 3, 200)).toBe(false);
    expect(qtyAllowed([], 1, 2, 200)).toBe(true);
  });
});

describe('defaultAwk', () => {
  it('takes the default of each required group and skips a forbidden one', () => {
    const awk = defaultAwk(
      [
        { group: '코팅', options: [{ jobno: 1, label: '무광' }, { jobno: 2, label: '유광' }], defaultJobno: 1 },
        { group: '아일렛', options: [{ jobno: 3, label: '4개' }, { jobno: 4, label: '없음' }], defaultJobno: 3 },
      ],
      [{ jobno: 3, reason: '크기 밖' }],
    );

    expect(awk).toEqual([1, 4]);
  });
});

describe('blockers', () => {
  it('lets a clean grid publish', () => {
    expect(blockers([row({})], true)).toEqual([]);
  });

  it('blocks a combo whose quote failed', () => {
    expect(blockers([row({ cost: null })], true)).toEqual([expect.stringContaining('견적')]);
  });

  it('blocks a price at or under cost', () => {
    expect(blockers([row({ price: 3100 })], true)).toEqual([expect.stringContaining('판매가가 원가')]);
  });

  it('blocks a membership price at or under cost', () => {
    expect(blockers([row({ memberPrice: 3000 })], true)).toEqual([expect.stringContaining('멤버십가가 원가')]);
  });

  it('blocks a bleed mismatch', () => {
    expect(blockers([row({})], false)).toEqual([expect.stringContaining('재단 여유')]);
  });

  it('blocks when no combo is on', () => {
    expect(blockers([row({ on: false })], true)).toEqual([expect.stringContaining('판매할 조합')]);
  });

  it('ignores combos that are off', () => {
    expect(blockers([row({}), row({ key: 'k2', cost: null, on: false })], true)).toEqual([]);
  });

  it('blocks more combos than the core accepts', () => {
    const rows = Array.from({ length: COMBO_LIMIT + 1 }, (_, i) => row({ key: `k${i}` }));

    expect(blockers(rows, true)).toEqual([expect.stringContaining(`${COMBO_LIMIT}개`)]);
  });
});

describe('price integrity', () => {
  it('blocks a price the core rejects as not a positive integer', () => {
    expect(blockers([row({ price: 7800.5 })], true)).toEqual([expect.stringContaining('정수')]);
    expect(blockers([row({ memberPrice: 7000.5 })], true)).toEqual([expect.stringContaining('정수')]);
  });
});

describe('grid size', () => {
  const labels = (i: number) => ({ paper: `p${i}`, side: '양면', qty: `${i}매` });

  it('multiplies the distinct labels of each axis like the core', () => {
    expect(gridSize([labels(1), labels(2)])).toBe(4);
    expect(gridSize([])).toBe(0);
  });

  it('blocks a grid over the cap even with few rows', () => {
    const rows = Array.from({ length: 15 }, (_, i) => row({ key: `k${i}`, labels: labels(i) }));

    expect(blockers(rows, true)).toEqual([expect.stringContaining(`${COMBO_LIMIT}개`)]);
  });
});

describe('quoteId', () => {
  it('changes when the post-processing changes', () => {
    const combo = { key: '1-2-500', paperno: 1, colorno: 2, qty: 500, awk: [7] };
    const size = { width: 90, height: 50 };

    expect(quoteId(combo, size)).not.toBe(quoteId({ ...combo, awk: [8] }, size));
  });
});

describe('quote requests', () => {
  const size = { width: 90, height: 50 };
  const make = (i: number, awk: number[] = [7]) => ({ key: `k${i}`, paperno: i, colorno: 1, qty: 500, awk });

  it('changes the signature when only the post-processing changes', () => {
    expect(quoteSignature([make(1)], [], size)).not.toBe(quoteSignature([make(1, [8])], [], size));
  });

  it('leaves combos that are off out of the signature and the request', () => {
    expect(quoteSignature([make(1), make(2)], ['k2'], size)).toBe(quoteSignature([make(1)], [], size));
    expect(quoteBatches([make(1), make(2)], ['k2'], size, new Set()).flat().map((c) => c.key)).toEqual(['k1']);
  });

  it('skips combos already requested with the same input', () => {
    const requested = new Set([quoteId(make(1), size)]);

    expect(quoteBatches([make(1), make(2)], [], size, requested).flat().map((c) => c.key)).toEqual(['k2']);
    expect(quoteBatches([make(1, [8])], [], size, requested).flat().map((c) => c.key)).toEqual(['k1']);
  });

  it('splits a request into batches the core accepts', () => {
    const list = Array.from({ length: COMBO_LIMIT * 2 + 1 }, (_, i) => make(i));

    expect(quoteBatches(list, [], size, new Set()).map((b) => b.length)).toEqual([COMBO_LIMIT, COMBO_LIMIT, 1]);
  });
});

describe('parseTemplateSize', () => {
  it('reads widthxheight', () => {
    expect(parseTemplateSize('90x50')).toEqual({ width: 90, height: 50 });
    expect(parseTemplateSize('oops')).toEqual({ width: 0, height: 0 });
  });
});

describe('draft storage', () => {
  const draft: PublishDraft = {
    step: 2,
    name: '명함',
    description: '설명',
    picked: { papers: [1], colors: [2], qtys: [500] },
    times: 2.5,
    discountPct: 10,
    edited: { '1-2-500': 9000 },
    off: ['1-2-1000'],
  };

  beforeEach(() => window.localStorage.clear());

  it('round-trips under the template key', () => {
    saveDraft('t1', draft);

    expect(window.localStorage.getItem(draftKey('t1'))).not.toBeNull();
    expect(draftKey('t1')).toBe('almond-publish-draft:t1');
    expect(loadDraft('t1')).toEqual(draft);
  });

  it('drops restored prices the core would reject', () => {
    window.localStorage.setItem(
      draftKey('t1'),
      JSON.stringify({ ...draft, edited: { a: 7800.5, b: 0, c: -100, d: '9000', e: 9000 } }),
    );

    expect(loadDraft('t1')?.edited).toEqual({ e: 9000 });
  });

  it('ignores a broken draft', () => {
    window.localStorage.setItem(draftKey('t1'), '{"step":9');

    expect(loadDraft('t1')).toBeNull();
  });
});
