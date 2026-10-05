import { diffChannelSnapshot, isDecrease, removesAllLines, toShippingAddress } from './channel-order-diff';
import type { ChannelOrderSnapshot, EffectiveSalesOrder } from './channel-order-change.types';

const ADDRESS = { recipientName: '김', phone: '010', postalCode: '12345', roadAddress: '서울', detailAddress: '101' };

function order(over: Partial<EffectiveSalesOrder> = {}): EffectiveSalesOrder {
  return {
    id: 'so-1',
    status: 'pending',
    shippingAddress: ADDRESS,
    lines: [
      { id: 'sol-1', channelOrderItemId: 'ci-1', channelProductId: 'cp-1', effectiveQuantity: 2, unitPrice: 1000 },
      { id: 'sol-2', channelOrderItemId: 'ci-2', channelProductId: 'cp-2', effectiveQuantity: 1, unitPrice: 500 },
    ],
    ...over,
  };
}

function snapshot(over: Partial<ChannelOrderSnapshot> = {}): ChannelOrderSnapshot {
  return {
    shippingAddress: ADDRESS,
    lines: [
      { channelOrderItemId: 'ci-1', channelProductId: 'cp-1', quantity: 2, unitPrice: 1000, cancelled: false },
      { channelOrderItemId: 'ci-2', channelProductId: 'cp-2', quantity: 1, unitPrice: 500, cancelled: false },
    ],
    ...over,
  };
}

