import { Test, TestingModule } from '@nestjs/testing';
import { BillingChargeConsumer } from './billing-charge.consumer';
import { BillingAgreementService } from '../billing/billing-agreement.service';
import { BillingMethodService } from '../billing/billing-method.service';
import { ProviderRegistry } from '../providers/provider.registry';
import { ChargesService } from '../charges/charges.service';
import { AutoCaptureService } from '../payment-intents/auto-capture.service';
import { StateTransitionService } from '../domain/state-transition/state-transition.service';
import { DbService } from '@app/db';
import { BillingChargePayload } from '@packages/event-contracts/streams/wallet-command.stream';
import { DomainEvent } from '@packages/event-contracts/types';

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function createMockEnvelope(payload: BillingChargePayload): DomainEvent<BillingChargePayload> {
  return {
    messageId: 'msg-001',
    messageType: 'BillingCharge',
    messageVersion: 1,
    messageKind: 'command',
    correlationId: `test:${payload.idempotencyKey}`,
    timestamp: new Date().toISOString(),
    source: {
      service: 'membership',
      aggregateType: 'Subscription',
      aggregateId: 'sub-001',
    },
    payload,
  } as DomainEvent<BillingChargePayload>;
}

function createPayload(overrides?: Partial<BillingChargePayload>): BillingChargePayload {
  return {
    subscriberRef: 'sub-001',
    subscriberType: 'MEMBERSHIP',
    amount: 29900,
    currency: 'KRW',
    purpose: 'SUBSCRIPTION',
    idempotencyKey: `billing:sub-001:${Date.now()}`,
    requestedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('BillingChargeConsumer', () => {
  let consumer: BillingChargeConsumer;
  let billingAgreementService: jest.Mocked<BillingAgreementService>;
  let billingMethodService: jest.Mocked<BillingMethodService>;
  let providerRegistry: jest.Mocked<ProviderRegistry>;
  let chargesService: jest.Mocked<ChargesService>;
  let autoCaptureService: jest.Mocked<AutoCaptureService>;
  let stateTransitionService: jest.Mocked<StateTransitionService>;
  let dbService: { db: { transaction: jest.Mock; insert: jest.Mock; select: jest.Mock } };

  let mockProvider: {
    providerType: string;
    autoCapture: boolean;
    authorize: jest.Mock;
    capture: jest.Mock;
    cancel: jest.Mock;
    refund: jest.Mock;
    getUserMethods: jest.Mock;
    validateMethod: jest.Mock;
    deleteMethod: jest.Mock;
  };

  beforeEach(async () => {
    mockProvider = {
      providerType: 'TOSS_BILLING',
      autoCapture: true,
      authorize: jest.fn(),
      capture: jest.fn(),
      cancel: jest.fn(),
      refund: jest.fn(),
      getUserMethods: jest.fn(),
      validateMethod: jest.fn(),
      deleteMethod: jest.fn(),
    };
    // DB mock: transaction runs the callback immediately
    const mockTx = {
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([
            {
              id: 'intent-001',
              payableAmount: 29900,
              currency: 'KRW',
              status: 'CREATED',
              purpose: 'SUBSCRIPTION',
              userId: 'user-001',
              clientSecret: 'secret',
              expiresAt: new Date(),
              version: 0,
            },
          ]),
        }),
      }),
    };

    dbService = {
      db: {
        transaction: jest.fn().mockImplementation(async (fn: Function) => fn(mockTx)),
        insert: jest.fn().mockReturnValue({
          values: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([
              {
                id: 'pm-billing-001',
                userId: 'user-001',
                type: 'TOSS_BILLING',
                providerData: { billingMethodId: 'bm-001' },
              },
            ]),
          }),
        }),
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([]),
            }),
          }),
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingChargeConsumer,
        { provide: DbService, useValue: dbService },
        {
          provide: BillingAgreementService,
          useValue: {
            findBySubscriberRef: jest.fn(),
          },
        },
        {
          provide: BillingMethodService,
          useValue: {
            findById: jest.fn(),
            findOrCreateForBilling: jest.fn().mockResolvedValue({
              id: 'pm-billing-001',
              userId: 'user-001',
              type: 'TOSS_BILLING',
              providerData: { billingMethodId: 'bm-001' },
            }),
          },
        },
        {
          provide: ProviderRegistry,
          useValue: {
            getProviderOrThrow: jest.fn(),
          },
        },
        {
          provide: ChargesService,
          useValue: {
            create: jest.fn(),
            updateStatus: jest.fn(),
            generateIdempotencyKey: jest.fn().mockReturnValue('wallet:authorize:charge-001'),
          },
        },
        {
          provide: AutoCaptureService,
          useValue: {
            attemptAutoCapture: jest.fn(),
          },
        },
        {
          provide: StateTransitionService,
          useValue: {
            transitionIntent: jest.fn(),
          },
        },
      ],
    }).compile();

    consumer = module.get(BillingChargeConsumer);
    billingAgreementService = module.get(BillingAgreementService);
    billingMethodService = module.get(BillingMethodService);
    providerRegistry = module.get(ProviderRegistry);
    chargesService = module.get(ChargesService);
    autoCaptureService = module.get(AutoCaptureService);
    stateTransitionService = module.get(StateTransitionService);
  });

  // ─── Happy path: Toss Billing ────────────────────────────────────────────

  it('Toss 빌링 결제 성공 → AUTHORIZED → auto-capture 실행', async () => {
    const payload = createPayload();

    billingAgreementService.findBySubscriberRef.mockResolvedValue({
      id: 'ba-001',
      userId: 'user-001',
      billingMethodId: 'bm-001',
      subscriberRef: 'sub-001',
      subscriberType: 'MEMBERSHIP',
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    billingMethodService.findById.mockResolvedValue({
      id: 'bm-001',
      userId: 'user-001',
      providerType: 'TOSS_BILLING',
      billingKey: 'toss-billing-key-123',
      customerKey: 'customer-key-123',
      cmsMemberId: null,
      displayName: '신한카드 **** 1234',
      method: null,
      status: 'ACTIVE',
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    providerRegistry.getProviderOrThrow.mockReturnValue(mockProvider);

    chargesService.create.mockResolvedValue({
      id: 'charge-001',
      intentId: 'intent-001',
      paymentMethodId: 'pm-billing-001',
      amount: 29900,
      currency: 'KRW',
      operation: 'AUTHORIZE',
      status: 'CREATED',
    } as any);

    mockProvider.authorize.mockResolvedValue({
      status: 'SUCCEEDED',
      providerTransactionId: 'toss-payment-key-001',
      raw: { paymentKey: 'toss-payment-key-001', status: 'DONE' },
    });

    await consumer.onBillingCharge(createMockEnvelope(payload), payload);

    // Verify agreement lookup
    expect(billingAgreementService.findBySubscriberRef).toHaveBeenCalledWith('MEMBERSHIP', 'sub-001');

    // Verify provider authorize called
    expect(mockProvider.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 29900,
        currency: 'KRW',
        providerData: { billingMethodId: 'bm-001' },
      }),
    );

    // Verify intent transitioned to PROCESSING then AUTHORIZED
    expect(stateTransitionService.transitionIntent).toHaveBeenCalledWith(
      'intent-001',
      'PROCESSING',
      expect.objectContaining({ triggeredByType: 'COMMAND' }),
    );

    // Verify charge succeeded
    expect(chargesService.updateStatus).toHaveBeenCalledWith(
      'charge-001',
      'SUCCEEDED',
      expect.objectContaining({ providerTransactionId: 'toss-payment-key-001' }),
      expect.anything(), // tx
    );

    // Verify auto-capture triggered
    expect(autoCaptureService.attemptAutoCapture).toHaveBeenCalledWith('intent-001', expect.any(String));
  });

  // ─── Happy path: CMS Batch (PENDING) ───────────────────────────────────

  it('CMS 배치 결제 → PENDING_SETTLEMENT 전이', async () => {
    const payload = createPayload({ purpose: 'REPAYMENT' });

    billingAgreementService.findBySubscriberRef.mockResolvedValue({
      id: 'ba-002',
      userId: 'user-002',
      billingMethodId: 'bm-002',
      subscriberRef: 'sub-001',
      subscriberType: 'MEMBERSHIP',
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    billingMethodService.findById.mockResolvedValue({
      id: 'bm-002',
      userId: 'user-002',
      providerType: 'CMS_BATCH',
      billingKey: null,
      customerKey: null,
      cmsMemberId: 'cms-member-001',
      displayName: '국민은행 ***123',
      method: null,
      status: 'ACTIVE',
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const cmsProvider = { ...mockProvider, providerType: 'CMS_BATCH' };
    providerRegistry.getProviderOrThrow.mockReturnValue(cmsProvider);

    chargesService.create.mockResolvedValue({
      id: 'charge-002',
      intentId: 'intent-001',
      paymentMethodId: 'pm-cms-001',
      amount: 29900,
      currency: 'KRW',
      operation: 'AUTHORIZE',
      status: 'CREATED',
    } as any);

    cmsProvider.authorize.mockResolvedValue({
      status: 'PENDING',
      providerTransactionId: 'cms-txn-001',
      raw: { transactionId: 'cms-txn-001', status: 'REQUESTED' },
    });

    await consumer.onBillingCharge(createMockEnvelope(payload), payload);

    // Verify charge status set to PENDING (PENDING 분기는 charge+intent 전이를 한 트랜잭션으로 묶으므로 tx 인자가 전달됨)
    expect(chargesService.updateStatus).toHaveBeenCalledWith(
      'charge-002',
      'PENDING',
      expect.objectContaining({ providerTransactionId: 'cms-txn-001' }),
      expect.anything(),
    );

    // Verify intent transitioned to PENDING_SETTLEMENT (expectedFromStatus 없음, tx 전달)
    expect(stateTransitionService.transitionIntent).toHaveBeenCalledWith(
      'intent-001',
      'PENDING_SETTLEMENT',
      expect.objectContaining({
        reasonCode: 'PENDING_SETTLEMENT',
      }),
      undefined,
      expect.anything(),
    );

    // Auto-capture should NOT be called for PENDING
    expect(autoCaptureService.attemptAutoCapture).not.toHaveBeenCalled();
  });

  // ─── Existing intent status-aware handling ────────────────────────────

  function mockSelectOnce(result: unknown[]) {
    return {
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue(result),
        }),
      }),
    };
  }

  function setupAgreementAndMethod() {
    billingAgreementService.findBySubscriberRef.mockResolvedValue({
      id: 'ba-001',
      userId: 'user-001',
      billingMethodId: 'bm-001',
      subscriberRef: 'sub-001',
      subscriberType: 'MEMBERSHIP',
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    billingMethodService.findById.mockResolvedValue({
      id: 'bm-001',
      userId: 'user-001',
      providerType: 'TOSS_BILLING',
      billingKey: 'key',
      customerKey: 'ckey',
      cmsMemberId: null,
      displayName: null,
      method: null,
      status: 'ACTIVE',
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  it('기존 SUCCEEDED intent → idempotent skip (outbox insert 없음)', async () => {
    const payload = createPayload();
    setupAgreementAndMethod();

    dbService.db.select.mockReturnValueOnce(
      mockSelectOnce([{ id: 'intent-existing', status: 'SUCCEEDED', updatedAt: new Date() }]),
    );

    await consumer.onBillingCharge(createMockEnvelope(payload), payload);

    expect(mockProvider.authorize).not.toHaveBeenCalled();
    expect(dbService.db.insert).not.toHaveBeenCalled();
  });

  it('기존 PENDING_SETTLEMENT intent → idempotent skip', async () => {
    const payload = createPayload();
    setupAgreementAndMethod();

    dbService.db.select.mockReturnValueOnce(
      mockSelectOnce([{ id: 'intent-existing', status: 'PENDING_SETTLEMENT', updatedAt: new Date() }]),
    );

    await consumer.onBillingCharge(createMockEnvelope(payload), payload);

    expect(mockProvider.authorize).not.toHaveBeenCalled();
    expect(dbService.db.insert).not.toHaveBeenCalled();
  });

  it('기존 FAILED intent (5xx) + outbox 이벤트 없음 → FAILED 이벤트 재발행', async () => {
    const payload = createPayload();
    setupAgreementAndMethod();

    // 1st select: existing FAILED intent
    // 2nd select: no outbox event found
    dbService.db.select
      .mockReturnValueOnce(mockSelectOnce([{ id: 'intent-existing', status: 'FAILED', updatedAt: new Date() }]))
      .mockReturnValueOnce(mockSelectOnce([])); // outbox event not found

    await consumer.onBillingCharge(createMockEnvelope(payload), payload);

    expect(mockProvider.authorize).not.toHaveBeenCalled();
    expect(dbService.db.insert).toHaveBeenCalled(); // emitFailedEvent
  });

  it('기존 FAILED intent (4xx) + outbox 이벤트 있음 → skip (재발행 없음)', async () => {
    const payload = createPayload();
    setupAgreementAndMethod();

    // 1st select: existing FAILED intent
    // 2nd select: outbox event already exists
    dbService.db.select
      .mockReturnValueOnce(mockSelectOnce([{ id: 'intent-existing', status: 'FAILED', updatedAt: new Date() }]))
      .mockReturnValueOnce(mockSelectOnce([{ id: 'outbox-001' }])); // outbox event found

    await consumer.onBillingCharge(createMockEnvelope(payload), payload);

    expect(mockProvider.authorize).not.toHaveBeenCalled();
    expect(dbService.db.insert).not.toHaveBeenCalled();
  });

  it('기존 CREATED intent (15분 경과 stuck) → FAILED 전이 + outbox 기록', async () => {
    const payload = createPayload();
    setupAgreementAndMethod();

    const stuckAt = new Date(Date.now() - 20 * 60 * 1000); // 20분 전
    dbService.db.select.mockReturnValueOnce(
      mockSelectOnce([{ id: 'intent-stuck', status: 'CREATED', updatedAt: stuckAt, userId: 'user-001' }]),
    );

    await consumer.onBillingCharge(createMockEnvelope(payload), payload);

    expect(mockProvider.authorize).not.toHaveBeenCalled();
    // emitFailedEvent(outbox insert) 대신 stateTransitionService.transitionIntent 로 FAILED 전이
    expect(stateTransitionService.transitionIntent).toHaveBeenCalledWith(
      'intent-stuck',
      'FAILED',
      expect.objectContaining({
        reasonCode: 'BILLING_CHARGE_STUCK',
        outboxEvent: expect.objectContaining({
          aggregateId: 'intent-stuck',
        }),
      }),
    );
    // db.insert는 호출되지 않아야 함 (transition이 outbox를 책임짐)
    expect(dbService.db.insert).not.toHaveBeenCalled();
  });

  it('기존 CREATED intent (방금 생성, concurrent delivery) → 조용히 skip', async () => {
    const payload = createPayload();
    setupAgreementAndMethod();

    const recentAt = new Date(Date.now() - 5 * 1000); // 5초 전
    dbService.db.select.mockReturnValueOnce(
      mockSelectOnce([{ id: 'intent-existing', status: 'CREATED', updatedAt: recentAt }]),
    );

    await consumer.onBillingCharge(createMockEnvelope(payload), payload);

    expect(mockProvider.authorize).not.toHaveBeenCalled();
    expect(dbService.db.insert).not.toHaveBeenCalled(); // FAILED 이벤트 발행 없음
  });

  // ─── Billing agreement not found ───────────────────────────────────────

  it('billing agreement 없으면 실패 이벤트 발행 후 정상 리턴', async () => {
    const payload = createPayload();
    billingAgreementService.findBySubscriberRef.mockResolvedValue(undefined);

    await consumer.onBillingCharge(createMockEnvelope(payload), payload);

    // Should not try to create an intent
    expect(chargesService.create).not.toHaveBeenCalled();
    expect(mockProvider.authorize).not.toHaveBeenCalled();

    // Should emit failure event via outbox
    expect(dbService.db.insert).toHaveBeenCalled();
  });

  // ─── Billing method inactive ───────────────────────────────────────────

  it('billing method가 비활성이면 실패 이벤트 발행', async () => {
    const payload = createPayload();

    billingAgreementService.findBySubscriberRef.mockResolvedValue({
      id: 'ba-001',
      userId: 'user-001',
      billingMethodId: 'bm-001',
      subscriberRef: 'sub-001',
      subscriberType: 'MEMBERSHIP',
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    billingMethodService.findById.mockResolvedValue({
      id: 'bm-001',
      userId: 'user-001',
      providerType: 'TOSS_BILLING',
      billingKey: null,
      customerKey: null,
      cmsMemberId: null,
      displayName: null,
      method: null,
      status: 'REVOKED',
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await consumer.onBillingCharge(createMockEnvelope(payload), payload);

    expect(mockProvider.authorize).not.toHaveBeenCalled();
    expect(dbService.db.insert).toHaveBeenCalled();
  });

  // ─── Provider 4xx failure → immediate FAILED, no retry ─────────────────

  it('Provider 4xx 오류 → 즉시 FAILED 이벤트, 재시도 안함', async () => {
    const payload = createPayload();

    billingAgreementService.findBySubscriberRef.mockResolvedValue({
      id: 'ba-001',
      userId: 'user-001',
      billingMethodId: 'bm-001',
      subscriberRef: 'sub-001',
      subscriberType: 'MEMBERSHIP',
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    billingMethodService.findById.mockResolvedValue({
      id: 'bm-001',
      userId: 'user-001',
      providerType: 'TOSS_BILLING',
      billingKey: 'key',
      customerKey: 'ckey',
      cmsMemberId: null,
      displayName: null,
      method: null,
      status: 'ACTIVE',
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    providerRegistry.getProviderOrThrow.mockReturnValue(mockProvider);

    chargesService.create.mockResolvedValue({
      id: 'charge-003',
      intentId: 'intent-001',
      paymentMethodId: 'pm-001',
      amount: 29900,
      currency: 'KRW',
      operation: 'AUTHORIZE',
      status: 'CREATED',
    } as any);

    mockProvider.authorize.mockResolvedValue({
      status: 'FAILED',
      errorCode: 'CARD_EXPIRED',
      errorMessage: 'Card has expired',
    });

    // Business error should NOT propagate as a throw that triggers DLQ retry
    // (the consumer handles it internally by emitting a FAILED event)
    const error = await consumer.onBillingCharge(createMockEnvelope(payload), payload).catch((e: Error) => e);
    // The _billingChargeHandled flag prevents outer catch from rethrowing
    expect(error).toBeUndefined();

    // Verify charge marked as FAILED
    expect(chargesService.updateStatus).toHaveBeenCalledWith(
      'charge-003',
      'FAILED',
      expect.objectContaining({
        errorCode: 'CARD_EXPIRED',
        errorMessage: 'Card has expired',
      }),
      expect.anything(), // tx
    );

    // Verify intent transitioned to FAILED with outbox event
    expect(stateTransitionService.transitionIntent).toHaveBeenCalledWith(
      'intent-001',
      'FAILED',
      expect.objectContaining({
        reasonCode: 'CARD_EXPIRED',
        outboxEvent: expect.objectContaining({
          eventType: 'payment.intent.failed',
        }),
      }),
      undefined,
      expect.anything(), // tx
    );
  });

  // ─── Provider 5xx → throw for DLQ retry ────────────────────────────────

  it('Provider 5xx 예외 → throw → DLQ 재시도', async () => {
    const payload = createPayload();

    billingAgreementService.findBySubscriberRef.mockResolvedValue({
      id: 'ba-001',
      userId: 'user-001',
      billingMethodId: 'bm-001',
      subscriberRef: 'sub-001',
      subscriberType: 'MEMBERSHIP',
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    billingMethodService.findById.mockResolvedValue({
      id: 'bm-001',
      userId: 'user-001',
      providerType: 'TOSS_BILLING',
      billingKey: 'key',
      customerKey: 'ckey',
      cmsMemberId: null,
      displayName: null,
      method: null,
      status: 'ACTIVE',
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    providerRegistry.getProviderOrThrow.mockReturnValue(mockProvider);

    chargesService.create.mockResolvedValue({
      id: 'charge-004',
      intentId: 'intent-001',
      paymentMethodId: 'pm-001',
      amount: 29900,
      currency: 'KRW',
      operation: 'AUTHORIZE',
      status: 'CREATED',
    } as any);

    mockProvider.authorize.mockRejectedValue(new Error('Toss billing API 5xx: INTERNAL_SERVER_ERROR'));

    // 5xx should propagate as exception for DLQ retry
    await expect(consumer.onBillingCharge(createMockEnvelope(payload), payload)).rejects.toThrow(
      'Toss billing API 5xx',
    );

    // Charge should be marked FAILED
    expect(chargesService.updateStatus).toHaveBeenCalledWith(
      'charge-004',
      'FAILED',
      expect.objectContaining({
        errorCode: 'PROVIDER_EXCEPTION',
      }),
    );

    // Intent should be marked FAILED
    expect(stateTransitionService.transitionIntent).toHaveBeenCalledWith(
      'intent-001',
      'FAILED',
      expect.objectContaining({
        reasonCode: 'PROVIDER_EXCEPTION',
      }),
    );
  });
});
