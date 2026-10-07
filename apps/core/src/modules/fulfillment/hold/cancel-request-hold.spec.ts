import { ConflictError } from '@app/shared';
import { isCancelRequestedError } from './cancel-request-hold';

describe('isCancelRequestedError', () => {
  it('CANCEL_REQUESTED 로 시작하는 ConflictError 만', () => {
    expect(isCancelRequestedError(new ConflictError('CANCEL_REQUESTED: x'))).toBe(true);
    expect(isCancelRequestedError(new ConflictError('WAYBILL_STALE: x'))).toBe(false);
    expect(isCancelRequestedError(new Error('CANCEL_REQUESTED: x'))).toBe(false);
  });
});
