import { BadRequestException } from '@nestjs/common';
import { PointsPaymentProvider } from './points.provider';

describe('PointsPaymentProvider', () => {
  let provider: PointsPaymentProvider;

  beforeEach(() => {
    provider = new PointsPaymentProvider();
  });

  it('declares expected static capabilities', () => {
    const capabilities = provider.getStaticCapabilities();

    expect(capabilities).toContain('AUTHORIZE');
    expect(capabilities).toContain('CAPTURE');
    expect(capabilities).toContain('CANCEL');
    expect(capabilities).toContain('REFUND');
    expect(capabilities).not.toContain('MANUAL_CONFIRM');
  });

  it('rejects unsupported manual confirm operation', async () => {
    await expect(
      provider.execute({
        op: 'MANUAL_CONFIRM',
        params: {
          intentId: 'intent-1',
          legId: 'leg-1',
          amount: 1000,
          currency: 'KRW',
          customerId: 'customer-1',
          idempotencyKey: 'wallet:test:intent-1:leg-1:manual-confirm',
          correlationId: 'corr-1',
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('executes authorize via unified execute command', async () => {
    const result = await provider.execute({
      op: 'AUTHORIZE',
      params: {
        intentId: 'intent-1',
        legId: 'leg-1',
        amount: 1000,
        currency: 'KRW',
        customerId: 'customer-1',
        idempotencyKey: 'wallet:test:intent-1:leg-1:authorize',
        correlationId: 'corr-1',
      },
    });

    expect(result.resultStatus).toBe('AUTHORIZED');
    expect(result.providerTransactionId).toBe('points-auth-leg-1');
  });

  it('validates leg currency and amount', async () => {
    await expect(
      provider.validateLeg({
        intentId: 'intent-1',
        customerId: 'customer-1',
        amount: 0,
        currency: 'KRW',
        sequenceNo: 1,
        isRequired: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      provider.validateLeg({
        intentId: 'intent-1',
        customerId: 'customer-1',
        amount: 1000,
        currency: 'USD',
        sequenceNo: 1,
        isRequired: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
