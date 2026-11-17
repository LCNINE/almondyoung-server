import { BadRequestError } from '@app/shared';
import {
  classifyOperationReason,
  isCustomerRequestReason,
  REQUEST_CHANNEL_CODES,
  resolveOperationReason,
  SHIPMENT_OPERATION_REASONS,
} from './shipment-operation-reasons';

describe('resolveOperationReason', () => {
  it('고객 요청 코드는 문구로 바꾸고 요청 경로를 받는다', () => {
    expect(
      resolveOperationReason('split', { reason: 'x', reasonCode: 'customer_ship_first', requestChannel: 'kakao' }),
    ).toEqual({
      reason: '고객이 일부 먼저 보내 달라고 요청',
      reasonCode: 'customer_ship_first',
      requestChannel: 'kakao',
    });
  });

  it('고객 요청 코드에 요청 경로가 없으면 거절한다', () => {
    expect(() => resolveOperationReason('split', { reason: 'x', reasonCode: 'customer_ship_first' })).toThrow(
      BadRequestError,
    );
  });

  it('알 수 없는 요청 경로는 거절한다', () => {
    expect(() =>
      resolveOperationReason('split', { reason: 'x', reasonCode: 'customer_ship_first', requestChannel: 'fax' }),
    ).toThrow(BadRequestError);
  });

  it('고객 요청이 아닌 코드의 요청 경로는 버린다', () => {
    expect(
      resolveOperationReason('split', { reason: 'x', reasonCode: 'does_not_fit', requestChannel: 'kakao' }),
    ).toEqual({
      reason: '한 상자에 다 들어가지 않음',
      reasonCode: 'does_not_fit',
      requestChannel: null,
    });
  });

  it('기타는 글이 있어야 한다', () => {
    expect(() => resolveOperationReason('split', { reason: '  ', reasonCode: 'other' })).toThrow(BadRequestError);
    expect(resolveOperationReason('split', { reason: '박스 파손', reasonCode: 'other' })).toEqual({
      reason: '박스 파손',
      reasonCode: 'other',
      requestChannel: null,
    });
  });

  it('다른 작업의 코드는 거절한다', () => {
    expect(() => resolveOperationReason('split', { reason: 'x', reasonCode: 'customer_urgent' })).toThrow(
      BadRequestError,
    );
  });

  it('코드 없이 글만 오면 그대로 통과한다', () => {
    expect(resolveOperationReason('split', { reason: '옛 글' })).toEqual({
      reason: '옛 글',
      reasonCode: null,
      requestChannel: null,
    });
  });

  it('주문 취소는 목록 검사 없이 코드를 저장한다', () => {
    expect(resolveOperationReason('cancel', { reason: '단순 변심', reasonCode: 'CHANGE_OF_MIND' })).toEqual({
      reason: '단순 변심',
      reasonCode: 'CHANGE_OF_MIND',
      requestChannel: null,
    });
    expect(
      resolveOperationReason('cancel', { reason: 'x', reasonCode: 'CUSTOMER_REQUEST', requestChannel: 'phone' }),
    ).toMatchObject({ requestChannel: 'phone' });
  });

  it('주문 취소의 고객 요청은 경로 없이도 받고, 고객 요청이 아니면 경로를 버린다', () => {
    expect(resolveOperationReason('cancel', { reason: 'x', reasonCode: 'CUSTOMER_REQUEST' })).toMatchObject({
      reasonCode: 'CUSTOMER_REQUEST',
      requestChannel: null,
    });
    expect(
      resolveOperationReason('cancel', { reason: 'x', reasonCode: 'OUT_OF_STOCK', requestChannel: 'phone' }),
    ).toMatchObject({ requestChannel: null });
    expect(() =>
      resolveOperationReason('cancel', { reason: 'x', reasonCode: 'CUSTOMER_REQUEST', requestChannel: 'fax' }),
    ).toThrow(BadRequestError);
  });

  it('작업 기록 칸보다 긴 주문 취소 코드는 코드 없이 사유 글만 남긴다', () => {
    const longCode = 'X'.repeat(70);
    expect(resolveOperationReason('cancel', { reason: longCode, reasonCode: longCode })).toEqual({
      reason: longCode,
      reasonCode: null,
      requestChannel: null,
    });
  });

  it('되돌리기·결품은 reason 에 코드 문자열을 유지한다', () => {
    expect(resolveOperationReason('recall', { reason: 'x', reasonCode: 'dispatch_mistake' })).toEqual({
      reason: 'dispatch_mistake',
      reasonCode: 'dispatch_mistake',
      requestChannel: null,
    });
    expect(resolveOperationReason('short_pick', { reason: 'item_damaged', reasonCode: 'item_damaged' })).toMatchObject({
      reason: 'item_damaged',
    });
  });

  it('목록을 쓰지 않는 작업에 코드가 오면 거절한다', () => {
    expect(() => resolveOperationReason('plan', { reason: 'x', reasonCode: 'other' })).toThrow(BadRequestError);
  });
});

describe('classifyOperationReason', () => {
  it('저장된 코드가 있으면 그대로 돌려준다', () => {
    expect(classifyOperationReason('split', { reasonCode: 'does_not_fit', reason: 'x' })).toBe('does_not_fit');
  });

  it('옛 기록의 고정 문자열을 코드로 분류한다', () => {
    expect(classifyOperationReason('plan', { reasonCode: null, reason: 'Shipment planned' })).toBe('system_plan');
    expect(classifyOperationReason('recall', { reasonCode: null, reason: 'dispatch_mistake' })).toBe(
      'dispatch_mistake',
    );
    expect(classifyOperationReason('consolidate', { reasonCode: null, reason: '동일 수령인 합포장' })).toBe(
      'same_address',
    );
    expect(classifyOperationReason('cancel', { reasonCode: null, reason: 'Sales order cancellation' })).toBe(
      'Sales order cancellation',
    );
  });

  it('자유 글은 분류하지 않는다', () => {
    expect(classifyOperationReason('split', { reasonCode: null, reason: '자유 글' })).toBeNull();
  });
});

describe('isCustomerRequestReason', () => {
  it('목록의 고객 요청 코드와 주문 취소의 고객 요청만 참이다', () => {
    expect(isCustomerRequestReason('split', 'customer_ship_first')).toBe(true);
    expect(isCustomerRequestReason('split', 'other')).toBe(false);
    expect(isCustomerRequestReason('cancel', 'CUSTOMER_REQUEST')).toBe(true);
    expect(isCustomerRequestReason('cancel', 'OTHER')).toBe(false);
  });
});

describe('목록 정본', () => {
  it('요청 경로 코드는 다섯 개다', () => {
    expect(REQUEST_CHANNEL_CODES).toEqual(['kakao', 'phone', 'store_inquiry', 'marketplace_inquiry', 'other']);
  });

  it('고객 요청 코드는 작업마다 하나 이하다', () => {
    for (const list of Object.values(SHIPMENT_OPERATION_REASONS)) {
      expect(list.filter((r) => r.customerRequest).length).toBeLessThanOrEqual(1);
    }
  });
});
