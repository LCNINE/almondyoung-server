import { NeedsInfoLine, needsInfoIssues, needsInfoReasonText } from './needs-info';
import { shortageStockOf } from './shortage-stock';

const recipient = { recipientName: '받는 분', phone: '010', postalCode: '00000', roadAddress: '도로명' };
const line = (skuId: string, profileId: string | null, profileName: string | null = null): NeedsInfoLine => ({
  skuId,
  skuName: `상품 ${skuId}`,
  skuCode: `CODE-${skuId}`,
  profileId,
  profileName,
});

describe('needsInfoIssues', () => {
  it('배송 프로필이 없는 상품만 골라 이름과 코드를 준다', () => {
    const issues = needsInfoIssues({
      lines: [line('a', 'p1', '일반'), line('b', null), line('b', null)],
      recipientSnapshot: recipient,
      untrustedSkuIds: new Set(),
    });

    expect(issues).toEqual([{ kind: 'shipping_profile_missing', skus: [{ name: '상품 b', code: 'CODE-b' }] }]);
    expect(needsInfoReasonText(issues[0])).toBe('배송 프로필이 없는 상품이 있어요');
  });

  it('배송 프로필이 상품마다 다르면 상품별 프로필 이름을 준다', () => {
    expect(
      needsInfoIssues({
        lines: [line('a', 'p1', '일반'), line('b', 'p2', '냉장')],
        recipientSnapshot: recipient,
        untrustedSkuIds: new Set(),
      }),
    ).toEqual([
      {
        kind: 'shipping_profile_mixed',
        skus: [
          { name: '상품 a', code: 'CODE-a', profileName: '일반' },
          { name: '상품 b', code: 'CODE-b', profileName: '냉장' },
        ],
      },
    ]);
  });

  it('비어 있는 수령인 칸과 품목 번호가 없는 상품을 분류 순서대로 함께 준다', () => {
    const issues = needsInfoIssues({
      lines: [line('a', 'p1', '일반'), line('b', 'p1', '일반')],
      recipientSnapshot: { ...recipient, phone: ' ', postalCode: undefined },
      untrustedSkuIds: new Set(['b']),
    });

    expect(issues).toEqual([
      { kind: 'recipient_incomplete', fields: ['phone', 'postalCode'] },
      { kind: 'channel_item_unknown', skus: [{ name: '상품 b', code: 'CODE-b' }] },
    ]);
    expect(issues.map(needsInfoReasonText)).toEqual([
      '수령인 정보가 비어 있어요',
      '쇼핑몰 품목 번호가 없거나 맞지 않아요',
    ]);
  });

  it('문제가 없으면 빈 목록이다', () => {
    expect(
      needsInfoIssues({ lines: [line('a', 'p1', '일반')], recipientSnapshot: recipient, untrustedSkuIds: new Set() }),
    ).toEqual([]);
  });
});

describe('shortageStockOf', () => {
  const pipeline = {
    skuId: 'a',
    onOrderQty: 20,
    onOrderEta: new Date('2026-01-20T00:00:00.000Z'),
    onOrderTotalQty: 26,
    onOrderToSellableEta: '2026-01-03',
    awaitingTransferQty: 4,
    inTransitQty: 3,
    inTransitEta: new Date('2026-01-05T00:00:00.000Z'),
    inboundShipmentQty: 9,
    inboundShipmentToSellableQty: 2,
    inboundShipmentEta: '2026-01-08',
  };

  it('판매 창고 축으로 이 창고로 올 것과 다른 창고에 있는 것을 나눈다', () => {
    expect(
      shortageStockOf({ onHand: 2, reserved: 2, waiting: 9 }, pipeline, 0, { incoming: true, elsewhere: true }),
    ).toEqual({
      onHand: 2,
      reservedByOthers: 2,
      available: 0,
      waiting: 9,
      incoming: {
        inTransit: 3,
        inTransitEta: '2026-01-05',
        ordered: 6,
        orderedEta: '2026-01-03',
        inboundShipment: 2,
        inboundShipmentEta: '2026-01-08',
      },
      elsewhere: { onHand: 4, ordered: 20, orderedEta: '2026-01-20' },
    });
  });

  it('판매 창고가 여럿이면 이 창고로 올 것만 모르고, 이 상자 몫은 다른 상자 몫에서 뺀다', () => {
    expect(
      shortageStockOf({ onHand: 5, reserved: 3, waiting: 4 }, pipeline, 1, { incoming: false, elsewhere: true }),
    ).toEqual({
      onHand: 5,
      reservedByOthers: 2,
      available: 2,
      waiting: 4,
      incoming: null,
      elsewhere: { onHand: 4, ordered: 20, orderedEta: '2026-01-20' },
    });
    expect(shortageStockOf(undefined, undefined, 0, { incoming: false, elsewhere: false })).toMatchObject({
      incoming: null,
      elsewhere: null,
    });
  });

  it('파이프라인 행이 없는 상품은 0 으로 낸다', () => {
    expect(shortageStockOf(undefined, undefined, 0, { incoming: true, elsewhere: true })).toEqual({
      onHand: 0,
      reservedByOthers: 0,
      available: 0,
      waiting: 0,
      incoming: {
        inTransit: 0,
        inTransitEta: null,
        ordered: 0,
        orderedEta: null,
        inboundShipment: 0,
        inboundShipmentEta: null,
      },
      elsewhere: { onHand: 0, ordered: 0, orderedEta: null },
    });
  });
});
