import { withSkuFacts } from './inbound-putaway.reader';

const base = {
  source: 'direct' as const,
  canPutaway: true,
  putawayBlockReason: null,
  skuName: '무선마우스 블랙',
  skuCode: 'MOUSE-BK-01',
  pendingQty: 20,
  originLocationId: 'loc-origin',
  originLocationCode: 'zone-inbound-default',
  receivedAt: '2026-07-26T00:14:00.000Z',
};

describe('withSkuFacts', () => {
  it('줄마다 그 SKU 의 사진과 이 창고 평소 선반 코드를 붙인다', () => {
    const items = withSkuFacts(
      [
        { ...base, lineId: 'l-1', skuId: 's-1' },
        { ...base, lineId: 'l-2', skuId: 's-1' },
        { ...base, lineId: 'l-3', skuId: 's-2' },
      ],
      new Map([
        ['s-1', ['f-primary', 'f-2']],
        ['s-2', []],
      ]),
      new Map([
        ['s-1', { usualLocationId: 'loc-a', usualLocationCode: 'A-01-01', canRememberUsual: false }],
        ['s-2', { usualLocationId: null, usualLocationCode: null, canRememberUsual: true }],
      ]),
    );

    expect(
      items.map(({ lineId, imageFileIds, usualLocationCode }) => ({ lineId, imageFileIds, usualLocationCode })),
    ).toEqual([
      { lineId: 'l-1', imageFileIds: ['f-primary', 'f-2'], usualLocationCode: 'A-01-01' },
      { lineId: 'l-2', imageFileIds: ['f-primary', 'f-2'], usualLocationCode: 'A-01-01' },
      { lineId: 'l-3', imageFileIds: [], usualLocationCode: null },
    ]);
    expect(items[0]).toMatchObject({ ...base, skuId: 's-1' });
  });

  it('사진·평소 선반 조회에 없는 SKU 는 빈 사진과 평소 선반 없음으로 둔다', () => {
    const [item] = withSkuFacts([{ ...base, lineId: 'l-9', skuId: 's-9' }], new Map(), new Map());

    expect(item.imageFileIds).toEqual([]);
    expect(item.usualLocationCode).toBeNull();
  });
});
