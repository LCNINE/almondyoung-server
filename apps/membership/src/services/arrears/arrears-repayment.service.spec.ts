import { ArrearsRepaymentService } from './arrears-repayment.service';
import { ArrearsManager } from './arrears.manager';
import { ArrearsReader, ArrearsRow } from './arrears.reader';
import { PaymentClientService } from '../billing/payment-client.service';
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

function makeService(rows: ArrearsRow[], storefrontUrl?: string) {
  const findOutstandingByUserId = jest.fn().mockResolvedValue(rows);
  const outstandingSummary = jest.fn().mockResolvedValue({
    total: rows.reduce((s, r) => s + r.amount, 0),
    count: rows.length,
    currency: rows[0]?.currency ?? 'KRW',
  });
  const settleMany = jest.fn().mockResolvedValue(rows.map((r) => r.id));
  const lockOutstandingSum = jest.fn().mockResolvedValue(rows.reduce((s, r) => s + r.amount, 0));
  const createArrearsCheckoutIntent = jest.fn().mockResolvedValue({ intentId: 'i1' });
  const getWalletPaymentIntent = jest.fn();
  const tx = {};
  const db = { transaction: jest.fn().mockImplementation((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))) };

  const service = new ArrearsRepaymentService(
    { db } as never,
    { findOutstandingByUserId, outstandingSummary } as unknown as ArrearsReader,
    { settleMany, lockOutstandingSum } as unknown as ArrearsManager,
    { createArrearsCheckoutIntent, getWalletPaymentIntent } as unknown as PaymentClientService,
    { get: () => storefrontUrl } as never,
  );

  return {
    service,
    findOutstandingByUserId,
    settleMany,
    lockOutstandingSum,
    createArrearsCheckoutIntent,
    getWalletPaymentIntent,
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

describe('ArrearsRepaymentService — 청산 결제 시작', () => {
  it('금액을 원장에서 더하고 대상 id 를 전부 싣는다', async () => {
    const { service, createArrearsCheckoutIntent } = makeService([
      row({ id: 'a1', amount: 4990 }),
      row({ id: 'a2', amount: 5000 }),
    ]);

    const result = await service.startRepayment('u1', 'https://shop/return');

    expect(result).toEqual({ intentId: 'i1', amount: 9990, currency: 'KRW', arrearsIds: ['a1', 'a2'] });
    expect(createArrearsCheckoutIntent).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', amount: 9990, currency: 'KRW', arrearsIds: ['a1', 'a2'] }),
    );
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
    const { service, createArrearsCheckoutIntent } = makeService([row()], 'https://shop.example.com');

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

describe('ArrearsRepaymentService — 입금 확인 후 청산', () => {
  it('CAPTURED 면 metadata 의 대상만, 소유자 조건과 함께 닫는다', async () => {
    const { service, settleMany, lockOutstandingSum, getWalletPaymentIntent, tx } = makeService([]);
    getWalletPaymentIntent.mockResolvedValue(arrearsIntent());
    lockOutstandingSum.mockResolvedValue(9980);
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

  it('수납액이 미수보다 적으면 한 줄도 닫지 않는다', async () => {
    const { service, settleMany, lockOutstandingSum, getWalletPaymentIntent } = makeService([]);
    getWalletPaymentIntent.mockResolvedValue(arrearsIntent({ payableAmount: 4990 }));
    lockOutstandingSum.mockResolvedValue(9980);

    await service.settleFromCapturedIntent('i1');

    expect(settleMany).not.toHaveBeenCalled();
  });

  it('수납액이 더 많으면 청산은 진행한다', async () => {
    const { service, settleMany, lockOutstandingSum, getWalletPaymentIntent } = makeService([]);
    getWalletPaymentIntent.mockResolvedValue(arrearsIntent({ payableAmount: 20000 }));
    lockOutstandingSum.mockResolvedValue(9980);
    settleMany.mockResolvedValue(['a1', 'a2']);

    await service.settleFromCapturedIntent('i1');

    expect(settleMany).toHaveBeenCalled();
  });

  it('같은 이벤트가 두 번 와도 두 번째는 조용히 끝난다', async () => {
    const { service, settleMany, lockOutstandingSum, getWalletPaymentIntent } = makeService([]);
    getWalletPaymentIntent.mockResolvedValue(arrearsIntent());
    // 두 번째 배달 시점엔 이미 닫혀 있어 대조할 빚이 없다.
    lockOutstandingSum.mockResolvedValueOnce(9980).mockResolvedValueOnce(0);
    settleMany.mockResolvedValueOnce(['a1', 'a2']).mockResolvedValueOnce([]);

    await service.settleFromCapturedIntent('i1');
    await expect(service.settleFromCapturedIntent('i1')).resolves.toBeUndefined();
  });
});
