import type { PreparationIncoming } from '@/lib/types/dto/fulfillment';
import {
  arrivalSortKey,
  etaText,
  incomingText,
  needsInfoClosing,
  needsInfoCopy,
  shortageLineText,
} from './blocked-copy';

const TODAY = '2026-01-04';

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
      incomingText(
        {
          onHand: 0,
          reservedByOthers: 0,
          incoming: { ...none.incoming, ordered: 6, inboundShipment: 2 },
          elsewhere: { onHand: 4, ordered: 20, orderedEta: '2026-01-20' },
        },
        TODAY
      )
    ).toBe(
      '이 창고로 올 것: 발주 6개, 선적 2개 · 다른 창고에 4개 — 옮겨 와야 해요 · 다른 창고로 발주 20개(1월 20일 입고 예정)'
    );
    expect(
      incomingText(
        {
          onHand: 0,
          reservedByOthers: 0,
          incoming: none.incoming,
          elsewhere: { onHand: 4, ordered: 0, orderedEta: null },
        },
        TODAY
      )
    ).toBe('이 창고로 올 것은 없어요 · 다른 창고에 4개 — 옮겨 와야 해요');
    expect(
      incomingText(
        {
          onHand: 0,
          reservedByOthers: 0,
          incoming: null,
          elsewhere: null,
        },
        TODAY
      )
    ).toBe('이 창고로 올 것은 입고 화면에서 확인해 주세요');
    // 판매 창고가 여럿이면 이 창고로 올 것만 모르고, 남는 재고·다른 창고 보유는 그대로 보인다
    expect(
      incomingText(
        {
          onHand: 2,
          reservedByOthers: 1,
          incoming: null,
          elsewhere: { onHand: 4, ordered: 0, orderedEta: null },
        },
        TODAY
      )
    ).toBe(
      '이 창고에 남는 재고 1개 — 곧 자동으로 확보돼요 · 이 창고로 올 것은 입고 화면에서 확인해 주세요 · 다른 창고에 4개 — 옮겨 와야 해요'
    );
  });

  it('막 들어와 아직 확보 전인 재고가 있으면 발주·이동을 권하지 않는다', () => {
    expect(
      incomingText({ onHand: 3, reservedByOthers: 1, ...none }, TODAY)
    ).toBe(
      '이 창고에 남는 재고 2개 — 곧 자동으로 확보돼요 · 이 창고로 올 것은 없어요'
    );
    expect(
      incomingText(
        {
          onHand: 3,
          reservedByOthers: 1,
          incoming: { ...none.incoming, ordered: 4 },
          elsewhere: none.elsewhere,
        },
        TODAY
      )
    ).toBe(
      '이 창고에 남는 재고 2개 — 곧 자동으로 확보돼요 · 이 창고로 올 것: 발주 4개'
    );
  });

  it('이 상자가 잡은 몫은 남는 재고로 보지 않는다', () => {
    // 재고 2개를 이 상자가 다 잡았다
    expect(
      incomingText(
        { onHand: 2, reservedByOthers: 0, available: 0, ...none },
        TODAY
      )
    ).toBe('들어올 예정이 없어요 — 발주하거나 다른 창고에서 옮겨 와야 해요');
    expect(
      incomingText(
        { onHand: 5, reservedByOthers: 1, available: 2, ...none },
        TODAY
      )
    ).toBe(
      '이 창고에 남는 재고 2개 — 곧 자동으로 확보돼요 · 이 창고로 올 것은 없어요'
    );
  });

  it('먼저 들어올 순서로 줄 세운다', () => {
    const base = { onHand: 0, reservedByOthers: 0, available: 0, ...none };
    const keys = [
      arrivalSortKey({ ...base, available: 1 }, TODAY),
      arrivalSortKey(
        {
          ...base,
          incoming: {
            ...none.incoming,
            inTransit: 1,
            inTransitEta: '2026-01-20',
            inboundShipment: 1,
            inboundShipmentEta: '2026-01-10',
          },
        },
        TODAY
      ),
      arrivalSortKey(
        {
          ...base,
          incoming: {
            ...none.incoming,
            inTransit: 1,
            inTransitEta: '2026-01-11',
            // 선적 잔량이 없으면 그 예정일은 보지 않는다
            inboundShipmentEta: '2026-01-01',
          },
        },
        TODAY
      ),
      arrivalSortKey(
        { ...base, incoming: { ...none.incoming, ordered: 1 } },
        TODAY
      ),
      arrivalSortKey(
        {
          ...base,
          elsewhere: { ...none.elsewhere, onHand: 1 },
        },
        TODAY
      ),
      arrivalSortKey(base, TODAY),
    ];

    expect([...keys].reverse().sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('이 창고로 바로 오는 발주에도 입고 예정일을 붙이고, 지난 날은 지났다고 쓴다', () => {
    const coming = (orderedEta: string | null | undefined) =>
      incomingText(
        {
          onHand: 0,
          reservedByOthers: 0,
          available: 0,
          incoming: { ...none.incoming, ordered: 6, orderedEta },
          elsewhere: none.elsewhere,
        },
        TODAY
      );

    expect(coming('2026-01-05')).toBe(
      '이 창고로 올 것: 발주 6개(1월 5일 입고 예정)'
    );
    // 오늘은 아직 지나지 않았다
    expect(coming(TODAY)).toBe('이 창고로 올 것: 발주 6개(1월 4일 입고 예정)');
    expect(coming('2026-01-03')).toBe(
      '이 창고로 올 것: 발주 6개(1월 3일 예정이 지났어요)'
    );
    expect(coming('2025-12-31')).toBe(
      '이 창고로 올 것: 발주 6개(12월 31일 예정이 지났어요)'
    );
    expect(coming(null)).toBe('이 창고로 올 것: 발주 6개');
    // 날짜를 싣지 않는 옛 응답
    expect(coming(undefined)).toBe('이 창고로 올 것: 발주 6개');
    expect(
      incomingText(
        {
          onHand: 0,
          reservedByOthers: 0,
          incoming: {
            ...none.incoming,
            inTransit: 1,
            inTransitEta: '2026-01-02',
            inboundShipment: 2,
            inboundShipmentEta: '2026-01-06',
          },
          elsewhere: {
            onHand: 0,
            ordered: 3,
            orderedEta: '2026-01-01',
          },
        },
        TODAY
      )
    ).toBe(
      '이 창고로 올 것: 이동 중 1개(1월 2일 예정이 지났어요), 선적 2개(1월 6일 도착 예정) · 다른 창고로 발주 3개(1월 1일 예정이 지났어요)'
    );
  });

  it('남는 재고와 이 창고로 올 것이 기다리는 수량보다 적으면 모자란 만큼 알린다', () => {
    const text = (
      waiting: number | undefined,
      stock: { available?: number; ordered?: number; away?: number } = {}
    ) =>
      incomingText(
        {
          onHand: 0,
          reservedByOthers: 0,
          available: stock.available ?? 0,
          waiting,
          incoming: { ...none.incoming, ordered: stock.ordered ?? 0 },
          elsewhere: { ...none.elsewhere, onHand: stock.away ?? 0 },
        },
        TODAY
      );

    expect(text(9, { ordered: 6 })).toBe(
      '이 창고로 올 것: 발주 6개 · 모두 9개 기다려 3개 모자라요'
    );
    expect(text(6, { ordered: 6 })).toBe('이 창고로 올 것: 발주 6개');
    expect(text(9, { available: 2, ordered: 6 })).toBe(
      '이 창고에 남는 재고 2개 — 곧 자동으로 확보돼요 · 이 창고로 올 것: 발주 6개 · 모두 9개 기다려 1개 모자라요'
    );
    expect(text(9, { available: 2 })).toBe(
      '이 창고에 남는 재고 2개 — 곧 자동으로 확보돼요 · 이 창고로 올 것은 없어요 · 모두 9개 기다려 7개 모자라요'
    );
    // 다른 창고에 있는 것은 옮겨 와야 오므로 모자란 수량을 줄이지 않는다
    expect(text(9, { ordered: 6, away: 50 })).toBe(
      '이 창고로 올 것: 발주 6개 · 모두 9개 기다려 3개 모자라요 · 다른 창고에 50개 — 옮겨 와야 해요'
    );
    expect(text(9, { away: 50 })).toBe(
      '이 창고로 올 것은 없어요 · 기다리는 9개가 모두 모자라요 · 다른 창고에 50개 — 옮겨 와야 해요'
    );
    expect(text(9)).toBe(
      '들어올 예정이 없어요 — 기다리는 9개만큼 발주하거나 다른 창고에서 옮겨 와야 해요'
    );
    // 기다리는 수량을 싣지 않는 옛 응답
    expect(text(undefined, { ordered: 1 })).toBe('이 창고로 올 것: 발주 1개');
    expect(text(undefined)).toBe(
      '들어올 예정이 없어요 — 발주하거나 다른 창고에서 옮겨 와야 해요'
    );
  });

  it('이 창고로 올 것을 모르면 모자란 수량을 말하지 않는다', () => {
    expect(
      incomingText(
        {
          onHand: 0,
          reservedByOthers: 0,
          available: 0,
          waiting: 9,
          incoming: null,
          elsewhere: none.elsewhere,
        },
        TODAY
      )
    ).toBe('이 창고로 올 것은 입고 화면에서 확인해 주세요');
  });

  it('바로 오는 발주의 예정일도 순서에 쓰고, 지난 예정일은 날짜를 모르는 것과 같이 둔다', () => {
    const key = (incoming: Partial<PreparationIncoming>) =>
      arrivalSortKey(
        {
          onHand: 0,
          reservedByOthers: 0,
          available: 0,
          incoming: { ...none.incoming, ...incoming },
          elsewhere: none.elsewhere,
        },
        TODAY
      );

    expect(key({ ordered: 1, orderedEta: '2026-01-05' })).toBe(
      key({ inTransit: 1, inTransitEta: '2026-01-05' })
    );
    expect(
      key({ ordered: 1, orderedEta: TODAY }) <
        key({ ordered: 1, orderedEta: '2026-01-05' })
    ).toBe(true);
    expect(key({ ordered: 1, orderedEta: '2026-01-03' })).toBe(
      key({ ordered: 1 })
    );
    // 잔량이 없는 발주의 예정일은 보지 않는다
    expect(
      key({
        inTransit: 1,
        inTransitEta: '2026-01-09',
        orderedEta: '2026-01-05',
      })
    ).toBe(key({ inTransit: 1, inTransitEta: '2026-01-09' }));
    // 이동이 늦어졌어도 앞날의 발주가 있으면 그 날로 줄 세운다
    expect(
      key({
        inTransit: 1,
        inTransitEta: '2026-01-01',
        ordered: 1,
        orderedEta: '2026-01-07',
      })
    ).toBe(key({ ordered: 1, orderedEta: '2026-01-07' }));
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
