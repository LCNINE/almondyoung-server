import { ConflictError } from '@app/shared';
import { dispatchBlocker } from './allocation.locks';

describe('dispatchBlocker', () => {
  it('송장 거절은 WAYBILL_NOT_READY — 사유 문장은 detail 로 그대로', () => {
    expect(dispatchBlocker('s1', new ConflictError('WAYBILL_STALE: x'))).toMatchObject({
      reason: 'WAYBILL_NOT_READY',
      detail: 'WAYBILL_STALE: x',
    });
  });
});
