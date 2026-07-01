import { CmsSettlementPollerService } from './cms-settlement-poller.service';

// W2: 정산 폴러가 이미 종료(취소/실패)된 intent를 정산성공으로 되살리지 않는지 검증.

function makePoller(intentStatus: string) {
  const mockTx = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
  };
  const db = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    transaction: jest.fn().mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockTx)),
  };
  const dbService = { db };
  const cmsApi = {};
  const chargesService = { updateStatus: jest.fn().mockResolvedValue(undefined) };
  const stateTransitionService = { transitionIntent: jest.fn().mockResolvedValue(undefined) };
  const autoCaptureService = { attemptAutoCapture: jest.fn().mockResolvedValue(undefined) };
  const paymentIntentsService = {
    findById: jest.fn().mockResolvedValue({
      id: 'intent-1',
      status: intentStatus,
      userId: 'user-1',
      payableAmount: 29900,
      currency: 'KRW',
      metadata: {},
    }),
  };
  const poller = new CmsSettlementPollerService(
    dbService as never,
    cmsApi as never,
    chargesService as never,
    stateTransitionService as never,
    autoCaptureService as never,
    paymentIntentsService as never,
  );
  return { poller, db, mockTx, chargesService, stateTransitionService, autoCaptureService };
}

const withdrawal = {
  id: 'wd-1',
  transactionId: 'txn-1',
  chargeId: 'charge-1',
  intentId: 'intent-1',
  status: 'REQUESTED',
} as never;
const apiData = { status: '출금성공', result: { code: '0000', message: 'ok' }, actualAmount: 29900, fee: 0 } as never;

describe('CmsSettlementPollerService.handleWithdrawalSuccess (W2 reconcile guard)', () => {
  it('does NOT resurrect a CANCELED intent — only records the withdrawal, no charge/intent transition', async () => {
    const { poller, db, chargesService, stateTransitionService, autoCaptureService } = makePoller('CANCELED');

    await (poller as never as { handleWithdrawalSuccess: (w: unknown, a: unknown) => Promise<void> })
      .handleWithdrawalSuccess(withdrawal, apiData);

    // withdrawal 실태만 SUCCEEDED로 기록(단건 update), charge/intent는 건드리지 않음
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.transaction).not.toHaveBeenCalled();
    expect(chargesService.updateStatus).not.toHaveBeenCalled();
    expect(stateTransitionService.transitionIntent).not.toHaveBeenCalled();
    expect(autoCaptureService.attemptAutoCapture).not.toHaveBeenCalled();
  });

  it('completes normally (charge SUCCEEDED + intent AUTHORIZED in one tx) for a PENDING_SETTLEMENT intent', async () => {
    const { poller, db, chargesService, stateTransitionService, autoCaptureService } = makePoller('PENDING_SETTLEMENT');

    await (poller as never as { handleWithdrawalSuccess: (w: unknown, a: unknown) => Promise<void> })
      .handleWithdrawalSuccess(withdrawal, apiData);

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(chargesService.updateStatus).toHaveBeenCalledWith('charge-1', 'SUCCEEDED', expect.anything(), expect.anything());
    expect(stateTransitionService.transitionIntent).toHaveBeenCalledWith(
      'intent-1',
      'AUTHORIZED',
      expect.anything(),
      'PENDING_SETTLEMENT',
      expect.anything(),
    );
    expect(autoCaptureService.attemptAutoCapture).toHaveBeenCalled();
  });
});
