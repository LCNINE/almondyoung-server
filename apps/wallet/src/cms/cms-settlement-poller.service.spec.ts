import { CmsSettlementPollerService } from './cms-settlement-poller.service';

// W2: 정산 폴러가 이미 종료(취소/실패)된 intent를 정산성공으로 되살리지 않는지 검증.

function makePoller(intentStatus: string, invoiceId: string | null = null) {
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
      invoiceId,
      metadata: {},
    }),
  };
  const invoiceOutcomeService = {
    markPaid: jest.fn().mockResolvedValue(undefined),
    registerAttemptFailure: jest.fn().mockResolvedValue(undefined),
  };
  const poller = new CmsSettlementPollerService(
    dbService as never,
    cmsApi as never,
    chargesService as never,
    stateTransitionService as never,
    autoCaptureService as never,
    paymentIntentsService as never,
    invoiceOutcomeService as never,
  );
  return { poller, db, mockTx, chargesService, stateTransitionService, autoCaptureService, invoiceOutcomeService };
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

  it('인보이스 연결 intent 정산 성공 → invoice markPaid 훅 호출', async () => {
    const { poller, invoiceOutcomeService } = makePoller('PENDING_SETTLEMENT', 'inv-1');

    await (poller as never as { handleWithdrawalSuccess: (w: unknown, a: unknown) => Promise<void> })
      .handleWithdrawalSuccess(withdrawal, apiData);

    expect(invoiceOutcomeService.markPaid).toHaveBeenCalledWith('inv-1', 'intent-1');
  });

  it('인보이스 미연결 intent(레거시 경로)는 invoice 훅을 타지 않음', async () => {
    const { poller, invoiceOutcomeService } = makePoller('PENDING_SETTLEMENT');

    await (poller as never as { handleWithdrawalSuccess: (w: unknown, a: unknown) => Promise<void> })
      .handleWithdrawalSuccess(withdrawal, apiData);

    expect(invoiceOutcomeService.markPaid).not.toHaveBeenCalled();
  });
});

// 실패 경로도 성공 경로와 대칭: withdrawal·charge·intent 를 한 tx 로 묶어 부분커밋 고아를 막고,
// 이미 종료된 intent 는 재전이하지 않는다.
const failApiData = { status: '출금실패', result: { code: '9999', message: '잔액부족' } } as never;

describe('CmsSettlementPollerService.handleWithdrawalFailure (single-tx + terminal guard)', () => {
  it('PENDING_SETTLEMENT intent → charge FAILED + intent FAILED 를 한 tx 로 처리', async () => {
    const { poller, db, chargesService, stateTransitionService } = makePoller('PENDING_SETTLEMENT');

    await (poller as never as { handleWithdrawalFailure: (w: unknown, a: unknown) => Promise<void> })
      .handleWithdrawalFailure(withdrawal, failApiData);

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(chargesService.updateStatus).toHaveBeenCalledWith('charge-1', 'FAILED', expect.anything(), expect.anything());
    expect(stateTransitionService.transitionIntent).toHaveBeenCalledWith(
      'intent-1',
      'FAILED',
      expect.anything(),
      'PENDING_SETTLEMENT',
      expect.anything(),
    );
  });

  it('이미 CANCELED 인 intent → withdrawal 만 FAILED 기록, charge/intent 전이 없음(불법전이 방지)', async () => {
    const { poller, db, chargesService, stateTransitionService } = makePoller('CANCELED');

    await (poller as never as { handleWithdrawalFailure: (w: unknown, a: unknown) => Promise<void> })
      .handleWithdrawalFailure(withdrawal, failApiData);

    expect(db.update).toHaveBeenCalledTimes(1); // withdrawal 단건 update
    expect(db.transaction).not.toHaveBeenCalled();
    expect(chargesService.updateStatus).not.toHaveBeenCalled();
    expect(stateTransitionService.transitionIntent).not.toHaveBeenCalled();
  });

  it('인보이스 연결 intent 정산 실패 → invoice 실패 집계 훅 호출', async () => {
    const { poller, invoiceOutcomeService } = makePoller('PENDING_SETTLEMENT', 'inv-1');

    await (poller as never as { handleWithdrawalFailure: (w: unknown, a: unknown) => Promise<void> })
      .handleWithdrawalFailure(withdrawal, failApiData);

    expect(invoiceOutcomeService.registerAttemptFailure).toHaveBeenCalledWith('inv-1', 'intent-1', '9999', '잔액부족');
  });
});
