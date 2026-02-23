import { BadRequestException, ConflictException } from '@nestjs/common';
import { DbService } from '@app/db';
import {
  buildSigningString,
  canonicalizeSnapshotPayload,
  computeHmacSignature,
  computePayloadHash,
  HMAC_SIGNATURE_VERSION,
} from '../domain/hmac/hmac-integrity';
import {
  WalletSchema,
  manualCancelQueueItems,
  paymentAttempts,
  paymentIntentItems,
  paymentIntents,
  paymentLegs,
} from '../schema';
import { ProviderRegistry } from '../providers/provider.registry';
import { StateTransitionService } from '../domain/state-transition/state-transition.service';
import { CreateIntentDto } from './dto/create-intent.dto';
import { ConfigureLegsDto } from './dto/configure-legs.dto';
import { IntentsService } from './intents.service';
import { IntentCreationService } from './application/intent-creation.service';
import { LegExecutionService } from './application/leg-execution.service';
import { IntentTerminationService } from './application/intent-termination.service';
import { RefundOrchestrationService } from './application/refund-orchestration.service';
import { AttemptService } from './support/attempt.service';
import { ManualActionQueueService } from './support/manual-action-queue.service';

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
  let stateTransitionService: {
    transitionIntent: jest.Mock;
    transitionLeg: jest.Mock;
    transitionAttempt: jest.Mock;
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
    stateTransitionService = {
      transitionIntent: jest.fn().mockResolvedValue(undefined),
      transitionLeg: jest.fn().mockResolvedValue(undefined),
      transitionAttempt: jest.fn().mockResolvedValue(undefined),
    };

    const dbService = {
      db,
    } as unknown as DbService<WalletSchema>;
    const typedProviderRegistry = providerRegistry as unknown as ProviderRegistry;
    const typedStateTransitionService =
      stateTransitionService as unknown as StateTransitionService;
    const attemptService = new AttemptService();
    const manualActionQueueService = new ManualActionQueueService();

    service = new IntentsService(
      new IntentCreationService(dbService, typedProviderRegistry),
      new LegExecutionService(
        dbService,
        typedProviderRegistry,
        typedStateTransitionService,
        attemptService,
      ),
      new IntentTerminationService(
        dbService,
        typedProviderRegistry,
        typedStateTransitionService,
        attemptService,
        manualActionQueueService,
      ),
      new RefundOrchestrationService(
        dbService,
        typedProviderRegistry,
        typedStateTransitionService,
        attemptService,
        manualActionQueueService,
      ),
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
    const tx = {
      execute: jest.fn().mockResolvedValue(undefined),
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockResolvedValue([{ id: 'existing-succeeded-intent' }]),
          }),
        }),
      }),
    };
    db.transaction.mockImplementationOnce(
      async (callback: (innerTx: typeof tx) => unknown) => callback(tx),
    );
    const dto = createSignedCreateIntentDto();

    await expect(service.createIntent(dto)).rejects.toBeInstanceOf(ConflictException);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('creates SUCCEEDED intent immediately for zero-amount fast path', async () => {
    const createdIntent = {
      id: 'intent-1',
      referenceType: 'STORE_ORDER',
      referenceId: 'order-1',
      userId: 'customer-1',
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
    const insertIntentItemsValuesMock = jest.fn().mockReturnValue({
      returning: jest.fn().mockResolvedValue([
        {
          id: 'intent-item-1',
          lineId: 'line-1',
        },
      ]),
    });
    const insertTransitionValuesMock = jest.fn().mockResolvedValue(undefined);
    const txInsertMock = jest.fn((table) => {
      if (table === paymentIntents) {
        return {
          values: insertIntentValuesMock,
        };
      }

      if (table === paymentIntentItems) {
        return {
          values: insertIntentItemsValuesMock,
        };
      }

      return {
        values: insertTransitionValuesMock,
      };
    });

    db.transaction.mockImplementation(
      async (
        callback: (tx: {
          execute: jest.Mock;
          select: jest.Mock;
          insert: typeof txInsertMock;
        }) => unknown,
      ) =>
        callback({
          execute: jest.fn().mockResolvedValue(undefined),
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([]),
              }),
            }),
          }),
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
        userId: 'customer-1',
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
        userId: 'customer-1',
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
        userId: 'customer-1',
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
        userId: 'customer-1',
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

  it('authorizes a READY leg and returns updated attempt/leg state', async () => {
    const providerAuthorize = jest.fn().mockResolvedValue({
      resultStatus: 'AUTHORIZED',
      providerTransactionId: 'provider-auth-1',
      providerRequestId: 'provider-req-1',
      raw: { providerType: 'POINTS' },
    });
    providerRegistry.assertCapability.mockReturnValue({
      execute: providerAuthorize,
    });

    const createdAttempt = {
      id: 'attempt-1',
      intentId: 'intent-1',
      legId: 'leg-1',
      attemptNo: 1,
      operation: 'AUTHORIZE',
      status: 'CREATED',
      providerTransactionId: null,
      providerRequestId: null,
      idempotencyKey: null,
      providerIdempotencyKey: 'wallet:test:leg-1:AUTHORIZE:1',
      errorCode: null,
      errorMessage: null,
      requestPayload: { operation: 'AUTHORIZE' },
      responsePayload: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const attemptInsertValuesMock = jest.fn().mockReturnValue({
      returning: jest.fn().mockResolvedValue([createdAttempt]),
    });
    const transitionInsertValuesMock = jest.fn().mockResolvedValue(undefined);
    const txPreInsertMock = jest.fn((table) => {
      if (table === paymentAttempts) {
        return {
          values: attemptInsertValuesMock,
        };
      }

      return {
        values: transitionInsertValuesMock,
      };
    });

    const txPre = {
      execute: jest
        .fn()
        .mockResolvedValueOnce([
          createLockedIntent({
            id: 'intent-1',
            status: 'PENDING',
            payableAmount: 10000,
            version: 0,
          }),
        ])
        .mockResolvedValueOnce([
          {
            id: 'leg-1',
            intentId: 'intent-1',
            providerType: 'POINTS',
            amount: 10000,
            status: 'READY',
            version: 0,
            metadata: {},
          },
        ]),
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([{ maxAttemptNo: 0 }]),
        }),
      }),
      insert: txPreInsertMock,
    };

    const txPostSelectQueue = [
      [
        {
          id: 'intent-1',
          referenceType: 'STORE_ORDER',
          referenceId: 'order-1',
          userId: 'customer-1',
          currency: 'KRW',
          payableAmount: 10000,
          status: 'IN_PROGRESS',
          expiresAt: new Date(),
          version: 1,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      [
        {
          id: 'leg-1',
          intentId: 'intent-1',
          providerType: 'POINTS',
          amount: 10000,
          status: 'AUTHORIZED',
          isRequired: true,
          sequenceNo: 1,
          version: 1,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      [
        {
          ...createdAttempt,
          status: 'AUTHORIZED',
          providerTransactionId: 'provider-auth-1',
          providerRequestId: 'provider-req-1',
          responsePayload: { providerType: 'POINTS' },
        },
      ],
    ];
    const txPost = {
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(undefined),
        }),
      }),
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockImplementation(async () => (txPostSelectQueue.shift() as unknown[]) ?? []),
          }),
        }),
      }),
    };

    db.transaction
      .mockImplementationOnce(
        async (callback: (tx: typeof txPre) => unknown) => callback(txPre),
      )
      .mockImplementationOnce(
        async (callback: (tx: typeof txPost) => unknown) => callback(txPost),
      );

    const result = await service.authorizeLeg('intent-1', 'leg-1', 'corr-auth-1');

    expect(providerAuthorize).toHaveBeenCalledTimes(1);
    expect(providerAuthorize).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'AUTHORIZE',
        params: expect.objectContaining({
          idempotencyKey: 'wallet:test:leg-1:AUTHORIZE:1',
        }),
      }),
    );
    expect(stateTransitionService.transitionIntent).toHaveBeenCalledTimes(1);
    expect(stateTransitionService.transitionLeg).toHaveBeenCalledTimes(2);
    expect(stateTransitionService.transitionAttempt).toHaveBeenCalledTimes(2);
    expect(result.leg.status).toBe('AUTHORIZED');
    expect(result.attempt.status).toBe('AUTHORIZED');
  });

  it('rejects capture when leg status is not AUTHORIZED', async () => {
    providerRegistry.assertCapability.mockReturnValue({
      execute: jest.fn(),
    });

    const txPre = {
      execute: jest
        .fn()
        .mockResolvedValueOnce([
          createLockedIntent({
            id: 'intent-1',
            status: 'IN_PROGRESS',
            payableAmount: 10000,
            version: 0,
          }),
        ])
        .mockResolvedValueOnce([
          {
            id: 'leg-1',
            intentId: 'intent-1',
            providerType: 'POINTS',
            amount: 10000,
            status: 'READY',
            version: 0,
            metadata: {},
          },
        ]),
    };

    db.transaction.mockImplementationOnce(
      async (callback: (tx: typeof txPre) => unknown) => callback(txPre),
    );

    await expect(
      service.captureLeg('intent-1', 'leg-1', 'corr-capture-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects capture when an active CAPTURE attempt already exists', async () => {
    const providerCapture = jest.fn().mockResolvedValue({
      resultStatus: 'CAPTURED',
      providerTransactionId: 'provider-capture-dup',
      raw: { providerType: 'POINTS' },
    });
    providerRegistry.assertCapability.mockReturnValue({
      execute: providerCapture,
    });

    const duplicateError = Object.assign(
      new Error('duplicate key value violates unique constraint'),
      {
        code: '23505',
        constraint: 'uq_payment_attempts_active_leg_operation',
      },
    );

    const txPreInsertMock = jest.fn((table) => {
      if (table === paymentAttempts) {
        return {
          values: jest.fn().mockReturnValue({
            returning: jest.fn().mockRejectedValue(duplicateError),
          }),
        };
      }

      return {
        values: jest.fn().mockResolvedValue(undefined),
      };
    });

    const txPre = {
      execute: jest
        .fn()
        .mockResolvedValueOnce([
          createLockedIntent({
            id: 'intent-1',
            status: 'IN_PROGRESS',
            payableAmount: 10000,
            version: 0,
          }),
        ])
        .mockResolvedValueOnce([
          {
            id: 'leg-1',
            intentId: 'intent-1',
            providerType: 'POINTS',
            amount: 10000,
            status: 'AUTHORIZED',
            version: 0,
            metadata: {},
          },
        ]),
      select: jest
        .fn()
        .mockImplementationOnce(() => ({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([{ maxAttemptNo: 1 }]),
          }),
        }))
        .mockImplementationOnce(() => ({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([
                {
                  id: 'attempt-active-1',
                  status: 'SENT',
                },
              ]),
            }),
          }),
        })),
      insert: txPreInsertMock,
    };

    db.transaction.mockImplementationOnce(
      async (callback: (tx: typeof txPre) => unknown) => callback(txPre),
    );

    await expect(
      service.captureLeg('intent-1', 'leg-1', 'corr-capture-duplicate'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        error: 'ACTIVE_ATTEMPT_ALREADY_EXISTS',
        attemptId: 'attempt-active-1',
      }),
    });
    expect(providerCapture).not.toHaveBeenCalled();
  });

  it('captures AUTHORIZED leg and marks intent SUCCEEDED when required legs are captured', async () => {
    const providerCapture = jest.fn().mockResolvedValue({
      resultStatus: 'CAPTURED',
      providerTransactionId: 'provider-capture-1',
      providerRequestId: 'provider-capture-req-1',
      raw: { providerType: 'POINTS' },
    });
    providerRegistry.assertCapability.mockReturnValue({
      execute: providerCapture,
    });

    const createdAttempt = {
      id: 'attempt-cap-1',
      intentId: 'intent-1',
      legId: 'leg-1',
      attemptNo: 2,
      operation: 'CAPTURE',
      status: 'CREATED',
      providerTransactionId: null,
      providerRequestId: null,
      idempotencyKey: null,
      providerIdempotencyKey: 'wallet:test:leg-1:CAPTURE:2',
      errorCode: null,
      errorMessage: null,
      requestPayload: { operation: 'CAPTURE' },
      responsePayload: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const txPreInsertMock = jest.fn((table) => {
      if (table === paymentAttempts) {
        return {
          values: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([createdAttempt]),
          }),
        };
      }

      return {
        values: jest.fn().mockResolvedValue(undefined),
      };
    });

    const txPre = {
      execute: jest
        .fn()
        .mockResolvedValueOnce([
          createLockedIntent({
            id: 'intent-1',
            status: 'IN_PROGRESS',
            payableAmount: 10000,
            version: 0,
          }),
        ])
        .mockResolvedValueOnce([
          {
            id: 'leg-1',
            intentId: 'intent-1',
            providerType: 'POINTS',
            amount: 10000,
            status: 'AUTHORIZED',
            version: 0,
            metadata: {},
          },
        ]),
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([{ maxAttemptNo: 1 }]),
        }),
      }),
      insert: txPreInsertMock,
    };

    const readQueue = [
      [
        {
          id: 'intent-1',
          referenceType: 'STORE_ORDER',
          referenceId: 'order-1',
          userId: 'customer-1',
          currency: 'KRW',
          payableAmount: 10000,
          status: 'SUCCEEDED',
          expiresAt: new Date(),
          version: 2,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      [
        {
          id: 'leg-1',
          intentId: 'intent-1',
          providerType: 'POINTS',
          amount: 10000,
          status: 'CAPTURED',
          isRequired: true,
          sequenceNo: 1,
          version: 1,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      [
        {
          ...createdAttempt,
          status: 'CAPTURED',
          providerTransactionId: 'provider-capture-1',
          providerRequestId: 'provider-capture-req-1',
          responsePayload: { providerType: 'POINTS' },
        },
      ],
    ];
    let selectCall = 0;
    const txPost = {
      execute: jest.fn().mockResolvedValue([
        createLockedIntent({
          id: 'intent-1',
          status: 'IN_PROGRESS',
          payableAmount: 10000,
          version: 1,
        }),
      ]),
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(undefined),
        }),
      }),
      select: jest.fn().mockImplementation(() => {
        selectCall += 1;

        if (selectCall === 1) {
          return {
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([
                {
                  status: 'CAPTURED',
                  isRequired: true,
                },
              ]),
            }),
          };
        }

        return {
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockImplementation(async () => (readQueue.shift() as unknown[]) ?? []),
            }),
          }),
        };
      }),
    };

    db.transaction
      .mockImplementationOnce(
        async (callback: (tx: typeof txPre) => unknown) => callback(txPre),
      )
      .mockImplementationOnce(
        async (callback: (tx: typeof txPost) => unknown) => callback(txPost),
      );

    const result = await service.captureLeg('intent-1', 'leg-1', 'corr-capture-2');

    expect(providerCapture).toHaveBeenCalledTimes(1);
    expect(providerCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'CAPTURE',
        params: expect.objectContaining({
          idempotencyKey: 'wallet:test:leg-1:CAPTURE:2',
        }),
      }),
    );
    expect(stateTransitionService.transitionIntent).toHaveBeenCalledWith(
      'intent-1',
      'SUCCEEDED',
      expect.objectContaining({
        correlationId: 'corr-capture-2',
      }),
      'IN_PROGRESS',
      txPost,
    );
    expect(result.intent.status).toBe('SUCCEEDED');
    expect(result.leg.status).toBe('CAPTURED');
    expect(result.attempt.status).toBe('CAPTURED');
  });

  it('marks capture attempt as PENDING_PROVIDER when provider capture call is uncertain', async () => {
    const providerCapture = jest.fn().mockRejectedValue(new Error('capture timeout'));
    providerRegistry.assertCapability.mockReturnValue({
      execute: providerCapture,
    });

    const createdAttempt = {
      id: 'attempt-cap-uncertain-1',
      intentId: 'intent-1',
      legId: 'leg-1',
      attemptNo: 2,
      operation: 'CAPTURE',
      status: 'CREATED',
      providerTransactionId: null,
      providerRequestId: null,
      idempotencyKey: null,
      providerIdempotencyKey: 'wallet:test:leg-1:CAPTURE:2',
      errorCode: null,
      errorMessage: null,
      requestPayload: { operation: 'CAPTURE' },
      responsePayload: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const txPreInsertMock = jest.fn((table) => {
      if (table === paymentAttempts) {
        return {
          values: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([createdAttempt]),
          }),
        };
      }

      return {
        values: jest.fn().mockResolvedValue(undefined),
      };
    });

    const txPre = {
      execute: jest
        .fn()
        .mockResolvedValueOnce([
          createLockedIntent({
            id: 'intent-1',
            status: 'IN_PROGRESS',
            payableAmount: 10000,
            version: 0,
          }),
        ])
        .mockResolvedValueOnce([
          {
            id: 'leg-1',
            intentId: 'intent-1',
            providerType: 'POINTS',
            amount: 10000,
            status: 'AUTHORIZED',
            version: 0,
            metadata: {},
          },
        ]),
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([{ maxAttemptNo: 1 }]),
        }),
      }),
      insert: txPreInsertMock,
    };

    const readQueue = [
      [
        {
          id: 'intent-1',
          referenceType: 'STORE_ORDER',
          referenceId: 'order-1',
          userId: 'customer-1',
          currency: 'KRW',
          payableAmount: 10000,
          status: 'IN_PROGRESS',
          expiresAt: new Date(),
          version: 2,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      [
        {
          id: 'leg-1',
          intentId: 'intent-1',
          providerType: 'POINTS',
          amount: 10000,
          status: 'AUTHORIZED',
          isRequired: true,
          sequenceNo: 1,
          version: 1,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      [
        {
          ...createdAttempt,
          status: 'PENDING_PROVIDER',
          errorCode: 'PROVIDER_CAPTURE_UNCERTAIN',
          errorMessage: 'capture timeout',
        },
      ],
    ];

    const txPost = {
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(undefined),
        }),
      }),
      select: jest.fn().mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockImplementation(() => Promise.resolve(readQueue.shift() ?? [])),
          }),
        }),
      })),
    };

    db.transaction
      .mockImplementationOnce(
        async (callback: (innerTx: typeof txPre) => unknown) => callback(txPre),
      )
      .mockImplementationOnce(
        async (callback: (innerTx: typeof txPost) => unknown) => callback(txPost),
      );

    const result = await service.captureLeg('intent-1', 'leg-1', 'corr-capture-uncertain-1');

    expect(result.attempt.status).toBe('PENDING_PROVIDER');
    expect(providerCapture).toHaveBeenCalledTimes(1);
    expect(stateTransitionService.transitionAttempt).toHaveBeenCalledWith(
      'attempt-cap-uncertain-1',
      'PENDING_PROVIDER',
      expect.objectContaining({
        correlationId: 'corr-capture-uncertain-1',
        reasonCode: 'PROVIDER_CAPTURE_UNCERTAIN',
      }),
      'SENT',
      txPost,
    );
  });

  it('calls provider capture once when concurrent capture requests race on active attempt guard', async () => {
    let resolveFirstCapture: (
      value:
        | {
            resultStatus: 'CAPTURED';
            providerTransactionId: string;
            providerRequestId: string;
            raw: { providerType: string };
          }
        | PromiseLike<{
            resultStatus: 'CAPTURED';
            providerTransactionId: string;
            providerRequestId: string;
            raw: { providerType: string };
          }>,
    ) => void = () => {
      throw new Error('First capture resolver was not initialized');
    };

    const providerCapture = jest.fn().mockImplementation(
      () =>
        new Promise<{
          resultStatus: 'CAPTURED';
          providerTransactionId: string;
          providerRequestId: string;
          raw: { providerType: string };
        }>((resolve) => {
          resolveFirstCapture = resolve;
        }),
    );
    providerRegistry.assertCapability.mockReturnValue({
      execute: providerCapture,
    });

    const duplicateError = Object.assign(
      new Error('duplicate key value violates unique constraint'),
      {
        code: '23505',
        constraint: 'uq_payment_attempts_active_leg_operation',
      },
    );

    const firstAttempt = {
      id: 'attempt-cap-race-1',
      intentId: 'intent-1',
      legId: 'leg-1',
      attemptNo: 2,
      operation: 'CAPTURE',
      status: 'CREATED',
      providerTransactionId: null,
      providerRequestId: null,
      idempotencyKey: null,
      providerIdempotencyKey: 'wallet:test:leg-1:CAPTURE:2',
      errorCode: null,
      errorMessage: null,
      requestPayload: { operation: 'CAPTURE' },
      responsePayload: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const txPreFirst = {
      execute: jest
        .fn()
        .mockResolvedValueOnce([
          createLockedIntent({
            id: 'intent-1',
            status: 'IN_PROGRESS',
            payableAmount: 10000,
            version: 0,
          }),
        ])
        .mockResolvedValueOnce([
          {
            id: 'leg-1',
            intentId: 'intent-1',
            providerType: 'POINTS',
            amount: 10000,
            status: 'AUTHORIZED',
            version: 0,
            metadata: {},
          },
        ]),
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([{ maxAttemptNo: 1 }]),
        }),
      }),
      insert: jest.fn((table) => {
        if (table === paymentAttempts) {
          return {
            values: jest.fn().mockReturnValue({
              returning: jest.fn().mockResolvedValue([firstAttempt]),
            }),
          };
        }

        return {
          values: jest.fn().mockResolvedValue(undefined),
        };
      }),
    };

    const txPreSecond = {
      execute: jest
        .fn()
        .mockResolvedValueOnce([
          createLockedIntent({
            id: 'intent-1',
            status: 'IN_PROGRESS',
            payableAmount: 10000,
            version: 0,
          }),
        ])
        .mockResolvedValueOnce([
          {
            id: 'leg-1',
            intentId: 'intent-1',
            providerType: 'POINTS',
            amount: 10000,
            status: 'AUTHORIZED',
            version: 0,
            metadata: {},
          },
        ]),
      select: jest
        .fn()
        .mockImplementationOnce(() => ({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([{ maxAttemptNo: 2 }]),
          }),
        }))
        .mockImplementationOnce(() => ({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([
                {
                  id: 'attempt-cap-race-1',
                  status: 'SENT',
                },
              ]),
            }),
          }),
        })),
      insert: jest.fn((table) => {
        if (table === paymentAttempts) {
          return {
            values: jest.fn().mockReturnValue({
              returning: jest.fn().mockRejectedValue(duplicateError),
            }),
          };
        }

        return {
          values: jest.fn().mockResolvedValue(undefined),
        };
      }),
    };

    const readQueue = [
      [
        {
          id: 'intent-1',
          referenceType: 'STORE_ORDER',
          referenceId: 'order-1',
          userId: 'customer-1',
          currency: 'KRW',
          payableAmount: 10000,
          status: 'SUCCEEDED',
          expiresAt: new Date(),
          version: 2,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      [
        {
          id: 'leg-1',
          intentId: 'intent-1',
          providerType: 'POINTS',
          amount: 10000,
          status: 'CAPTURED',
          isRequired: true,
          sequenceNo: 1,
          version: 1,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      [
        {
          ...firstAttempt,
          status: 'CAPTURED',
          providerTransactionId: 'provider-capture-race-1',
          providerRequestId: 'provider-capture-race-req-1',
          responsePayload: { providerType: 'POINTS' },
        },
      ],
    ];
    let postSelectCall = 0;
    const txPostFirst = {
      execute: jest.fn().mockResolvedValue([
        createLockedIntent({
          id: 'intent-1',
          status: 'IN_PROGRESS',
          payableAmount: 10000,
          version: 1,
        }),
      ]),
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(undefined),
        }),
      }),
      select: jest.fn().mockImplementation(() => {
        postSelectCall += 1;

        if (postSelectCall === 1) {
          return {
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([
                {
                  status: 'CAPTURED',
                  isRequired: true,
                },
              ]),
            }),
          };
        }

        return {
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockImplementation(async () => (readQueue.shift() as unknown[]) ?? []),
            }),
          }),
        };
      }),
    };

    const txQueue = [txPreFirst, txPreSecond, txPostFirst];
    db.transaction.mockImplementation(async (callback: (innerTx: unknown) => unknown) =>
      callback(txQueue.shift()),
    );

    const firstPromise = service.captureLeg('intent-1', 'leg-1', 'corr-capture-race-a');
    for (let attempt = 0; attempt < 20 && providerCapture.mock.calls.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(providerCapture).toHaveBeenCalledTimes(1);
    const secondPromise = service.captureLeg('intent-1', 'leg-1', 'corr-capture-race-b');

    await expect(secondPromise).rejects.toMatchObject({
      response: expect.objectContaining({
        error: 'ACTIVE_ATTEMPT_ALREADY_EXISTS',
        attemptId: 'attempt-cap-race-1',
        attemptStatus: 'SENT',
      }),
    });
    expect(providerCapture).toHaveBeenCalledTimes(1);

    resolveFirstCapture({
      resultStatus: 'CAPTURED',
      providerTransactionId: 'provider-capture-race-1',
      providerRequestId: 'provider-capture-race-req-1',
      raw: { providerType: 'POINTS' },
    });

    const firstResult = await firstPromise;
    expect(firstResult.attempt.status).toBe('CAPTURED');
    expect(providerCapture).toHaveBeenCalledTimes(1);
  });

  it('blocks retry capture after uncertain timeout while active attempt is PENDING_PROVIDER', async () => {
    const providerCapture = jest.fn().mockRejectedValue(new Error('capture timeout'));
    providerRegistry.assertCapability.mockReturnValue({
      execute: providerCapture,
    });

    const duplicateError = Object.assign(
      new Error('duplicate key value violates unique constraint'),
      {
        code: '23505',
        constraint: 'uq_payment_attempts_active_leg_operation',
      },
    );

    const pendingAttempt = {
      id: 'attempt-cap-uncertain-2',
      intentId: 'intent-1',
      legId: 'leg-1',
      attemptNo: 2,
      operation: 'CAPTURE',
      status: 'CREATED',
      providerTransactionId: null,
      providerRequestId: null,
      idempotencyKey: null,
      providerIdempotencyKey: 'wallet:test:leg-1:CAPTURE:2',
      errorCode: null,
      errorMessage: null,
      requestPayload: { operation: 'CAPTURE' },
      responsePayload: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const txPreFirst = {
      execute: jest
        .fn()
        .mockResolvedValueOnce([
          createLockedIntent({
            id: 'intent-1',
            status: 'IN_PROGRESS',
            payableAmount: 10000,
            version: 0,
          }),
        ])
        .mockResolvedValueOnce([
          {
            id: 'leg-1',
            intentId: 'intent-1',
            providerType: 'POINTS',
            amount: 10000,
            status: 'AUTHORIZED',
            version: 0,
            metadata: {},
          },
        ]),
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([{ maxAttemptNo: 1 }]),
        }),
      }),
      insert: jest.fn((table) => {
        if (table === paymentAttempts) {
          return {
            values: jest.fn().mockReturnValue({
              returning: jest.fn().mockResolvedValue([pendingAttempt]),
            }),
          };
        }

        return {
          values: jest.fn().mockResolvedValue(undefined),
        };
      }),
    };

    const firstReadQueue = [
      [
        {
          id: 'intent-1',
          referenceType: 'STORE_ORDER',
          referenceId: 'order-1',
          userId: 'customer-1',
          currency: 'KRW',
          payableAmount: 10000,
          status: 'IN_PROGRESS',
          expiresAt: new Date(),
          version: 2,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      [
        {
          id: 'leg-1',
          intentId: 'intent-1',
          providerType: 'POINTS',
          amount: 10000,
          status: 'AUTHORIZED',
          isRequired: true,
          sequenceNo: 1,
          version: 1,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      [
        {
          ...pendingAttempt,
          status: 'PENDING_PROVIDER',
          errorCode: 'PROVIDER_CAPTURE_UNCERTAIN',
          errorMessage: 'capture timeout',
        },
      ],
    ];
    const txPostFirst = {
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(undefined),
        }),
      }),
      select: jest.fn().mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockImplementation(() => Promise.resolve(firstReadQueue.shift() ?? [])),
          }),
        }),
      })),
    };

    const txPreSecond = {
      execute: jest
        .fn()
        .mockResolvedValueOnce([
          createLockedIntent({
            id: 'intent-1',
            status: 'IN_PROGRESS',
            payableAmount: 10000,
            version: 0,
          }),
        ])
        .mockResolvedValueOnce([
          {
            id: 'leg-1',
            intentId: 'intent-1',
            providerType: 'POINTS',
            amount: 10000,
            status: 'AUTHORIZED',
            version: 0,
            metadata: {},
          },
        ]),
      select: jest
        .fn()
        .mockImplementationOnce(() => ({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([{ maxAttemptNo: 2 }]),
          }),
        }))
        .mockImplementationOnce(() => ({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([
                {
                  id: 'attempt-cap-uncertain-2',
                  status: 'PENDING_PROVIDER',
                },
              ]),
            }),
          }),
        })),
      insert: jest.fn((table) => {
        if (table === paymentAttempts) {
          return {
            values: jest.fn().mockReturnValue({
              returning: jest.fn().mockRejectedValue(duplicateError),
            }),
          };
        }

        return {
          values: jest.fn().mockResolvedValue(undefined),
        };
      }),
    };

    const txQueue = [txPreFirst, txPostFirst, txPreSecond];
    db.transaction.mockImplementation(async (callback: (innerTx: unknown) => unknown) =>
      callback(txQueue.shift()),
    );

    const first = await service.captureLeg('intent-1', 'leg-1', 'corr-capture-uncertain-2');
    expect(first.attempt.status).toBe('PENDING_PROVIDER');

    await expect(
      service.captureLeg('intent-1', 'leg-1', 'corr-capture-uncertain-retry'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        error: 'ACTIVE_ATTEMPT_ALREADY_EXISTS',
        attemptId: 'attempt-cap-uncertain-2',
        attemptStatus: 'PENDING_PROVIDER',
      }),
    });
    expect(providerCapture).toHaveBeenCalledTimes(1);
  });

  it('cancels PENDING intent without compensation flow', async () => {
    const tx = {
      execute: jest
        .fn()
        .mockResolvedValue([
          createLockedIntent({
            id: 'intent-1',
            status: 'PENDING',
            payableAmount: 10000,
            version: 0,
          }),
        ]),
    };

    db.transaction.mockImplementationOnce(
      async (callback: (innerTx: typeof tx) => unknown) => callback(tx),
    );

    const result = await service.cancelIntent('intent-1', 'corr-cancel-1');

    expect(result).toEqual({
      intentId: 'intent-1',
      status: 'CANCELLED',
    });
    expect(stateTransitionService.transitionIntent).toHaveBeenCalledTimes(1);
    expect(stateTransitionService.transitionIntent).toHaveBeenCalledWith(
      'intent-1',
      'CANCELLED',
      expect.objectContaining({
        correlationId: 'corr-cancel-1',
      }),
      'PENDING',
      tx,
    );
  });

  it('supersedes IN_PROGRESS intent after successful leg refund compensation', async () => {
    const providerRefund = jest.fn().mockResolvedValue({
      resultStatus: 'REFUNDED',
      providerTransactionId: 'provider-refund-1',
      raw: { providerType: 'POINTS' },
    });
    providerRegistry.assertCapability.mockReturnValue({
      execute: providerRefund,
    });

    const createdAttempt = {
      id: 'attempt-comp-1',
      intentId: 'intent-1',
      legId: 'leg-1',
      attemptNo: 1,
      operation: 'REFUND',
      status: 'CREATED',
      providerTransactionId: null,
      providerRequestId: null,
      idempotencyKey: null,
      providerIdempotencyKey: 'wallet:test:leg-1:REFUND:1',
      errorCode: null,
      errorMessage: null,
      requestPayload: { operation: 'REFUND' },
      responsePayload: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const txInsertMock = jest.fn((table) => {
      if (table === paymentAttempts) {
        return {
          values: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([createdAttempt]),
          }),
        };
      }

      if (table === manualCancelQueueItems) {
        return {
          values: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([{ id: 'queue-item-1' }]),
          }),
        };
      }

      return {
        values: jest.fn().mockResolvedValue(undefined),
      };
    });

    const tx = {
      execute: jest
        .fn()
        .mockResolvedValue([
          createLockedIntent({
            id: 'intent-1',
            status: 'IN_PROGRESS',
            payableAmount: 10000,
            version: 0,
          }),
        ]),
      select: jest.fn().mockImplementation(() => ({
        from: jest.fn((table) => {
          if (table === paymentLegs) {
            return {
              where: jest.fn().mockResolvedValue([
                {
                  id: 'leg-1',
                  intentId: 'intent-1',
                  providerType: 'POINTS',
                  amount: 10000,
                  status: 'CAPTURED',
                  isRequired: true,
                  sequenceNo: 1,
                  version: 0,
                  metadata: {},
                  createdAt: new Date(),
                  updatedAt: new Date(),
                },
              ]),
            };
          }

          if (table === paymentAttempts) {
            return {
              where: jest.fn().mockResolvedValue([{ maxAttemptNo: 0 }]),
            };
          }

          throw new Error('Unexpected table in supersede test');
        }),
      })),
      insert: txInsertMock,
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(undefined),
        }),
      }),
    };

    db.transaction.mockImplementation(
      async (callback: (innerTx: typeof tx) => unknown) => callback(tx),
    );

    const result = await service.supersedeIntent('intent-1', 'corr-supersede-1');

    expect(result).toEqual({
      intentId: 'intent-1',
      status: 'SUPERSEDED',
    });
    expect(providerRefund).toHaveBeenCalledTimes(1);
    expect(providerRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'REFUND',
        params: expect.objectContaining({
          idempotencyKey: 'wallet:test:leg-1:REFUND:1',
        }),
      }),
    );
    expect(txInsertMock).toHaveBeenCalled();
    expect(stateTransitionService.transitionAttempt).toHaveBeenCalledWith(
      'attempt-comp-1',
      'REFUND_REQUESTED',
      expect.objectContaining({
        correlationId: 'corr-supersede-1',
      }),
      'SENT',
      tx,
    );
    expect(stateTransitionService.transitionAttempt).toHaveBeenCalledWith(
      'attempt-comp-1',
      'REFUNDED',
      expect.objectContaining({
        correlationId: 'corr-supersede-1',
      }),
      'REFUND_REQUESTED',
      tx,
    );
    expect(stateTransitionService.transitionIntent).toHaveBeenCalledTimes(2);
    expect(stateTransitionService.transitionIntent).toHaveBeenNthCalledWith(
      1,
      'intent-1',
      'SUSPENDED',
      expect.objectContaining({
        correlationId: 'corr-supersede-1',
      }),
      'IN_PROGRESS',
      tx,
    );
    expect(stateTransitionService.transitionIntent).toHaveBeenNthCalledWith(
      2,
      'intent-1',
      'SUPERSEDED',
      expect.objectContaining({
        correlationId: 'corr-supersede-1',
      }),
      'SUSPENDED',
      tx,
    );
    expect(stateTransitionService.transitionLeg).toHaveBeenCalledTimes(2);
  });

  it('moves cancel flow to RECONCILE_REQUIRED when compensation fails', async () => {
    providerRegistry.assertCapability.mockImplementation(() => {
      throw new BadRequestException({
        error: 'PROVIDER_CAPABILITY_NOT_SUPPORTED',
        message: 'Provider POINTS does not support CANCEL',
      });
    });

    const createdAttempt = {
      id: 'attempt-comp-2',
      intentId: 'intent-1',
      legId: 'leg-1',
      attemptNo: 1,
      operation: 'CANCEL',
      status: 'CREATED',
      providerTransactionId: null,
      providerRequestId: null,
      idempotencyKey: null,
      providerIdempotencyKey: 'wallet:test:leg-1:CANCEL:1',
      errorCode: null,
      errorMessage: null,
      requestPayload: { operation: 'CANCEL' },
      responsePayload: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const txInsertMock = jest.fn((table) => {
      if (table === paymentAttempts) {
        return {
          values: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([createdAttempt]),
          }),
        };
      }

      if (table === manualCancelQueueItems) {
        return {
          values: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([{ id: 'queue-item-1' }]),
          }),
        };
      }

      return {
        values: jest.fn().mockResolvedValue(undefined),
      };
    });

    const tx = {
      execute: jest
        .fn()
        .mockResolvedValue([
          createLockedIntent({
            id: 'intent-1',
            status: 'IN_PROGRESS',
            payableAmount: 10000,
            version: 0,
          }),
        ]),
      select: jest.fn().mockImplementation(() => ({
        from: jest.fn((table) => {
          if (table === paymentLegs) {
            return {
              where: jest.fn().mockResolvedValue([
                {
                  id: 'leg-1',
                  intentId: 'intent-1',
                  providerType: 'POINTS',
                  amount: 10000,
                  status: 'AUTHORIZED',
                  isRequired: true,
                  sequenceNo: 1,
                  version: 0,
                  metadata: {},
                  createdAt: new Date(),
                  updatedAt: new Date(),
                },
              ]),
            };
          }

          if (table === paymentAttempts) {
            return {
              where: jest.fn().mockResolvedValue([{ maxAttemptNo: 0 }]),
            };
          }

          if (table === manualCancelQueueItems) {
            return {
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([]),
              }),
            };
          }

          throw new Error('Unexpected table in cancel compensation test');
        }),
      })),
      insert: txInsertMock,
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(undefined),
        }),
      }),
    };

    db.transaction.mockImplementation(
      async (callback: (innerTx: typeof tx) => unknown) => callback(tx),
    );

    const result = await service.cancelIntent('intent-1', 'corr-cancel-2');

    expect(result).toEqual({
      intentId: 'intent-1',
      status: 'RECONCILE_REQUIRED',
    });
    expect(stateTransitionService.transitionAttempt).toHaveBeenCalledWith(
      'attempt-comp-2',
      'CANCEL_REQUESTED',
      expect.objectContaining({
        correlationId: 'corr-cancel-2',
      }),
      'SENT',
      tx,
    );
    expect(stateTransitionService.transitionAttempt).toHaveBeenCalledWith(
      'attempt-comp-2',
      'FAILED_RETRYABLE',
      expect.objectContaining({
        correlationId: 'corr-cancel-2',
      }),
      'CANCEL_REQUESTED',
      tx,
    );
    expect(stateTransitionService.transitionIntent).toHaveBeenCalledTimes(2);
    expect(stateTransitionService.transitionIntent).toHaveBeenNthCalledWith(
      1,
      'intent-1',
      'RECONCILING',
      expect.objectContaining({
        correlationId: 'corr-cancel-2',
      }),
      'IN_PROGRESS',
      tx,
    );
    expect(stateTransitionService.transitionIntent).toHaveBeenNthCalledWith(
      2,
      'intent-1',
      'RECONCILE_REQUIRED',
      expect.objectContaining({
        correlationId: 'corr-cancel-2',
      }),
      'RECONCILING',
      tx,
    );
  });
});

