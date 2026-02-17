import { BadRequestException, ConflictException } from '@nestjs/common';
import { DbService } from '@app/db';
import {
  buildSigningString,
  canonicalizeSnapshotPayload,
  computeHmacSignature,
  computePayloadHash,
  HMAC_SIGNATURE_VERSION,
} from '../domain/hmac/hmac-integrity';
import { WalletSchema, paymentIntents, paymentLegs } from '../schema';
import { ProviderRegistry } from '../providers/provider.registry';
import { CreateIntentDto } from './dto/create-intent.dto';
import { ConfigureLegsDto } from './dto/configure-legs.dto';
import { IntentsService } from './intents.service';

describe('IntentsService', () => {
  const sharedSecret = 'wallet-hmac-secret';

  let service: IntentsService;
  let db: {
    select: jest.Mock;
    transaction: jest.Mock;
  };
  let providerRegistry: {
    assertCapability: jest.Mock;
  };
  let selectResultsQueue: unknown[];

  beforeEach(() => {
    process.env.WALLET_HMAC_SHARED_SECRET = sharedSecret;
    selectResultsQueue = [];

    db = {
      select: jest.fn().mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockImplementation(() =>
                Promise.resolve((selectResultsQueue.shift() as unknown[]) ?? []),
              ),
          }),
        }),
      })),
      transaction: jest.fn(),
    };

    providerRegistry = {
      assertCapability: jest.fn().mockReturnValue({
        validateLeg: jest.fn().mockResolvedValue(undefined),
      }),
    };

    service = new IntentsService(
      {
        db,
      } as unknown as DbService<WalletSchema>,
      providerRegistry as unknown as ProviderRegistry,
    );
  });

  afterEach(() => {
    delete process.env.WALLET_HMAC_SHARED_SECRET;
  });

  it('rejects invalid signature before any DB write/read', async () => {
    const dto = createSignedCreateIntentDto({
      signatureVersion: 'v2',
    });

    await expect(service.createIntent(dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(db.select).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects already-paid reference with 409', async () => {
    selectResultsQueue.push([{ id: 'existing-succeeded-intent' }]);
    const dto = createSignedCreateIntentDto();

    await expect(service.createIntent(dto)).rejects.toBeInstanceOf(ConflictException);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('creates SUCCEEDED intent immediately for zero-amount fast path', async () => {
    selectResultsQueue.push([]);

    const createdIntent = {
      id: 'intent-1',
      referenceType: 'STORE_ORDER',
      referenceId: 'order-1',
      customerId: 'customer-1',
      currency: 'KRW',
      payableAmount: 0,
      status: 'SUCCEEDED',
      expiresAt: new Date(),
      version: 0,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const insertIntentValuesMock = jest.fn().mockReturnValue({
      returning: jest.fn().mockResolvedValue([createdIntent]),
    });
    const insertTransitionValuesMock = jest.fn().mockResolvedValue(undefined);
    const txInsertMock = jest.fn((table) => {
      if (table === paymentIntents) {
        return {
          values: insertIntentValuesMock,
        };
      }

      return {
        values: insertTransitionValuesMock,
      };
    });

    db.transaction.mockImplementation(
      async (callback: (tx: { insert: typeof txInsertMock }) => unknown) =>
        callback({
          insert: txInsertMock,
        }),
    );

    const dto = createSignedCreateIntentDto({
      payableAmount: 0,
    });

    const result = await service.createIntent(dto, 'corr-fast-path');

    expect(result.status).toBe('SUCCEEDED');
    expect(insertIntentValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'SUCCEEDED',
        payableAmount: 0,
      }),
    );
    expect(insertTransitionValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        newStatus: 'SUCCEEDED',
        correlationId: 'corr-fast-path',
      }),
    );
  });

  it('configures legs after provider capability and amount checks', async () => {
    selectResultsQueue.push([
      {
        id: 'intent-1',
        customerId: 'customer-1',
        currency: 'KRW',
        payableAmount: 10000,
        status: 'PENDING',
      },
    ]);

    const insertedLegRows = [
      {
        id: 'leg-1',
        intentId: 'intent-1',
        providerType: 'POINTS',
        amount: 7000,
        status: 'READY',
        isRequired: true,
        sequenceNo: 1,
        version: 0,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'leg-2',
        intentId: 'intent-1',
        providerType: 'POINTS',
        amount: 3000,
        status: 'READY',
        isRequired: true,
        sequenceNo: 2,
        version: 0,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    let legInsertIndex = 0;
    const insertTransitionValuesMock = jest.fn().mockResolvedValue(undefined);
    const txInsertMock = jest.fn((table) => {
      if (table === paymentLegs) {
        return {
          values: jest.fn().mockReturnValue({
            returning: jest
              .fn()
              .mockImplementation(async () => [insertedLegRows[legInsertIndex++]]),
          }),
        };
      }

      return {
        values: insertTransitionValuesMock,
      };
    });
    const txDeleteWhereMock = jest.fn().mockResolvedValue(undefined);
    const txDeleteMock = jest.fn().mockReturnValue({
      where: txDeleteWhereMock,
    });

    db.transaction.mockImplementation(
      async (
        callback: (tx: {
          delete: typeof txDeleteMock;
          insert: typeof txInsertMock;
        }) => unknown,
      ) =>
        callback({
          delete: txDeleteMock,
          insert: txInsertMock,
        }),
    );

    const dto: ConfigureLegsDto = {
      legs: [
        { providerType: 'points', amount: 7000, sequenceNo: 1, isRequired: true },
        { providerType: 'POINTS', amount: 3000, sequenceNo: 2, isRequired: true },
      ],
    };

    const result = await service.configureLegs('intent-1', dto, 'corr-legs');

    expect(result).toHaveLength(2);
    expect(result[0].sequenceNo).toBe(1);
    expect(providerRegistry.assertCapability).toHaveBeenCalledTimes(2);
    expect(txDeleteWhereMock).toHaveBeenCalledTimes(1);
    expect(insertTransitionValuesMock).toHaveBeenCalledTimes(2);
  });

  it('rejects leg configuration when amount sum mismatches payable amount', async () => {
    selectResultsQueue.push([
      {
        id: 'intent-1',
        customerId: 'customer-1',
        currency: 'KRW',
        payableAmount: 10000,
        status: 'PENDING',
      },
    ]);

    const dto: ConfigureLegsDto = {
      legs: [{ providerType: 'POINTS', amount: 9000, sequenceNo: 1, isRequired: true }],
    };

    await expect(service.configureLegs('intent-1', dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects leg configuration for zero-amount intent', async () => {
    selectResultsQueue.push([
      {
        id: 'intent-1',
        customerId: 'customer-1',
        currency: 'KRW',
        payableAmount: 0,
        status: 'SUCCEEDED',
      },
    ]);

    const dto: ConfigureLegsDto = {
      legs: [{ providerType: 'POINTS', amount: 1, sequenceNo: 1, isRequired: true }],
    };

    await expect(service.configureLegs('intent-1', dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects when provider capability is not supported', async () => {
    selectResultsQueue.push([
      {
        id: 'intent-1',
        customerId: 'customer-1',
        currency: 'KRW',
        payableAmount: 10000,
        status: 'PENDING',
      },
    ]);
    providerRegistry.assertCapability.mockImplementation(() => {
      throw new BadRequestException({
        error: 'PROVIDER_CAPABILITY_NOT_SUPPORTED',
        message: 'Provider POINTS does not support AUTHORIZE',
      });
    });

    const dto: ConfigureLegsDto = {
      legs: [{ providerType: 'POINTS', amount: 10000, sequenceNo: 1, isRequired: true }],
    };

    await expect(service.configureLegs('intent-1', dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(db.transaction).not.toHaveBeenCalled();
  });
});

function createSignedCreateIntentDto(
  override?: Partial<CreateIntentDto>,
): CreateIntentDto {
  const snapshotPayload = {
    orderId: 'order-1',
    lineItems: [{ sku: 'SKU-1', quantity: 1 }],
    totalAmount: override?.payableAmount ?? 10000,
  };
  const signatureVersion = override?.signatureVersion ?? HMAC_SIGNATURE_VERSION;
  const signedAt = override?.signedAt ?? new Date().toISOString();
  const canonicalPayload = canonicalizeSnapshotPayload(snapshotPayload);
  const payloadHash = computePayloadHash(canonicalPayload);
  const signingString = buildSigningString(signatureVersion, signedAt, payloadHash);
  const signature = computeHmacSignature('wallet-hmac-secret', signingString);

  return {
    referenceType: override?.referenceType ?? 'STORE_ORDER',
    referenceId: override?.referenceId ?? 'order-1',
    customerId: override?.customerId ?? 'customer-1',
    currency: override?.currency ?? 'KRW',
    payableAmount: override?.payableAmount ?? 10000,
    snapshotPayload,
    signature,
    signatureVersion,
    signedAt,
    metadata: override?.metadata,
  };
}
