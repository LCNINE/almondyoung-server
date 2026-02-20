import { BadRequestException } from '@nestjs/common';
import { PointsPaymentProvider } from './points.provider';
import { PointsLedgerService } from './points-ledger.service';
import { DbService } from '@app/db';
import { WalletSchema } from '../../schema';
import {
  ProviderOperationResult,
  ProviderTransactionSnapshot,
} from '../payment-provider.types';

describe('PointsPaymentProvider', () => {
  let provider: PointsPaymentProvider;
  let pointsLedgerService: jest.Mocked<PointsLedgerService>;
  let dbService: DbService<WalletSchema>;

  beforeEach(() => {
    pointsLedgerService = {
      authorize: jest.fn(),
      capture: jest.fn(),
      cancel: jest.fn(),
      refund: jest.fn(),
      getTransaction: jest.fn(),
    } as unknown as jest.Mocked<PointsLedgerService>;

    dbService = {
      db: {
        transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
          fn({} as unknown),
        ),
      },
    } as unknown as DbService<WalletSchema>;

    provider = new PointsPaymentProvider(dbService, pointsLedgerService);
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
          userId: 'customer-1',
          idempotencyKey: 'wallet:test:intent-1:leg-1:manual-confirm',
          correlationId: 'corr-1',
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('executes authorize via unified execute command', async () => {
    const mockedResult: ProviderOperationResult = {
      resultStatus: 'AUTHORIZED',
      providerTransactionId: 'hold-1',
      raw: { providerType: 'POINTS' },
    };
    pointsLedgerService.authorize.mockResolvedValueOnce(mockedResult);

    const result = await provider.execute({
      op: 'AUTHORIZE',
      params: {
        intentId: 'intent-1',
        legId: 'leg-1',
        amount: 1000,
        currency: 'KRW',
        userId: 'customer-1',
        idempotencyKey: 'wallet:test:intent-1:leg-1:authorize',
        correlationId: 'corr-1',
      },
    });

    expect(result.resultStatus).toBe('AUTHORIZED');
    expect(result.providerTransactionId).toBe('hold-1');
    expect(pointsLedgerService.authorize).toHaveBeenCalledTimes(1);
  });

  it('validates leg currency and amount', async () => {
    await expect(
      provider.validateLeg({
        intentId: 'intent-1',
        userId: 'customer-1',
        amount: 0,
        currency: 'KRW',
        sequenceNo: 1,
        isRequired: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      provider.validateLeg({
        intentId: 'intent-1',
        userId: 'customer-1',
        amount: 1000,
        currency: 'USD',
        sequenceNo: 1,
        isRequired: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('delegates polling to points ledger service', async () => {
    const snapshot: ProviderTransactionSnapshot = {
      providerTransactionId: 'tx-1',
      status: 'CAPTURED',
      raw: { providerType: 'POINTS' },
    };
    pointsLedgerService.getTransaction.mockResolvedValueOnce(snapshot);

    const result = await provider.getTransaction({
      intentId: 'intent-1',
      legId: 'leg-1',
      correlationId: 'corr-1',
    });

    expect(result.status).toBe('CAPTURED');
    expect(pointsLedgerService.getTransaction).toHaveBeenCalledTimes(1);
  });
});
