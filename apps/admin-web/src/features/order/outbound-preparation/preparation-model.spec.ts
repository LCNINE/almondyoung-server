import type { PreparationShipmentDto } from '@/lib/types/dto/fulfillment';
import {
  batchReturnNextStep,
  locatePreparationTarget,
  orderAgeOf,
  plannedOrderText,
  preparationAddress,
  preparationTargetNotice,
  showsShipmentDetailLink,
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

describe('batchReturnNextStep', () => {
  const batchReturn = (needsNewWaybill: boolean) => ({
    batchNumber: 'OB-1',
    exitedAt: '2026-01-02T01:05:00Z',
    place: null,
    reason: '잘못 넣은 상자',
    needsNewWaybill,
  });

  it.each([
    [
      'resume',
      true,
      '«이어서 출고 준비»를 누르면 새 송장을 받아 다시 배치에 담아요',
    ],
    [
      'resume',
      false,
      '«이어서 출고 준비»를 누르면 지금 송장으로 다시 배치에 담아요',
    ],
    ['ready', true, '«출고 준비»를 누르면 다시 배치에 담아요'],
    ['unavailable', true, '재고가 모자라요 — 재고를 채운 뒤 다시 준비해요'],
    ['needs_info', true, null],
  ] as const)('%s, 새 송장 %s', (bucket, needsNewWaybill, expected) => {
    expect(
      batchReturnNextStep(bucket, {
        batchReturn: batchReturn(needsNewWaybill),
        shortPick: null,
        reason: null,
      })
    ).toBe(expected);
  });

  it('결품 상자와 서버가 사유를 준 상자, 배치와 상관없는 상자에는 붙이지 않는다', () => {
    expect(
      batchReturnNextStep('resume', {
        batchReturn: batchReturn(true),
        shortPick: [{ name: '상품', locationCode: 'A-01-01', shortQty: 1 }],
        reason: null,
      })
    ).toBeNull();
    expect(
      batchReturnNextStep('resume', {
        batchReturn: batchReturn(true),
        shortPick: null,
        reason: '운송사가 송장 접수를 거절했어요 — 상자 화면에서 확인해요',
      })
    ).toBeNull();
    expect(
      batchReturnNextStep('resume', {
        batchReturn: null,
        shortPick: null,
        reason: null,
      })
    ).toBeNull();
  });
});

describe('showsShipmentDetailLink', () => {
  const batchReturn = {
    batchNumber: 'OB-1',
    exitedAt: '2026-01-02T01:05:00Z',
    place: null,
    reason: '잘못 넣은 상자',
    needsNewWaybill: false,
  };
  const shortPick = [{ name: '상품', locationCode: 'A-01-01', shortQty: 1 }];

  it.each([
    ['needs_info', null, null, null, true],
    ['resume', null, null, '송장 접수를 거절했어요', true],
    ['resume', null, null, null, false],
    ['ready', null, null, null, false],
    ['ready', batchReturn, null, null, true],
    ['mergeable', batchReturn, null, null, true],
    ['unavailable', batchReturn, null, null, true],
    ['resume', null, shortPick, null, true],
  ] as const)(
    '%s, 돌아온 상자 %p, 결품 %p, 사유 %p',
    (bucket, returned, short, reason, expected) => {
      expect(
        showsShipmentDetailLink(bucket, {
          batchReturn: returned,
          shortPick: short ? [...short] : null,
          reason,
        })
      ).toBe(expected);
    }
  );
});

describe('orderAgeOf', () => {
  const now = new Date('2026-01-10T12:00:00Z');

  it('하루를 넘긴 주문만 오래 기다림으로 보고, 1분이 안 된 주문은 방금이라고 쓴다', () => {
    expect(orderAgeOf('2026-01-09T12:00:00Z', now)).toMatchObject({
      dateText: '1월 9일 21:00',
      waitText: '1일 지남',
      long: false,
    });
    expect(orderAgeOf('2026-01-09T11:59:00Z', now)).toMatchObject({
      long: true,
    });
    expect(orderAgeOf('2026-01-10T11:59:30Z', now)?.waitText).toBe('방금');
  });

  it('주문일이 없거나 읽을 수 없으면 null', () => {
    expect(orderAgeOf(null, now)).toBeNull();
    expect(orderAgeOf(undefined, now)).toBeNull();
    expect(orderAgeOf('not-a-date', now)).toBeNull();
  });
});
