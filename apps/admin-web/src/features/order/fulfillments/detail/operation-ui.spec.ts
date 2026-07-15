import {
  FULFILLMENT_SCOPES,
  canShowFulfillmentAction,
  isRecoverableOperation,
} from '../../../../lib/services/orders/operation-policy';
import { getServerDenyMessage } from '../../../../lib/api/server-error';

describe('fulfillment operation UI policy', () => {
  it('hides actions when their exact scope is absent', () => {
    const scopes = [FULFILLMENT_SCOPES.operate];
    expect(canShowFulfillmentAction('split', scopes)).toBe(true);
    expect(canShowFulfillmentAction('plan', scopes)).toBe(true);
    expect(canShowFulfillmentAction('recall', scopes)).toBe(false);
    expect(canShowFulfillmentAction('consolidate', scopes)).toBe(false);
    expect(canShowFulfillmentAction('transferReservation', scopes)).toBe(false);
  });

  it('does not treat client-side hiding as authorization and explains server 403/409 denials', () => {
    expect(
      getServerDenyMessage(
        {
          response: { status: 403, data: { message: 'missing recall scope' } },
        },
        '실패'
      )
    ).toContain('권한이 없어 서버가 작업을 거부했습니다. missing recall scope');
    expect(
      getServerDenyMessage(
        {
          response: {
            status: 409,
            data: { message: ['manifest stale', 'reload'] },
          },
        },
        '실패'
      )
    ).toContain(
      '상태가 변경되어 서버가 작업을 거부했습니다. manifest stale, reload'
    );
  });

  it('only offers original-key retry for non-terminal operations', () => {
    expect(isRecoverableOperation('pending')).toBe(true);
    expect(isRecoverableOperation('recovery_required')).toBe(true);
    expect(isRecoverableOperation('completed')).toBe(false);
    expect(isRecoverableOperation('succeeded')).toBe(false);
  });
});
