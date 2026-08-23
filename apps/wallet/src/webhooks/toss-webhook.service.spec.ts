import { TossWebhookService } from './toss-webhook.service';
import { TossWebhookBodyDto } from './dto';

/** chargeId 하이픈 제거값이 토스 orderId — 웹훅은 이걸로 charge 를 복원한다. */
const CHARGE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ORDER_ID = 'aaaaaaaabbbbccccddddeeeeeeeeeeee';
const CHARGE_AMOUNT = 12790;

const depositWebhook = (): TossWebhookBodyDto => ({
  eventType: 'PAYMENT_STATUS_CHANGED',
  // 계약이 createdAt 을 요구한다. 이 스펙은 시각을 보지 않지만 캐스트로 덮으면
  // 다음 계약 변경도 못 잡으므로 채워 둔다.
  createdAt: '2026-08-13T00:00:00.000Z',
  // 본문값은 공격자가 조작 가능한 값이다 — 방어 후에는 신뢰되지 않아야 한다.
  data: { orderId: ORDER_ID, status: 'DONE', paymentKey: 'pk_body', totalAmount: CHARGE_AMOUNT },
});

interface BuildOpts {
  /** 토스 재조회가 돌려주는 authoritative status (기본 DONE). */
  reQueryStatus?: string;
  /** 토스 재조회가 돌려주는 authoritative 금액 (기본 charge 금액). */
  reQueryAmount?: number;
  /** 토스 재조회가 돌려주는 실제 paymentKey (기본 pk_toss). */
  reQueryPaymentKey?: string;
  /** 재조회 자체가 실패하는 경우 (일시적 5xx / 미존재 4xx). */
  reQueryError?: { statusCode: number; code: string };
  /** VA 발급 시 charge 에 저장돼 있던 secret (있으면 secret 대조 대상). */
  storedSecret?: string;
}

function buildService(chargeStatus: string, opts: BuildOpts = {}) {
  const {
    reQueryStatus = 'DONE',
    reQueryAmount = CHARGE_AMOUNT,
    reQueryPaymentKey = 'pk_toss',
    reQueryError,
    storedSecret,
  } = opts;

  const updateStatus = jest.fn().mockResolvedValue(undefined);
  const finalizeApproval = jest.fn().mockResolvedValue(undefined);
  const finalizeFailure = jest.fn().mockResolvedValue(undefined);
  const insertOrIgnore = jest.fn().mockResolvedValue({ inserted: true, id: 'receipt-1' });
  const repository = { insertOrIgnore, updateStatus };
  const chargesService = {
    findById: jest.fn().mockResolvedValue({
      id: CHARGE_ID,
      intentId: 'intent-1',
      operation: 'AUTHORIZE',
      status: chargeStatus,
      amount: CHARGE_AMOUNT,
      responsePayload: storedSecret ? { secret: storedSecret } : null,
    }),
  };
  const getPaymentByOrderId = jest.fn().mockResolvedValue(
    reQueryError
      ? { ok: false, error: { code: reQueryError.code, message: 'x' }, statusCode: reQueryError.statusCode }
      : {
          ok: true,
          data: { orderId: ORDER_ID, status: reQueryStatus, totalAmount: reQueryAmount, paymentKey: reQueryPaymentKey },
        },
  );
  const tossApi = { getPaymentByOrderId };

  const service = new TossWebhookService(
    repository as never,
    chargesService as never,
    { finalizeApproval, finalizeFailure } as never,
    {} as never,
    tossApi as never,
  );
  return { service, updateStatus, finalizeApproval, finalizeFailure, insertOrIgnore, getPaymentByOrderId };
}

