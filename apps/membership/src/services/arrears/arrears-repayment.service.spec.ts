import { ARREARS_SETTLEMENT_MISMATCH, ArrearsRepaymentService } from './arrears-repayment.service';
import { ArrearsManager, SettlementTargetRow } from './arrears.manager';
import { ArrearsReader, ArrearsRow } from './arrears.reader';
import { PaymentClientService } from '../billing/payment-client.service';
import { ContractEventManager } from '../subscription/contract-event.manager';
import { MEMBERSHIP_PAYMENT_KIND_ARREARS, MEMBERSHIP_PAYMENT_KIND_FIELD } from './arrears-payment.metadata';

function row(overrides: Partial<ArrearsRow> = {}): ArrearsRow {
  return {
    id: 'a1',
    userId: 'u1',
    contractId: 'c1',
    invoiceRef: 'inv-1',
    cause: 'UNCOLLECTIBLE',
    causeCode: 'Q201',
    amount: 4990,
    currency: 'KRW',
    amountSource: 'INVOICE',
    periodStart: '2026-08-01',
    periodEnd: '2026-08-31',
    status: 'OUTSTANDING',
    settlementRef: null,
    settledAt: null,
    settledBy: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function target(overrides: Partial<SettlementTargetRow> = {}): SettlementTargetRow {
  return { id: 'a1', contractId: 'c1', amount: 4990, status: 'OUTSTANDING', settlementRef: null, ...overrides };
}

const openTargets = [target({ id: 'a1', amount: 4990 }), target({ id: 'a2', amount: 4990 })];

function makeService(
  rows: ArrearsRow[],
  options: { storefrontUrl?: string; marks?: { intentIds: string[]; unmarked: number } } = {},
) {
  const findOutstandingByUserId = jest.fn().mockResolvedValue(rows);
  const outstandingSummary = jest.fn().mockResolvedValue({
    total: rows.reduce((s, r) => s + r.amount, 0),
    count: rows.length,
    currency: rows[0]?.currency ?? 'KRW',
  });
  const pendingIntentMarks = jest
    .fn()
    .mockResolvedValue(options.marks ?? { intentIds: [], unmarked: rows.length });
  const settleMany = jest.fn().mockResolvedValue(rows.map((r) => r.id));
  const lockSettlementTargets = jest.fn().mockResolvedValue(openTargets);
  const markPendingIntent = jest.fn().mockResolvedValue(rows.length);
  const createArrearsCheckoutIntent = jest.fn().mockResolvedValue({ intentId: 'i1' });
  const getWalletPaymentIntent = jest.fn();
  const getWalletPaymentIntentOrNull = jest.fn().mockResolvedValue(null);
  const addEvent = jest.fn().mockResolvedValue(undefined);
  const tx = {};
  const db = { transaction: jest.fn().mockImplementation((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))) };

  const service = new ArrearsRepaymentService(
    { db } as never,
    { findOutstandingByUserId, outstandingSummary, pendingIntentMarks } as unknown as ArrearsReader,
    { settleMany, lockSettlementTargets, markPendingIntent } as unknown as ArrearsManager,
    {
      createArrearsCheckoutIntent,
      getWalletPaymentIntent,
      getWalletPaymentIntentOrNull,
    } as unknown as PaymentClientService,
    { addEvent } as unknown as ContractEventManager,
    { get: () => options.storefrontUrl } as never,
  );

  return {
    service,
    findOutstandingByUserId,
    pendingIntentMarks,
    settleMany,
    lockSettlementTargets,
    markPendingIntent,
    createArrearsCheckoutIntent,
    getWalletPaymentIntent,
    getWalletPaymentIntentOrNull,
    addEvent,
    tx,
  };
}

const arrearsIntent = (overrides: Record<string, unknown> = {}) => ({
  id: 'i1',
  status: 'CAPTURED',
  payableAmount: 9980,
  createdAt: '2026-09-10T00:00:00.000Z',
  metadata: {
    type: 'MEMBERSHIP_FEE',
    [MEMBERSHIP_PAYMENT_KIND_FIELD]: MEMBERSHIP_PAYMENT_KIND_ARREARS,
    userId: 'u1',
    arrearsIds: ['a1', 'a2'],
  },
  ...overrides,
});

/** 아직 낼 수 있는(무통장 입금 대기) 청산 결제. 금액·대상이 아래 두 줄과 맞는다. */
const liveIntent = (overrides: Record<string, unknown> = {}) =>
  arrearsIntent({ status: 'AWAITING_DEPOSIT', payableAmount: 9990, ...overrides });

const twoRows = [row({ id: 'a1', amount: 4990 }), row({ id: 'a2', amount: 5000 })];

describe('ArrearsRepaymentService — 청산 결제 시작', () => {
  it('금액을 원장에서 더하고 대상 id 를 전부 싣는다', async () => {
    const { service, createArrearsCheckoutIntent, markPendingIntent } = makeService(twoRows);

    const result = await service.startRepayment('u1', 'https://shop/return');

    expect(result).toEqual({ intentId: 'i1', amount: 9990, currency: 'KRW', arrearsIds: ['a1', 'a2'] });
    expect(createArrearsCheckoutIntent).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', amount: 9990, currency: 'KRW', arrearsIds: ['a1', 'a2'] }),
    );
    expect(markPendingIntent).toHaveBeenCalledWith('u1', ['a1', 'a2'], 'i1');
  });

  it('returnUrl 이 주소 형식이 아니면 결제를 만들지 않는다', async () => {
    const { service, createArrearsCheckoutIntent } = makeService([row()]);

    await expect(service.startRepayment('u1', '/mypage/membership')).rejects.toThrow('returnUrl');
    expect(createArrearsCheckoutIntent).not.toHaveBeenCalled();
  });

  it('http(s) 가 아닌 스킴은 설정이 없어도 막는다', async () => {
    const { service, createArrearsCheckoutIntent } = makeService([row()]);

    await expect(service.startRepayment('u1', 'javascript:alert(1)')).rejects.toThrow('returnUrl');
    expect(createArrearsCheckoutIntent).not.toHaveBeenCalled();
  });

  it('쇼핑몰 주소를 아는 환경에서는 다른 출처로 돌려보내지 않는다', async () => {
    const { service, createArrearsCheckoutIntent } = makeService([row()], {
      storefrontUrl: 'https://shop.example.com',
    });

    await expect(service.startRepayment('u1', 'https://evil.example.net/steal')).rejects.toThrow('returnUrl');
    expect(createArrearsCheckoutIntent).not.toHaveBeenCalled();

    await expect(service.startRepayment('u1', 'https://shop.example.com/kr/mypage/membership')).resolves.toBeDefined();
  });

  it('미수가 없으면 결제를 만들지 않는다', async () => {
    const { service, createArrearsCheckoutIntent } = makeService([]);

    await expect(service.startRepayment('u1', 'https://shop/return')).rejects.toThrow('청산할 미수가 없습니다.');
    expect(createArrearsCheckoutIntent).not.toHaveBeenCalled();
  });

  it('통화가 섞이면 합치지 않고 막는다', async () => {
    const { service, createArrearsCheckoutIntent } = makeService([
      row({ id: 'a1', currency: 'KRW' }),
      row({ id: 'a2', currency: 'USD' }),
    ]);

    await expect(service.startRepayment('u1', 'https://shop/return')).rejects.toThrow('통화가 다른 미수');
    expect(createArrearsCheckoutIntent).not.toHaveBeenCalled();
  });
});

