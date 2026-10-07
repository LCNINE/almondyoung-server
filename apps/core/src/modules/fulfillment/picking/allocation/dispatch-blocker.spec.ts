import { ConflictError } from '@app/shared';
import { dispatchBlocker } from './allocation.locks';

describe('dispatchBlocker', () => {
  it('취소 요청 보류는 CANCEL_REQUESTED, 나머지 송장 거절은 WAYBILL_NOT_READY', () => {
    expect(
      dispatchBlocker('s1', new ConflictError('CANCEL_REQUESTED: 취소 처리 중인 주문이 있습니다 (shipment s1)')),
    ).toMatchObject({
      reason: 'CANCEL_REQUESTED',
      detail: 'CANCEL_REQUESTED: 취소 처리 중인 주문이 있습니다 (shipment s1)',
    });
    expect(dispatchBlocker('s1', new ConflictError('WAYBILL_STALE: x')).reason).toBe('WAYBILL_NOT_READY');
  });
});
