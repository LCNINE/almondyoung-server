import { TossWebhookService } from './toss-webhook.service';
import { TossWebhookBodyDto } from './dto';

/** chargeId 하이픈 제거값이 토스 orderId — 웹훅은 이걸로 charge 를 복원한다. */
const CHARGE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ORDER_ID = 'aaaaaaaabbbbccccddddeeeeeeeeeeee';

const depositWebhook = (): TossWebhookBodyDto =>
  ({
    eventType: 'PAYMENT_STATUS_CHANGED',
    data: { orderId: ORDER_ID, status: 'DONE', paymentKey: 'pk_1', totalAmount: 12790 },
  }) as TossWebhookBodyDto;

function buildService(chargeStatus: string) {
  const updateStatus = jest.fn().mockResolvedValue(undefined);
  const finalizeApproval = jest.fn().mockResolvedValue(undefined);
  const repository = {
    insertOrIgnore: jest.fn().mockResolvedValue({ inserted: true, id: 'receipt-1' }),
    updateStatus,
  };
  const chargesService = {
    findById: jest.fn().mockResolvedValue({
      id: CHARGE_ID,
      intentId: 'intent-1',
      operation: 'AUTHORIZE',
      status: chargeStatus,
      amount: 12790,
    }),
  };
  const service = new TossWebhookService(
    repository as never,
    chargesService as never,
    { finalizeApproval } as never,
    {} as never,
  );
  return { service, updateStatus, finalizeApproval };
}

describe('TossWebhookService — deposit on canceled charge', () => {
  it('records a FAILED receipt instead of silently ignoring the deposit', async () => {
    const { service, updateStatus, finalizeApproval } = buildService('CANCELED');

    await service.handle(depositWebhook());

    // 취소된 계좌에 돈이 들어온 상황 — 승인은 하지 않되, 흔적은 반드시 남아야 한다.
    expect(finalizeApproval).not.toHaveBeenCalled();
    expect(updateStatus).toHaveBeenCalledWith(
      'receipt-1',
      'FAILED',
      expect.objectContaining({ errorCode: 'DEPOSIT_ON_CANCELED_CHARGE' }),
    );
  });

  it('still approves a normal deposit on a REQUIRES_ACTION charge', async () => {
    const { service, updateStatus, finalizeApproval } = buildService('REQUIRES_ACTION');

    await service.handle(depositWebhook());

    expect(finalizeApproval).toHaveBeenCalled();
    expect(updateStatus).toHaveBeenCalledWith('receipt-1', 'PROCESSED', expect.anything());
  });

  it('keeps ignoring an already-succeeded charge (duplicate webhook)', async () => {
    const { service, updateStatus, finalizeApproval } = buildService('SUCCEEDED');

    await service.handle(depositWebhook());

    expect(finalizeApproval).not.toHaveBeenCalled();
    expect(updateStatus).toHaveBeenCalledWith('receipt-1', 'IGNORED_DUPLICATE');
  });
});
