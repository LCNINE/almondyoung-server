import { CancellationContextReader } from '../cancellation-context.reader';
import { RefundPolicyService } from '../refund-policy.service';
import type { SubscriptionContractReader } from '../subscription-contract.reader';
import type { BenefitReader } from '../../benefit/benefit.reader';
import type { PauseReader } from '../../pause/pause.reader';
import type { PaymentClientService } from '../../billing/payment-client.service';

type Params = Parameters<CancellationContextReader['resolvePaidPeriodStart']>;

describe('CancellationContextReader.resolvePaidPeriodStart 이어받기 계약', () => {
  const findLastChargeSuccessAt = jest.fn();
  const isGrantTakeoverContract = jest.fn();

  // 이 메서드가 쓰는 reader 메서드만 채운 부분 목 (나머지 협력자는 호출되지 않는다)
  const contractReader = { findLastChargeSuccessAt, isGrantTakeoverContract } as unknown as SubscriptionContractReader;
  const reader = new CancellationContextReader(
    contractReader,
    {} as BenefitReader,
    {} as PauseReader,
    {} as PaymentClientService,
    new RefundPolicyService(),
  );

  // 테스트가 읽는 필드만 채운 계약/플랜 픽스처
  const contractOf = (o: Record<string, unknown>) => ({ id: 'c1', ...o }) as unknown as Params[0];
  const plan = { durationDays: 30 } as unknown as Params[1];
  const entitlement = { startsAt: '2026-10-26', endsAt: '2026-12-15' };

  beforeEach(() => {
    jest.resetAllMocks();
    isGrantTakeoverContract.mockResolvedValue(true);
  });

  it('이어받기 계약은 결제일보다 billingDate 가 늦으면 billingDate 를 쓴다', async () => {
    findLastChargeSuccessAt.mockResolvedValue(new Date('2026-10-26T03:00:00Z'));
    const r = await reader.resolvePaidPeriodStart(
      contractOf({ lastPaymentIntentId: 'pi', billingDate: '2026-11-15' }),
      plan,
      entitlement,
    );
    expect(r).toEqual(new Date('2026-11-15T00:00:00Z'));
  });

  it('이어받기 계약의 인보이스 수금 전은 entitlement.startsAt 대신 billingDate 를 쓴다', async () => {
    const r = await reader.resolvePaidPeriodStart(
      contractOf({ lastPaymentIntentId: null, billingPath: 'INVOICE', billingDate: '2026-11-15' }),
      plan,
      entitlement,
    );
    expect(r).toEqual(new Date('2026-11-15T00:00:00Z'));
  });

  it('이어받기 계약이 아니면 기존 값 그대로', async () => {
    isGrantTakeoverContract.mockResolvedValue(false);
    const charged = new Date('2026-10-26T03:00:00Z');
    findLastChargeSuccessAt.mockResolvedValue(charged);
    const r = await reader.resolvePaidPeriodStart(
      contractOf({ lastPaymentIntentId: 'pi', billingDate: '2026-11-15' }),
      plan,
      entitlement,
    );
    expect(r).toEqual(charged);

    const invoice = await reader.resolvePaidPeriodStart(
      contractOf({ lastPaymentIntentId: null, billingPath: 'INVOICE', billingDate: '2026-11-15' }),
      plan,
      entitlement,
    );
    expect(invoice).toEqual(new Date('2026-10-26'));
  });

  it('갱신 결제 후에는 결제일이 더 늦으므로 결제일', async () => {
    const renewed = new Date('2026-12-15T03:00:00Z');
    findLastChargeSuccessAt.mockResolvedValue(renewed);
    const r = await reader.resolvePaidPeriodStart(
      contractOf({ lastPaymentIntentId: 'pi', billingDate: '2026-11-15' }),
      plan,
      entitlement,
    );
    expect(r).toEqual(renewed);
  });

  it('결제도 인보이스도 아니면 null 유지', async () => {
    const r = await reader.resolvePaidPeriodStart(
      contractOf({ lastPaymentIntentId: null, billingPath: 'CARD', billingDate: '2026-11-15' }),
      plan,
      entitlement,
    );
    expect(r).toBeNull();
  });
});
