import { BadRequestException, ConflictException } from '@nestjs/common';
import { DbService } from '@app/db';
import { buildSigningString, computeHmacSignature, computePayloadHash, HMAC_SIGNATURE_VERSION, canonicalizeSnapshotPayload } from '../domain/hmac/hmac-integrity';
import { WalletSchema, paymentIntents } from '../schema';
import { CreateIntentDto } from './dto/create-intent.dto';
import { IntentsService } from './intents.service';

describe('IntentsService', () => {
  const sharedSecret = 'wallet-hmac-secret';

  let service: IntentsService;
  let db: {
    select: jest.Mock;
    transaction: jest.Mock;
  };
  let selectLimitMock: jest.Mock;

  beforeEach(() => {
    process.env.WALLET_HMAC_SHARED_SECRET = sharedSecret;

    selectLimitMock = jest.fn().mockResolvedValue([]);
    const selectWhereMock = jest.fn().mockReturnValue({
      limit: selectLimitMock,
    });
    const selectFromMock = jest.fn().mockReturnValue({
      where: selectWhereMock,
    });

    db = {
      select: jest.fn().mockReturnValue({
        from: selectFromMock,
      }),
      transaction: jest.fn(),
    };

    service = new IntentsService({
      db,
    } as unknown as DbService<WalletSchema>);
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
    selectLimitMock.mockResolvedValue([{ id: 'existing-succeeded-intent' }]);
    const dto = createSignedCreateIntentDto();

    await expect(service.createIntent(dto)).rejects.toBeInstanceOf(ConflictException);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('creates SUCCEEDED intent immediately for zero-amount fast path', async () => {
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

    db.transaction.mockImplementation(async (callback: (tx: { insert: typeof txInsertMock }) => unknown) =>
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