describe('TossWebhookService — 위조 방어 (토스 재조회 + secret 대조)', () => {
  it('본문 status 가 DONE 이어도 토스 재조회가 입금대기면 승인하지 않는다 (위조 DONE 차단)', async () => {
    const { service, finalizeApproval } = buildService('REQUIRES_ACTION', {
      reQueryStatus: 'WAITING_FOR_DEPOSIT',
    });

    await service.handle(depositWebhook());

    expect(finalizeApproval).not.toHaveBeenCalled();
  });

  it('승인은 본문이 아니라 토스가 돌려준 실제 paymentKey 로 확정한다', async () => {
    const { service, finalizeApproval } = buildService('REQUIRES_ACTION', {
      reQueryStatus: 'DONE',
      reQueryPaymentKey: 'pk_toss',
    });

    await service.handle(depositWebhook()); // 본문 paymentKey 는 pk_body

    expect(finalizeApproval).toHaveBeenCalledWith(expect.anything(), 'pk_toss', expect.anything());
  });

  it('금액은 본문이 아니라 토스 재조회 금액으로 검증한다 (불일치면 FAILED)', async () => {
    const { service, finalizeApproval, updateStatus } = buildService('REQUIRES_ACTION', {
      reQueryStatus: 'DONE',
      reQueryAmount: 9999, // charge.amount=12790 과 다름
    });

    await service.handle(depositWebhook()); // 본문 totalAmount 는 12790 로 위조

    expect(finalizeApproval).not.toHaveBeenCalled();
    expect(updateStatus).toHaveBeenCalledWith(
      'receipt-1',
      'FAILED',
      expect.objectContaining({ errorCode: 'AMOUNT_MISMATCH' }),
    );
  });

  it('VA 발급 시 저장된 secret 과 본문 secret 이 다르면 거부한다', async () => {
    const { service, finalizeApproval, updateStatus } = buildService('REQUIRES_ACTION', {
      reQueryStatus: 'DONE',
      storedSecret: 'S_real',
    });

    const wh = depositWebhook();
    wh.data.secret = 'S_forged';
    await service.handle(wh);

    expect(finalizeApproval).not.toHaveBeenCalled();
    expect(updateStatus).toHaveBeenCalledWith(
      'receipt-1',
      'FAILED',
      expect.objectContaining({ errorCode: 'SECRET_MISMATCH' }),
    );
  });

  it('secret 불일치는 실제 status dedup 키를 소모하지 않는다 (뒤이어 오는 진짜 웹훅 보존)', async () => {
    const { service, insertOrIgnore } = buildService('REQUIRES_ACTION', {
      reQueryStatus: 'DONE',
      storedSecret: 'S_real',
    });

    const wh = depositWebhook();
    wh.data.secret = 'S_forged';
    await service.handle(wh);

    // 위조 웹훅은 전용 키로 기록되어야 하고, `orderId:DONE` 키를 절대 선점하면 안 된다.
    const keys = insertOrIgnore.mock.calls.map((c) => c[0].providerEventId);
    expect(keys).toContain(`${ORDER_ID}:SECRET_MISMATCH`);
    expect(keys).not.toContain(`${ORDER_ID}:DONE`);
  });

  it('재조회가 일시적으로 실패하면 throw 하고 dedup 을 남기지 않는다 (웹훅 재시도 보존)', async () => {
    const { service, insertOrIgnore } = buildService('REQUIRES_ACTION', {
      reQueryError: { statusCode: 500, code: 'TOSS_5XX' },
    });

    await expect(service.handle(depositWebhook())).rejects.toThrow();
    expect(insertOrIgnore).not.toHaveBeenCalled();
  });
});

describe('TossWebhookService — 기존 동작 회귀', () => {
  it('취소된 charge 에 실제 입금이 들어오면 FAILED 로 흔적을 남긴다', async () => {
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

  it('REQUIRES_ACTION charge 의 정상 입금은 승인한다', async () => {
    const { service, updateStatus, finalizeApproval } = buildService('REQUIRES_ACTION');

    await service.handle(depositWebhook());

    expect(finalizeApproval).toHaveBeenCalled();
    expect(updateStatus).toHaveBeenCalledWith('receipt-1', 'PROCESSED', expect.anything());
  });

  it('이미 성공한 charge 는 계속 무시한다 (중복 웹훅)', async () => {
    const { service, updateStatus, finalizeApproval } = buildService('SUCCEEDED');

    await service.handle(depositWebhook());

    expect(finalizeApproval).not.toHaveBeenCalled();
    expect(updateStatus).toHaveBeenCalledWith('receipt-1', 'IGNORED_DUPLICATE');
  });
});
