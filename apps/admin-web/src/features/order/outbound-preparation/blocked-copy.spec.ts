import {
  arrivalSortKey,
  etaText,
  incomingText,
  needsInfoClosing,
  needsInfoCopy,
  shortageLineText,
} from './blocked-copy';

const none = {
  incoming: {
    inTransit: 0,
    inTransitEta: null,
    ordered: 0,
    inboundShipment: 0,
    inboundShipmentEta: null,
  },
  elsewhere: { onHand: 0, ordered: 0, orderedEta: null },
};

describe('blocked-copy', () => {
  it('예정일은 달력일 그대로 읽는다', () => {
    expect(etaText('2026-01-31')).toBe('1월 31일');
    expect(etaText(null)).toBeNull();
  });

  it('다른 주문 몫은 재고를 넘지 않게 보인다', () => {
    expect(
      shortageLineText({
        qty: 3,
        reservedQty: 0,
        stock: { onHand: 1, reservedByOthers: 4, ...none },
      })
    ).toBe('주문 3 · 이 창고 재고 1 (다른 주문 몫 1) · 모자람 3');
    expect(
      shortageLineText({
        qty: 3,
        reservedQty: 0,
        stock: { onHand: 0, reservedByOthers: 0, ...none },
      })
    ).toBe('주문 3 · 이 창고 재고 0 · 모자람 3');
  });

  it('이 창고로 올 것과 다른 창고에 있는 것을 나눠 쓰고, 모르면 입고 화면으로 보낸다', () => {
    expect(
      incomingText({
        onHand: 0,
        reservedByOthers: 0,
        incoming: { ...none.incoming, ordered: 6, inboundShipment: 2 },
        elsewhere: { onHand: 4, ordered: 20, orderedEta: '2026-01-20' },
      })
    ).toBe(
      '이 창고로 올 것: 발주 6개, 선적 2개 · 다른 창고에 4개 — 옮겨 와야 해요 · 다른 창고로 발주 20개(1월 20일 입고 예정)'
    );
    expect(
      incomingText({
        onHand: 0,
        reservedByOthers: 0,
        incoming: none.incoming,
        elsewhere: { onHand: 4, ordered: 0, orderedEta: null },
      })
    ).toBe('이 창고로 올 것은 없어요 · 다른 창고에 4개 — 옮겨 와야 해요');
    expect(
      incomingText({
        onHand: 0,
        reservedByOthers: 0,
        incoming: null,
        elsewhere: null,
      })
    ).toBe('이 창고로 올 것은 입고 화면에서 확인해 주세요');
    // 판매 창고가 여럿이면 이 창고로 올 것만 모르고, 남는 재고·다른 창고 보유는 그대로 보인다
    expect(
      incomingText({
        onHand: 2,
        reservedByOthers: 1,
        incoming: null,
        elsewhere: { onHand: 4, ordered: 0, orderedEta: null },
      })
    ).toBe(
      '이 창고에 남는 재고 1개 — 곧 자동으로 확보돼요 · 이 창고로 올 것은 입고 화면에서 확인해 주세요 · 다른 창고에 4개 — 옮겨 와야 해요'
    );
  });

  it('막 들어와 아직 확보 전인 재고가 있으면 발주·이동을 권하지 않는다', () => {
    expect(incomingText({ onHand: 3, reservedByOthers: 1, ...none })).toBe(
      '이 창고에 남는 재고 2개 — 곧 자동으로 확보돼요 · 이 창고로 올 것은 없어요'
    );
    expect(
      incomingText({
        onHand: 3,
        reservedByOthers: 1,
        incoming: { ...none.incoming, ordered: 4 },
        elsewhere: none.elsewhere,
      })
    ).toBe(
      '이 창고에 남는 재고 2개 — 곧 자동으로 확보돼요 · 이 창고로 올 것: 발주 4개'
    );
  });

  it('이 상자가 잡은 몫은 남는 재고로 보지 않는다', () => {
    // 재고 2개를 이 상자가 다 잡았다
    expect(
      incomingText({ onHand: 2, reservedByOthers: 0, available: 0, ...none })
    ).toBe('들어올 예정이 없어요 — 발주하거나 다른 창고에서 옮겨 와야 해요');
    expect(
      incomingText({ onHand: 5, reservedByOthers: 1, available: 2, ...none })
    ).toBe(
      '이 창고에 남는 재고 2개 — 곧 자동으로 확보돼요 · 이 창고로 올 것은 없어요'
    );
  });

  it('먼저 들어올 순서로 줄 세운다', () => {
    const base = { onHand: 0, reservedByOthers: 0, available: 0, ...none };
    const keys = [
      arrivalSortKey({ ...base, available: 1 }),
      arrivalSortKey({
        ...base,
        incoming: {
          ...none.incoming,
          inTransit: 1,
          inTransitEta: '2026-01-20',
          inboundShipment: 1,
          inboundShipmentEta: '2026-01-10',
        },
      }),
      arrivalSortKey({
        ...base,
        incoming: {
          ...none.incoming,
          inTransit: 1,
          inTransitEta: '2026-01-11',
          // 선적 잔량이 없으면 그 예정일은 보지 않는다
          inboundShipmentEta: '2026-01-01',
        },
      }),
      arrivalSortKey({ ...base, incoming: { ...none.incoming, ordered: 1 } }),
      arrivalSortKey({
        ...base,
        elsewhere: { ...none.elsewhere, onHand: 1 },
      }),
      arrivalSortKey(base),
    ];

    expect([...keys].reverse().sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('고칠 곳이 모두 화면에 있을 때만 다 고치면 빠진다고 알린다', () => {
    const recipient = {
      kind: 'recipient_incomplete' as const,
      fields: ['phone'],
    };
    const channel = {
      kind: 'channel_item_unknown' as const,
      skus: [{ name: '상품 A', code: 'A' }],
    };

    expect(needsInfoClosing([recipient])).toBe(
      '고치면 이 상자는 정보 부족에서 빠져요'
    );
    expect(
      needsInfoClosing([
        { kind: 'shipping_profile_missing', skus: [] },
        recipient,
      ])
    ).toBe('모두 고치면 이 상자는 정보 부족에서 빠져요');
    expect(needsInfoClosing([recipient, channel])).toBeNull();
  });

  it('배송 프로필이 다르면 상품마다 프로필 이름을 붙이고, 목록은 버튼 이름 없이, 상세는 «분할»을 가리킨다', () => {
    const issue = {
      kind: 'shipping_profile_mixed' as const,
      skus: [
        { name: '상품 A', code: 'A', profileName: '일반' },
        { name: '상품 B', code: 'B', profileName: '냉장' },
      ],
    };

    expect(needsInfoCopy(issue).skus.map((sku) => sku.label)).toEqual([
      '상품 A «일반»',
      '상품 B «냉장»',
    ]);
    expect(needsInfoCopy(issue).fix).toBe(
      'SKU 의 배송 프로필을 같게 맞추거나, 상자를 배송 프로필별로 나눠 주세요'
    );
    expect(needsInfoCopy(issue, 'detail').fix).toBe(
      'SKU 의 배송 프로필을 같게 맞추거나, «분할»로 상자를 나눠 주세요'
    );
  });

  it('쇼핑몰 품목 번호 문제는 고칠 화면이 없어 링크 없이 담당자에게 알리게 한다', () => {
    const copy = needsInfoCopy({
      kind: 'channel_item_unknown',
      skus: [{ name: '상품 A', code: 'A' }],
    });

    expect(copy.skus).toEqual([{ label: '상품 A', href: null }]);
    expect(copy.fix).toContain('담당자에게 알려 주세요');
  });
});