describe('diffChannelSnapshot', () => {
  it('같으면 델타가 없다 — 우리 쪽 식별만 바뀐 «변경»은 여기서 사라진다', () => {
    expect(diffChannelSnapshot(order(), snapshot())).toEqual([]);
  });

  it('취소·타임아웃 판매주문은 비교하지 않는다', () => {
    const changed = snapshot({ shippingAddress: { ...ADDRESS, roadAddress: '부산' } });
    expect(diffChannelSnapshot(order({ status: 'cancelled' }), changed)).toEqual([]);
    expect(diffChannelSnapshot(order({ status: 'timeout' }), changed)).toEqual([]);
  });

  it('주소 필드 하나라도 다르면 배송지 변경 — 앞뒤 공백은 무시한다', () => {
    const after = { ...ADDRESS, detailAddress: '202', deliveryNote: '문 앞' };
    expect(diffChannelSnapshot(order(), snapshot({ shippingAddress: after }))).toEqual([
      { type: 'shipping_address_change', before: ADDRESS, after },
    ]);
    expect(diffChannelSnapshot(order(), snapshot({ shippingAddress: { ...ADDRESS, phone: ' 010 ' } }))).toEqual([]);
  });

  it('수량 감소, 수량 0, 라인 소멸은 같은 감소다', () => {
    const decreased = diffChannelSnapshot(
      order(),
      snapshot({
        lines: [{ channelOrderItemId: 'ci-1', channelProductId: 'cp-1', quantity: 1, unitPrice: 1000, cancelled: false }],
      }),
    );
    expect(decreased).toEqual([
      { type: 'quantity_correction', salesOrderLineId: 'sol-1', channelOrderItemId: 'ci-1', quantityBefore: 2, correctedQuantity: 1 },
      { type: 'quantity_correction', salesOrderLineId: 'sol-2', channelOrderItemId: 'ci-2', quantityBefore: 1, correctedQuantity: 0 },
    ]);
    const zeroed = diffChannelSnapshot(
      order(),
      snapshot({
        lines: [
          { channelOrderItemId: 'ci-1', channelProductId: 'cp-1', quantity: 2, unitPrice: 1000, cancelled: false },
          { channelOrderItemId: 'ci-2', channelProductId: 'cp-2', quantity: 0, unitPrice: 500, cancelled: false },
        ],
      }),
    );
    expect(zeroed).toEqual([decreased[1]]);
  });

  it('cancelled 라인은 건너뛴다 — lifecycle 취소가 맡는다(이중 차감 방지)', () => {
    const naver = snapshot({
      lines: [
        { channelOrderItemId: 'ci-1', channelProductId: 'cp-1', quantity: 2, unitPrice: 1000, cancelled: false },
        { channelOrderItemId: 'ci-2', channelProductId: 'cp-2', quantity: 1, unitPrice: 500, cancelled: true },
      ],
    });
    expect(diffChannelSnapshot(order(), naver)).toEqual([]);
    // lifecycle 이 먼저 적용돼 유효 수량이 0 이 된 뒤에도 같다
    const afterLifecycle = order({
      lines: [order().lines[0], { ...order().lines[1], effectiveQuantity: 0 }],
    });
    expect(diffChannelSnapshot(afterLifecycle, naver)).toEqual([]);
  });

  it('증가·추가·교체·단가는 델타로 남는다(분류는 매니저가 범위 밖으로)', () => {
    const deltas = diffChannelSnapshot(
      order(),
      snapshot({
        lines: [
          { channelOrderItemId: 'ci-1', channelProductId: 'cp-9', quantity: 3, unitPrice: 900, cancelled: false },
          { channelOrderItemId: 'ci-2', channelProductId: 'cp-2', quantity: 1, unitPrice: 500, cancelled: false },
          { channelOrderItemId: 'ci-3', channelProductId: 'cp-3', quantity: 1, unitPrice: 700, cancelled: false },
        ],
      }),
    );
    expect(deltas).toEqual([
      { type: 'quantity_correction', salesOrderLineId: 'sol-1', channelOrderItemId: 'ci-1', quantityBefore: 2, correctedQuantity: 3 },
      { type: 'replace_product', salesOrderLineId: 'sol-1', channelOrderItemId: 'ci-1', channelProductIdBefore: 'cp-1', channelProductIdAfter: 'cp-9' },
      { type: 'amount_correction', salesOrderLineId: 'sol-1', channelOrderItemId: 'ci-1', unitPriceBefore: 1000, unitPriceAfter: 900 },
      { type: 'add_product', channelOrderItemId: 'ci-3', channelProductId: 'cp-3', quantity: 1, unitPrice: 700 },
    ]);
  });

  it('채널 라인 id 가 없는 라인은 짝을 못 지은 라인으로 남긴다', () => {
    const deltas = diffChannelSnapshot(
      order({ lines: [{ id: 'sol-x', channelOrderItemId: null, channelProductId: null, effectiveQuantity: 1, unitPrice: 1 }] }),
      snapshot({ lines: [{ channelOrderItemId: null, channelProductId: null, quantity: 1, unitPrice: 1, cancelled: false }] }),
    );
    expect(deltas).toEqual([
      { type: 'unmatched_line', salesOrderLineId: 'sol-x', quantity: 1 },
      { type: 'unmatched_line', salesOrderLineId: null, quantity: 1 },
    ]);
  });

  it('core effectiveQuantity 0 이지만 채널이 수량 1 → 수량 정정만, isDecrease 거짓', () => {
    const deltas = diffChannelSnapshot(
      order({ lines: [{ id: 'sol-1', channelOrderItemId: 'ci-1', channelProductId: 'cp-1', effectiveQuantity: 0, unitPrice: 1000 }] }),
      snapshot({ lines: [{ channelOrderItemId: 'ci-1', channelProductId: 'cp-1', quantity: 1, unitPrice: 1000, cancelled: false }] }),
    );
    expect(deltas).toEqual([
      { type: 'quantity_correction', salesOrderLineId: 'sol-1', channelOrderItemId: 'ci-1', quantityBefore: 0, correctedQuantity: 1 },
    ]);
    expect(isDecrease(deltas[0])).toBe(false);
  });

  it('snapshot 수량 0 + 다른 단가/상품 → 수량 정정만, 교체/금액 정정 없음', () => {
    const deltas = diffChannelSnapshot(
      order({ lines: [{ id: 'sol-1', channelOrderItemId: 'ci-1', channelProductId: 'cp-1', effectiveQuantity: 1, unitPrice: 1000 }] }),
      snapshot({ lines: [{ channelOrderItemId: 'ci-1', channelProductId: 'cp-9', quantity: 0, unitPrice: 900, cancelled: false }] }),
    );
    expect(deltas).toEqual([
      { type: 'quantity_correction', salesOrderLineId: 'sol-1', channelOrderItemId: 'ci-1', quantityBefore: 1, correctedQuantity: 0 },
    ]);
  });

  it('core null-id 라인 effectiveQuantity 0 → unmatched_line 미생성; snapshot null-id 수량 0 → 미생성', () => {
    // core null-id effectiveQuantity 0 doesn't emit unmatched_line
    const deltas1 = diffChannelSnapshot(
      order({ lines: [{ id: 'sol-x', channelOrderItemId: null, channelProductId: null, effectiveQuantity: 0, unitPrice: 1 }] }),
      snapshot({ lines: [{ channelOrderItemId: null, channelProductId: null, quantity: 0, unitPrice: 1, cancelled: false }] }),
    );
    expect(deltas1).toEqual([]);

    // snapshot null-id quantity 0 doesn't emit unmatched_line
    const deltas2 = diffChannelSnapshot(
      order({ lines: [{ id: 'sol-1', channelOrderItemId: 'ci-1', channelProductId: 'cp-1', effectiveQuantity: 1, unitPrice: 1 }] }),
      snapshot({ lines: [{ channelOrderItemId: null, channelProductId: null, quantity: 0, unitPrice: 1, cancelled: false }] }),
    );
    expect(deltas2).toEqual([
      { type: 'quantity_correction', salesOrderLineId: 'sol-1', channelOrderItemId: 'ci-1', quantityBefore: 1, correctedQuantity: 0 },
    ]);
  });

  it('snapshot cancelled 라인의 channelOrderItemId 가 core 와 맞지 않으면 delta 없음', () => {
    // snapshot 의 ci-3 는 cancelled 이고 core 에 없음
    const deltas = diffChannelSnapshot(
      order(),
      snapshot({
        lines: [
          { channelOrderItemId: 'ci-1', channelProductId: 'cp-1', quantity: 2, unitPrice: 1000, cancelled: false },
          { channelOrderItemId: 'ci-2', channelProductId: 'cp-2', quantity: 1, unitPrice: 500, cancelled: false },
          { channelOrderItemId: 'ci-3', channelProductId: 'cp-3', quantity: 1, unitPrice: 700, cancelled: true },
        ],
      }),
    );
    expect(deltas).toEqual([]);
  });
});

