import { CancellationContextReader } from '../cancellation-context.reader';
import { RefundPolicyService, isWithdrawalEligible } from '../refund-policy.service';
import type { SubscriptionContractReader } from '../subscription-contract.reader';
import type { BenefitReader } from '../../benefit/benefit.reader';
import type { PauseReader } from '../../pause/pause.reader';
import type { PaymentClientService } from '../../billing/payment-client.service';
import { NO_BENEFIT_USAGE } from '../../benefit/benefit-usage';

type Params = Parameters<CancellationContextReader['resolvePaidPeriodStart']>;

describe('CancellationContextReader.resolvePaidPeriodStart 인보이스 선지급 주기', () => {
  const findLastChargeSuccessAt = jest.fn();
  const isGrantTakeoverContract = jest.fn();
  const findLatestInvoiceGrantPeriodEnd = jest.fn();

  const contractReader = {
    findLastChargeSuccessAt,
    isGrantTakeoverContract,
    findLatestInvoiceGrantPeriodEnd,
  } as unknown as SubscriptionContractReader;
  const reader = new CancellationContextReader(
    contractReader,
    {} as BenefitReader,
    {} as PauseReader,
    {} as PaymentClientService,
    new RefundPolicyService(),
  );

  const contractOf = (o: Record<string, unknown>) =>
    ({ id: 'c1', lastPaymentIntentId: 'pi', billingDate: '2026-10-01', ...o }) as unknown as Params[0];
  const plan = { durationDays: 30 } as unknown as Params[1];
  const firstSignupEntitlement = { startsAt: '2026-10-01', endsAt: '2026-12-04' };

  beforeEach(() => {
    jest.resetAllMocks();
    isGrantTakeoverContract.mockResolvedValue(false);
  });

  it('출금이 늦게 확정돼도 선지급한 주기의 시작부터 센다', async () => {
    findLastChargeSuccessAt.mockResolvedValue(new Date('2026-11-08T22:30:08Z'));
    findLatestInvoiceGrantPeriodEnd.mockResolvedValue('2026-12-04');

    const start = await reader.resolvePaidPeriodStart(
      contractOf({ billingPath: 'INVOICE' }),
      plan,
      firstSignupEntitlement,
    );

    expect(start).toEqual(new Date('2026-11-04T00:00:00Z'));
  });

  it('갱신 달은 첫 가입일이 아니라 그 달 주기의 시작부터 센다', async () => {
    findLastChargeSuccessAt.mockResolvedValue(new Date('2026-11-03T22:30:14Z'));
    findLatestInvoiceGrantPeriodEnd.mockResolvedValue('2026-11-30');

    const start = await reader.resolvePaidPeriodStart(
      contractOf({ billingPath: 'INVOICE' }),
      plan,
      firstSignupEntitlement,
    );

    expect(start).toEqual(new Date('2026-10-31T00:00:00Z'));
  });

  it('다음 주기를 선지급만 하고 아직 출금 전이면 마지막 결제 시각을 그대로 쓴다', async () => {
    const charged = new Date('2026-11-08T22:30:08Z');
    findLastChargeSuccessAt.mockResolvedValue(charged);
    findLatestInvoiceGrantPeriodEnd.mockResolvedValue('2027-01-03');

    const start = await reader.resolvePaidPeriodStart(
      contractOf({ billingPath: 'INVOICE' }),
      plan,
      firstSignupEntitlement,
    );

    expect(start).toEqual(charged);
  });

  it('선지급 기록이 없으면 마지막 결제 시각을 쓴다', async () => {
    const charged = new Date('2026-11-08T22:30:08Z');
    findLastChargeSuccessAt.mockResolvedValue(charged);
    findLatestInvoiceGrantPeriodEnd.mockResolvedValue(null);

    const start = await reader.resolvePaidPeriodStart(
      contractOf({ billingPath: 'INVOICE' }),
      plan,
      firstSignupEntitlement,
    );

    expect(start).toEqual(charged);
  });

  it('즉시 청구 경로는 결제 시각 그대로다', async () => {
    const charged = new Date('2026-11-08T22:30:08Z');
    findLastChargeSuccessAt.mockResolvedValue(charged);

    const start = await reader.resolvePaidPeriodStart(
      contractOf({ billingPath: 'CHARGE' }),
      plan,
      firstSignupEntitlement,
    );

    expect(start).toEqual(charged);
    expect(findLatestInvoiceGrantPeriodEnd).not.toHaveBeenCalled();
  });
});

describe('인보이스 주기 시작 기준의 청약철회 판정', () => {
  it('주기 시작부터 10일이 지나면 출금 뒤 5일이어도 창이 닫혀 있다', () => {
    expect(
      isWithdrawalEligible({
        periodStart: new Date('2026-11-04T00:00:00Z'),
        now: new Date('2026-11-13T15:36:57Z'),
        usage: NO_BENEFIT_USAGE,
      }),
    ).toBe(false);
  });

  it('주기 시작 3일 안에 혜택 없이 해지하면 전액 환불이다', () => {
    expect(
      isWithdrawalEligible({
        periodStart: new Date('2026-10-18T00:00:00Z'),
        now: new Date('2026-10-21T01:13:43Z'),
        usage: NO_BENEFIT_USAGE,
      }),
    ).toBe(true);
  });
});
