import type { PreparationShipmentDto } from '@/lib/types/dto/fulfillment';
import {
  locatePreparationTarget,
  plannedOrderText,
  preparationAddress,
  preparationTargetNotice,
} from './preparation-model';

const rows = [
  { shipmentId: 'a1111111-0000', orderNos: ['6321'] },
  { shipmentId: 'd4444444-0000', orderNos: [] },
];

describe('plannedOrderText', () => {
  it('주문번호가 없으면 상자 번호 앞 여덟 자를 쓴다', () => {
    expect(plannedOrderText(rows[1])).toBe('상자 d4444444');
    expect(plannedOrderText(rows[0])).toBe('#6321');
  });
});

describe('locatePreparationTarget', () => {
  const box = (shipmentId: string): PreparationShipmentDto => ({
    shipmentId,
    orderNos: [],
    itemSummary: '상품',
    totalQty: 1,
    single: true,
    reason: null,
  });
  const summary = {
    warehouseId: 'w1',
    awaitingMatchingCount: 0,
    buckets: [
      {
        bucket: 'ready' as const,
        count: 1,
        singleCount: 1,
        multiCount: 0,
        shipments: [box('r1')],
      },
      {
        bucket: 'unavailable' as const,
        count: 1,
        singleCount: 0,
        multiCount: 0,
        shipments: [box('u1')],
      },
    ],
  };

  it('바로 준비할 수 있는 분류와 아닌 분류, 없는 상자를 나눈다', () => {
    expect(locatePreparationTarget(summary, 'r1')).toMatchObject({
      kind: 'prepare',
      bucket: 'ready',
    });
    expect(locatePreparationTarget(summary, 'u1')).toMatchObject({
      kind: 'review',
      bucket: 'unavailable',
    });
    expect(locatePreparationTarget(summary, 'x')).toEqual({ kind: 'missing' });
  });

  it('준비할 수 있어도 피킹 방식이 정해지지 않았으면 직접 누르라고 알린다', () => {
    const found = locatePreparationTarget(summary, 'r1');

    expect(preparationTargetNotice(found, '완전출고', true)).toBeNull();
    expect(preparationTargetNotice(found, '완전출고', false)).toBe(
      '이 상자만 골라 두었어요. 피킹 방식을 확인한 뒤 «출고 준비»를 눌러 주세요.'
    );
  });
});

describe('preparationAddress', () => {
  const path = '/order/waybill-issue';

  it('처리한 상자만 지우고 창고는 남긴다', () => {
    expect(preparationAddress(path, 'warehouseId=w1&prepare=b1')).toBe(
      `${path}?warehouseId=w1`
    );
    expect(preparationAddress(path, 'prepare=b1')).toBe(path);
  });

  it('창고를 바꾸면 주소의 창고도 바꾼다', () => {
    expect(preparationAddress(path, 'warehouseId=w1&prepare=b1', 'w2')).toBe(
      `${path}?warehouseId=w2`
    );
    expect(preparationAddress(path, 'warehouseId=w1', 'w2')).toBe(
      `${path}?warehouseId=w2`
    );
  });

  it('바꿀 것이 없으면 주소를 건드리지 않는다', () => {
    expect(preparationAddress(path, '')).toBeNull();
    expect(preparationAddress(path, '', 'w2')).toBeNull();
  });

  it('창고를 고르면 주소가 같아 보여도 마지막 선택으로 다시 쓴다', () => {
    // w2 로 바꾼 주소가 반영되기 전에 다시 w1 을 고르면 읽은 주소는 아직 w1 이다
    expect(preparationAddress(path, 'warehouseId=w1', 'w1')).toBe(
      `${path}?warehouseId=w1`
    );
  });
});