describe('isDecrease / removesAllLines', () => {
  it('감소만 참이다', () => {
    const [down] = diffChannelSnapshot(
      order(),
      snapshot({ lines: [{ channelOrderItemId: 'ci-1', channelProductId: 'cp-1', quantity: 1, unitPrice: 1000, cancelled: false }, snapshot().lines[1]] }),
    );
    expect(isDecrease(down)).toBe(true);
    expect(isDecrease({ type: 'add_product', channelOrderItemId: 'x', channelProductId: null, quantity: 1, unitPrice: 1 })).toBe(false);
  });

  it('남는 수량 합이 0 이면 전 라인 제거', () => {
    const deltas = diffChannelSnapshot(order(), snapshot({ lines: [] }));
    expect(removesAllLines(order(), deltas)).toBe(true);
    const partial = diffChannelSnapshot(order(), snapshot({ lines: [snapshot().lines[0]] }));
    expect(removesAllLines(order(), partial)).toBe(false);
  });

  it('order 라인이 없으면 거짓 — 제거할 게 없다', () => {
    const deltas: any[] = [];
    expect(removesAllLines(order({ lines: [] }), deltas)).toBe(false);
  });

  it('order 라인이 모두 effectiveQuantity 0 → 거짓 — 원래 없었던 주문', () => {
    const o = order({ lines: [{ id: 'sol-1', channelOrderItemId: 'ci-1', channelProductId: 'cp-1', effectiveQuantity: 0, unitPrice: 1000 }] });
    const deltas = diffChannelSnapshot(o, snapshot({ lines: [] }));
    expect(removesAllLines(o, deltas)).toBe(false);
  });

  it('전 라인 제거되지만 add_product 있으면 거짓 — 새로운 라인이 있다', () => {
    const deltas = diffChannelSnapshot(
      order(),
      snapshot({
        lines: [{ channelOrderItemId: 'ci-3', channelProductId: 'cp-3', quantity: 1, unitPrice: 700, cancelled: false }],
      }),
    );
    expect(removesAllLines(order(), deltas)).toBe(false);
  });

  it('전 라인 제거되지만 snapshot null-id 라인 qty 1 있으면 거짓 — 미확인 라인 남음', () => {
    const deltas = diffChannelSnapshot(
      order(),
      snapshot({
        lines: [{ channelOrderItemId: null, channelProductId: null, quantity: 1, unitPrice: 1, cancelled: false }],
      }),
    );
    expect(removesAllLines(order(), deltas)).toBe(false);
  });
});

describe('toShippingAddress', () => {
  it('jsonb 값을 계약 모양으로 읽고, 없는 선택 필드는 키 자체를 만들지 않는다', () => {
    expect(toShippingAddress({ ...ADDRESS, extra: 1 })).toEqual(ADDRESS);
    expect(toShippingAddress(null)).toEqual({ recipientName: '', phone: '', postalCode: '', roadAddress: '', detailAddress: '' });
  });
});