describe('ArrearsRepaymentService — 연타해도 결제는 하나', () => {
  it('직전 결제가 아직 살아 있으면 그것을 돌려주고 새로 만들지 않는다', async () => {
    const { service, createArrearsCheckoutIntent, getWalletPaymentIntentOrNull } = makeService(twoRows, {
      marks: { intentIds: ['i-live'], unmarked: 0 },
    });
    getWalletPaymentIntentOrNull.mockResolvedValue(liveIntent({ id: 'i-live' }));

    const result = await service.startRepayment('u1', 'https://shop/return');

    expect(result.intentId).toBe('i-live');
    expect(createArrearsCheckoutIntent).not.toHaveBeenCalled();
  });

  it('취소·만료된 결제는 다시 쓰지 않는다', async () => {
    const canceled = makeService(twoRows, { marks: { intentIds: ['i-dead'], unmarked: 0 } });
    canceled.getWalletPaymentIntentOrNull.mockResolvedValue(liveIntent({ id: 'i-dead', status: 'CANCELED' }));
    await canceled.service.startRepayment('u1', 'https://shop/return');
    expect(canceled.createArrearsCheckoutIntent).toHaveBeenCalledTimes(1);

    const expired = makeService(twoRows, { marks: { intentIds: ['i-old'], unmarked: 0 } });
    expired.getWalletPaymentIntentOrNull.mockResolvedValue(
      liveIntent({ id: 'i-old', expiresAt: '2020-01-01T00:00:00.000Z' }),
    );
    await expired.service.startRepayment('u1', 'https://shop/return');
    expect(expired.createArrearsCheckoutIntent).toHaveBeenCalledTimes(1);
  });

  it('wallet 에 그 결제가 없으면 새로 만든다', async () => {
    const { service, createArrearsCheckoutIntent, getWalletPaymentIntentOrNull } = makeService(twoRows, {
      marks: { intentIds: ['i-gone'], unmarked: 0 },
    });
    getWalletPaymentIntentOrNull.mockResolvedValue(null);

    await service.startRepayment('u1', 'https://shop/return');

    expect(createArrearsCheckoutIntent).toHaveBeenCalledTimes(1);
  });

  it('결제 뒤에 미수가 더 생겼으면(표식 없는 줄) 옛 결제를 쓰지 않는다', async () => {
    const { service, createArrearsCheckoutIntent, getWalletPaymentIntentOrNull } = makeService(twoRows, {
      marks: { intentIds: ['i-live'], unmarked: 1 },
    });

    await service.startRepayment('u1', 'https://shop/return');

    expect(getWalletPaymentIntentOrNull).not.toHaveBeenCalled();
    expect(createArrearsCheckoutIntent).toHaveBeenCalledTimes(1);
  });

  it('금액이 달라졌으면(관리자 조정) 옛 결제를 쓰지 않는다', async () => {
    const { service, createArrearsCheckoutIntent, getWalletPaymentIntentOrNull } = makeService(twoRows, {
      marks: { intentIds: ['i-live'], unmarked: 0 },
    });
    getWalletPaymentIntentOrNull.mockResolvedValue(liveIntent({ id: 'i-live', payableAmount: 4990 }));

    await service.startRepayment('u1', 'https://shop/return');

    expect(createArrearsCheckoutIntent).toHaveBeenCalledTimes(1);
  });

  it('wallet 에 못 물어보면 결제를 하나 더 만들지 않고 실패한다', async () => {
    const { service, createArrearsCheckoutIntent, getWalletPaymentIntentOrNull } = makeService(twoRows, {
      marks: { intentIds: ['i-live'], unmarked: 0 },
    });
    getWalletPaymentIntentOrNull.mockRejectedValue(new Error('Wallet payment intent retrieval failed'));

    await expect(service.startRepayment('u1', 'https://shop/return')).rejects.toThrow();
    expect(createArrearsCheckoutIntent).not.toHaveBeenCalled();
  });

  it('표식을 못 남겨도 결제는 살린다', async () => {
    const { service, markPendingIntent } = makeService(twoRows);
    markPendingIntent.mockRejectedValue(new Error('db down'));

    await expect(service.startRepayment('u1', 'https://shop/return')).resolves.toMatchObject({ intentId: 'i1' });
  });
});