function createSignedCreateIntentDto(
  override?: Partial<CreateIntentDto>,
): CreateIntentDto {
  const referenceType = override?.referenceType ?? 'STORE_ORDER';
  const referenceId = override?.referenceId ?? 'order-1';
  const currency = override?.currency ?? 'KRW';
  const payableAmount = override?.payableAmount ?? 10000;
  const snapshotPayload = {
    schemaVersion: 'INTENT_SNAPSHOT_V1',
    items: [
      {
        lineId: 'line-1',
        name: referenceType === 'SUBSCRIPTION_BILLING' ? 'Subscription billing' : 'Order item',
        unitPrice: payableAmount,
        quantity: 1,
        type: referenceType === 'STORE_ORDER' ? 'PRODUCT' : undefined,
        id: referenceType === 'STORE_ORDER' ? referenceId : undefined,
        discounts: [],
      },
    ],
    orderDiscounts: [],
  };
  const signatureVersion = override?.signatureVersion ?? HMAC_SIGNATURE_VERSION;
  const signedAt = override?.signedAt ?? new Date().toISOString();
  const canonicalPayload = canonicalizeSnapshotPayload(snapshotPayload);
  const payloadHash = computePayloadHash(canonicalPayload);
  const signingString = buildSigningString(signatureVersion, signedAt, payloadHash);
  const signature = computeHmacSignature('wallet-hmac-secret', signingString);

  return {
    referenceType,
    referenceId,
    userId: override?.userId ?? 'customer-1',
    currency,
    payableAmount,
    snapshotPayload,
    signature,
    signatureVersion,
    signedAt,
    metadata: override?.metadata,
  };
}

function createLockedIntent(
  override?: Partial<{
    id: string;
    referenceType: string;
    referenceId: string;
    userId: string;
    currency: string;
    payableAmount: number;
    expiresAt: Date;
    status: string;
    version: number;
  }>,
) {
  return {
    id: override?.id ?? 'intent-1',
    referenceType: override?.referenceType ?? 'STORE_ORDER',
    referenceId: override?.referenceId ?? 'order-1',
    userId: override?.userId ?? 'customer-1',
    currency: override?.currency ?? 'KRW',
    payableAmount: override?.payableAmount ?? 10000,
    expiresAt: override?.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
    status: override?.status ?? 'PENDING',
    version: override?.version ?? 0,
  };
}