describe('ArrearsRepaymentService — 입금 확인 후 청산', () => {
  it('CAPTURED 면 metadata 의 대상만, 소유자 조건과 함께 닫는다', async () => {
    const { service, settleMany, getWalletPaymentIntent, tx } = makeService([]);
    getWalletPaymentIntent.mockResolvedValue(arrearsIntent());
    settleMany.mockResolvedValue(['a1', 'a2']);

    await service.settleFromCapturedIntent('i1');

    expect(settleMany).toHaveBeenCalledWith(tx, 'u1', ['a1', 'a2'], 'intent:i1');
  });

  it('아직 입금 전(CAPTURED 아님)이면 원장을 건드리지 않는다', async () => {
    const { service, settleMany, getWalletPaymentIntent } = makeService([]);
    getWalletPaymentIntent.mockResolvedValue(arrearsIntent({ status: 'AUTHORIZED' }));

    await service.settleFromCapturedIntent('i1');

    expect(settleMany).not.toHaveBeenCalled();
  });

  it('미수 청산 결제가 아니면 아무것도 안 한다', async () => {
    const { service, settleMany, getWalletPaymentIntent } = makeService([]);
    getWalletPaymentIntent.mockResolvedValue(
      arrearsIntent({ metadata: { type: 'MEMBERSHIP_FEE', userId: 'u1', planId: 'p1' } }),
    );

    await service.settleFromCapturedIntent('i1');

    expect(settleMany).not.toHaveBeenCalled();
  });

  it('metadata 에 대상 목록이 없으면 청산하지 않는다', async () => {
    const { service, settleMany, getWalletPaymentIntent } = makeService([]);
    getWalletPaymentIntent.mockResolvedValue(
      arrearsIntent({
        metadata: {
          type: 'MEMBERSHIP_FEE',
          [MEMBERSHIP_PAYMENT_KIND_FIELD]: MEMBERSHIP_PAYMENT_KIND_ARREARS,
          userId: 'u1',
        },
      }),
    );

    await service.settleFromCapturedIntent('i1');

    expect(settleMany).not.toHaveBeenCalled();
  });

  it('수납액이 미수보다 적으면 한 줄도 닫지 않고, 사람이 볼 이벤트를 남긴다', async () => {
    const { service, settleMany, getWalletPaymentIntent, addEvent, tx } = makeService([]);
    getWalletPaymentIntent.mockResolvedValue(arrearsIntent({ payableAmount: 4990 }));

    await service.settleFromCapturedIntent('i1');

    expect(settleMany).not.toHaveBeenCalled();
    expect(addEvent).toHaveBeenCalledWith(
      tx,
      'c1',
      ARREARS_SETTLEMENT_MISMATCH,
      expect.objectContaining({ reason: 'UNDERPAID', intentId: 'i1', paid: 4990, due: 9980 }),
      'SYSTEM',
      'u1',
    );
  });

  it('수납액이 더 많으면 청산은 진행하고, 차액을 이벤트로 남긴다', async () => {
    const { service, settleMany, getWalletPaymentIntent, addEvent } = makeService([]);
    getWalletPaymentIntent.mockResolvedValue(arrearsIntent({ payableAmount: 20000 }));
    settleMany.mockResolvedValue(['a1', 'a2']);

    await service.settleFromCapturedIntent('i1');

    expect(settleMany).toHaveBeenCalled();
    expect(addEvent).toHaveBeenCalledWith(
      expect.anything(),
      'c1',
      ARREARS_SETTLEMENT_MISMATCH,
      expect.objectContaining({ reason: 'OVERPAID' }),
      'SYSTEM',
      'u1',
    );
  });

  it('결제 전에 면제됐으면 돈이 갈 곳이 없다 — 이벤트를 남긴다', async () => {
    const { service, settleMany, lockSettlementTargets, getWalletPaymentIntent, addEvent } = makeService([]);
    getWalletPaymentIntent.mockResolvedValue(arrearsIntent());
    lockSettlementTargets.mockResolvedValue([
      target({ id: 'a1', status: 'WAIVED', settlementRef: '고객 사정' }),
      target({ id: 'a2', status: 'WAIVED', settlementRef: '고객 사정' }),
    ]);

    await service.settleFromCapturedIntent('i1');

    expect(settleMany).not.toHaveBeenCalled();
    expect(addEvent).toHaveBeenCalledWith(
      expect.anything(),
      'c1',
      ARREARS_SETTLEMENT_MISMATCH,
      expect.objectContaining({ reason: 'NO_OPEN_ARREARS', paid: 9980, due: 0 }),
      'SYSTEM',
      'u1',
    );
  });

  it('같은 이벤트가 두 번 와도 두 번째는 조용히 끝난다', async () => {
    const { service, settleMany, lockSettlementTargets, getWalletPaymentIntent, addEvent } = makeService([]);
    getWalletPaymentIntent.mockResolvedValue(arrearsIntent());
    settleMany.mockResolvedValueOnce(['a1', 'a2']).mockResolvedValueOnce([]);
    // 두 번째 배달 시점엔 이 결제가 이미 닫아 둔 상태다.
    lockSettlementTargets.mockResolvedValueOnce(openTargets).mockResolvedValueOnce([
      target({ id: 'a1', status: 'SETTLED', settlementRef: 'intent:i1' }),
      target({ id: 'a2', status: 'SETTLED', settlementRef: 'intent:i1' }),
    ]);

    await service.settleFromCapturedIntent('i1');
    await expect(service.settleFromCapturedIntent('i1')).resolves.toBeUndefined();
    expect(addEvent).not.toHaveBeenCalled();
  });

  it('지목된 줄이 하나도 없으면 붙일 계약이 없어 이벤트를 남기지 않는다', async () => {
    const { service, lockSettlementTargets, getWalletPaymentIntent, addEvent } = makeService([]);
    getWalletPaymentIntent.mockResolvedValue(arrearsIntent());
    lockSettlementTargets.mockResolvedValue([]);

    await service.settleFromCapturedIntent('i1');

    expect(addEvent).not.toHaveBeenCalled();
  });
});
