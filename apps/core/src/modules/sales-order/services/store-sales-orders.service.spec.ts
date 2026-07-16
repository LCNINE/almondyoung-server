import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { StoreSalesOrdersService } from './store-sales-orders.service';
import { WalletRefundClient, WalletRefundOutcome } from './wallet-refund.client';

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const SO_ID = 'so-001';
const CHANNEL_ORDER_ID = 'medusa-order-001';
const CUSTOMER_ID = 'customer-001';
const WALLET_INTENT_ID = 'intent-001';

function makeSo(overrides: Record<string, unknown> = {}) {
  return {
    id: SO_ID,
    channelOrderId: CHANNEL_ORDER_ID,
    salesChannel: 'medusa',
    status: 'confirmed',
    customerId: CUSTOMER_ID,
    walletIntentId: WALLET_INTENT_ID,
    totalAmount: 50000,
    shippingFee: 0,
    shippingAddress: {},
    shippingAddressHash: null,
    mergeGroupId: null,
    isMerged: false,
    memo: null,
    customerName: null,
    customerEmail: null,
    customerPhone: null,
    orderDate: new Date(),
    confirmedAt: null,
    processedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeContext(
  options: {
    so?: ReturnType<typeof makeSo>;
    fos?: { status: string; shippedAt: Date | null }[];
    walletOutcome?: WalletRefundOutcome;
    cancelError?: Error;
    businessLinkError?: Error;
    v2Outstanding?: boolean;
    cancellationReplay?: boolean;
    replayError?: Error;
  } = {},
) {
  const so = options.so ?? makeSo();
  const fos = options.fos ?? [];
  const walletOutcome = options.walletOutcome ?? {
    kind: 'success',
    refunds: [
      {
        refundId: 'rf-001',
        intentId: WALLET_INTENT_ID,
        status: 'SUCCEEDED',
        amount: 50000,
        currency: 'KRW',
        reasonCode: null,
        reasonMessage: null,
        manualConfirmable: false,
      },
    ],
  };
  let recordedRefundMetadata: Record<string, unknown> | undefined;
  let transactionTail = Promise.resolve();

  // Each where() call gets a fresh mock object so we can distinguish:
  //   call 0: findSoOrThrow — limit().then() → [so]
  //   call 1+: FO / returnRequests / exchangeRequests / businessLinks
  //     - then() directly (no limit) → fos      (fulfillment order list)
  //     - limit().then()             → []        (return/exchange/businessLinks single-row lookups)
  //     - orderBy().limit().then()   → []        (businessLinks ordered lookup)
  let whereCallIndex = 0;
  const dbMock = {
    db: {
      execute: jest.fn().mockResolvedValue(options.v2Outstanding ? [{ id: 'v2-shipment' }] : []),
      select: jest.fn().mockImplementation(() => ({
        from: jest.fn().mockImplementation(() => ({
          where: jest.fn().mockImplementation(() => {
            const idx = whereCallIndex++;
            return {
              limit: jest.fn().mockReturnValue({
                then: jest.fn((fn: (r: unknown[]) => unknown) => fn(idx === 0 ? [so] : [])),
              }),
              then: jest.fn((fn: (r: unknown[]) => unknown) => fn(fos)),
              orderBy: jest.fn().mockReturnValue({
                then: jest.fn((fn: (r: unknown[]) => unknown) => fn([])),
                limit: jest.fn().mockReturnValue({
                  then: jest.fn((fn: (r: unknown[]) => unknown) => fn([])),
                }),
              }),
            };
          }),
        })),
      })),
      transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => {
        let executeCount = 0;
        const tx = {
          execute: jest.fn(() => {
            executeCount += 1;
            return Promise.resolve(
              executeCount === 2 && recordedRefundMetadata ? [{ metadata: recordedRefundMetadata }] : [],
            );
          }),
        };
        const result = transactionTail.then(() => fn(tx));
        transactionTail = result.then(
          () => undefined,
          () => undefined,
        );
        return result;
      }),
    },
  };

  const salesOrdersServiceMock = {
    cancel: options.cancelError
      ? jest.fn().mockRejectedValue(options.cancelError)
      : jest.fn().mockResolvedValue(undefined),
    createBusinessLink: options.businessLinkError
      ? jest.fn().mockRejectedValue(options.businessLinkError)
      : jest.fn().mockImplementation((_salesOrderId: string, dto: { metadata?: Record<string, unknown> }) => {
          recordedRefundMetadata = dto.metadata;
          return Promise.resolve(undefined);
        }),
    validateCancellationReplay: options.replayError
      ? jest.fn().mockRejectedValue(options.replayError)
      : jest.fn().mockResolvedValue(options.cancellationReplay ?? false),
  };

  const walletClientMock: Partial<WalletRefundClient> = {
    refundByIntent: jest.fn().mockResolvedValue(walletOutcome),
  };

  const service = new StoreSalesOrdersService(
    dbMock as any,
    salesOrdersServiceMock as any,
    walletClientMock as WalletRefundClient,
  );

  return { service, dbMock, salesOrdersServiceMock, walletClientMock };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('StoreSalesOrdersService', () => {
  describe('cancelRequestByChannelOrder', () => {
    it('취소 후 Wallet 환불 성공 시 refundStatus=succeeded 반환', async () => {
      const { service } = makeContext();
      const result = await service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {});
      expect(result.refundStatus).toBe('succeeded');
      expect(result.orderStatus).toBe('cancelled');
    });

    it('walletIntentId가 없으면 refundStatus=manual_pending 반환, Wallet 호출 없음', async () => {
      const { service, walletClientMock } = makeContext({ so: makeSo({ walletIntentId: null }) });
      const result = await service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {});
      expect(result.refundStatus).toBe('manual_pending');
      expect(walletClientMock.refundByIntent).not.toHaveBeenCalled();
    });

    it('totalAmount가 null이면 refundStatus=manual_pending 반환, Wallet 호출 없음', async () => {
      const { service, walletClientMock } = makeContext({ so: makeSo({ totalAmount: null }) });
      const result = await service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {});
      expect(result.refundStatus).toBe('manual_pending');
      expect(walletClientMock.refundByIntent).not.toHaveBeenCalled();
    });

    it('Wallet이 PENDING 환불 반환 시 refundStatus=pending', async () => {
      const { service } = makeContext({
        walletOutcome: {
          kind: 'partial_pending',
          refunds: [
            {
              refundId: 'rf-002',
              intentId: WALLET_INTENT_ID,
              status: 'PENDING',
              amount: 50000,
              currency: 'KRW',
              reasonCode: null,
              reasonMessage: null,
              manualConfirmable: true,
            },
          ],
        },
      });
      const result = await service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {});
      expect(result.refundStatus).toBe('pending');
    });

    it('Wallet이 FAILED 반환 시 refundStatus=failed (취소는 유지)', async () => {
      const { service } = makeContext({
        walletOutcome: { kind: 'failed', errorCode: 'TOSS_ERROR', errorMessage: 'PG 오류' },
      });
      const result = await service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {});
      expect(result.refundStatus).toBe('failed');
      expect(result.orderStatus).toBe('cancelled');
    });

    it('Wallet이 already_refunded 반환 시 refundStatus=succeeded (이미 환불 완료)', async () => {
      const { service } = makeContext({
        walletOutcome: {
          kind: 'already_refunded',
          errorCode: 'REFUND_AMOUNT_EXCEEDS_AVAILABLE',
          errorMessage: '환불 가능 금액 초과',
        },
      });
      const result = await service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {});
      expect(result.refundStatus).toBe('succeeded');
      expect(result.orderStatus).toBe('cancelled');
    });

    it('최초 고객 취소 correlationId는 :initial: 포함 per-attempt 형식, 고정 key 미사용', async () => {
      const { service, walletClientMock } = makeContext();
      await service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {});
      const calledWith = (walletClientMock.refundByIntent as jest.Mock).mock.calls[0][2] as { correlationId: string };
      expect(calledWith.correlationId).toMatch(/^cancel:so-001:initial:[0-9a-f-]{36}$/);
      expect(calledWith.correlationId).not.toBe(`cancel:${SO_ID}`);
    });

    it('Wallet 서비스 unavailable 시 refundStatus=manual_pending (취소는 유지)', async () => {
      const { service } = makeContext({
        walletOutcome: { kind: 'wallet_unavailable', errorMessage: 'Connection refused' },
      });
      const result = await service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {});
      expect(result.refundStatus).toBe('manual_pending');
      expect(result.orderStatus).toBe('cancelled');
    });

    it('Wallet이 in_flight 반환 시 refundStatus=manual_pending (취소는 유지, 이중환불 없음)', async () => {
      const { service } = makeContext({
        walletOutcome: { kind: 'in_flight', errorCode: 'IDEMPOTENCY_KEY_IN_FLIGHT', errorMessage: 'in progress' },
      });
      const result = await service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {});
      expect(result.refundStatus).toBe('manual_pending');
      expect(result.orderStatus).toBe('cancelled');
    });

    it('business link 기록 실패 시에도 refundStatus는 정상 반환', async () => {
      const { service } = makeContext({
        businessLinkError: new Error('DB write failed'),
      });
      const result = await service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {});
      // Wallet 성공 + businessLink 실패 → refundStatus succeeded로 유지 (link 실패는 non-blocking)
      expect(result.refundStatus).toBe('succeeded');
    });

    it('Core 취소 자체가 실패하면 예외를 throw하고 Wallet 호출 안 함', async () => {
      const { service, walletClientMock } = makeContext({
        cancelError: new Error('출고 완료된 항목 포함'),
      });
      await expect(service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {})).rejects.toThrow();
      expect(walletClientMock.refundByIntent).not.toHaveBeenCalled();
    });

    it('이미 취소된 주문에 중복 취소 요청 시 400', async () => {
      const { service } = makeContext({ so: makeSo({ status: 'cancelled' }) });
      await expect(service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {})).rejects.toThrow(
        '이미 취소된 주문입니다.',
      );
    });

    it('타임아웃 주문 취소 요청 시 400', async () => {
      const { service } = makeContext({ so: makeSo({ status: 'timeout' }) });
      await expect(service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {})).rejects.toThrow(
        '타임아웃된 주문은 취소할 수 없습니다.',
      );
    });

    it('본인이 아닌 고객이 취소 요청 시 403', async () => {
      const { service } = makeContext();
      await expect(service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, 'other-customer', {})).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('Medusa가 아닌 채널 주문은 취소 불가', async () => {
      const { service } = makeContext({ so: makeSo({ salesChannel: 'naver' }) });
      await expect(service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {})).rejects.toThrow(
        'naver 채널 주문은 해당 채널에서 직접 취소해 주세요.',
      );
    });

    it('피킹 중(picking) 주문은 고객 직접 취소 불가 (400)', async () => {
      const { service, salesOrdersServiceMock } = makeContext({ fos: [{ status: 'picking', shippedAt: null }] });
      await expect(service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {})).rejects.toThrow(
        '피킹이 시작된 주문은 직접 취소할 수 없습니다.',
      );
      expect(salesOrdersServiceMock.cancel).not.toHaveBeenCalled();
    });

    it('피킹 완료(picked) 주문은 고객 직접 취소 불가 (400)', async () => {
      const { service, salesOrdersServiceMock } = makeContext({ fos: [{ status: 'picked', shippedAt: null }] });
      await expect(service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {})).rejects.toThrow(
        '피킹이 시작된 주문은 직접 취소할 수 없습니다.',
      );
      expect(salesOrdersServiceMock.cancel).not.toHaveBeenCalled();
    });

    it('출고증거(shippedAt) 있는 주문은 고객 직접 취소 불가 (400)', async () => {
      const { service, salesOrdersServiceMock } = makeContext({ fos: [{ status: 'shipped', shippedAt: new Date() }] });
      await expect(service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {})).rejects.toThrow(
        '이미 출고된 주문은 취소할 수 없습니다.',
      );
      expect(salesOrdersServiceMock.cancel).not.toHaveBeenCalled();
    });

    it('V2 Draft outstanding이 남아 있으면 부분 출고 증거가 있어도 잔여 취소를 coordinator에 위임한다', async () => {
      const { service, salesOrdersServiceMock } = makeContext({
        so: makeSo({ status: 'shipped' }),
        fos: [{ status: 'shipped', shippedAt: new Date() }],
        v2Outstanding: true,
      });
      await expect(service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {})).resolves.toBeDefined();
      expect(salesOrdersServiceMock.cancel).toHaveBeenCalled();
    });

    it('동일 취소 key replay는 cancelled status guard보다 먼저 stored view를 반환한다', async () => {
      const { service, salesOrdersServiceMock, walletClientMock } = makeContext({
        so: makeSo({ status: 'cancelled' }),
        cancellationReplay: true,
      });
      const context = { idempotencyKey: 'same-key', actorId: CUSTOMER_ID, actorRoles: ['customer'] };
      await expect(
        service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {}, context),
      ).resolves.toBeDefined();
      expect(salesOrdersServiceMock.cancel).not.toHaveBeenCalled();
      expect(walletClientMock.refundByIntent).not.toHaveBeenCalled();
    });

    it('동일 취소 key에 다른 hash면 replay shortcut 없이 mismatch를 전파한다', async () => {
      const mismatch = new Error('FULFILLMENT_IDEMPOTENCY_MISMATCH');
      const { service } = makeContext({ so: makeSo({ status: 'cancelled' }), replayError: mismatch });
      const context = { idempotencyKey: 'reused-key', actorId: CUSTOMER_ID, actorRoles: ['customer'] };
      await expect(
        service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, { reasonCode: 'OTHER' }, context),
      ).rejects.toThrow('FULFILLMENT_IDEMPOTENCY_MISMATCH');
    });

    it('동일 key 동시 환불은 DB claim을 재생해 Wallet을 정확히 한 번만 호출한다', async () => {
      const { service, salesOrdersServiceMock, walletClientMock } = makeContext();
      const once = service as unknown as {
        requestWalletRefundOnce: (
          so: ReturnType<typeof makeSo>,
          dto: Record<string, never>,
          idempotencyKey: string,
          options: { attemptType: 'initial'; actor: 'customer' },
        ) => Promise<string>;
      };

      const results = await Promise.all([
        once.requestWalletRefundOnce(makeSo(), {}, 'same-concurrent-key', {
          attemptType: 'initial',
          actor: 'customer',
        }),
        once.requestWalletRefundOnce(makeSo(), {}, 'same-concurrent-key', {
          attemptType: 'initial',
          actor: 'customer',
        }),
      ]);

      expect(results).toEqual(['succeeded', 'succeeded']);
      expect(walletClientMock.refundByIntent).toHaveBeenCalledTimes(1);
      expect(salesOrdersServiceMock.createBusinessLink).toHaveBeenCalledTimes(1);
      expect(walletClientMock.refundByIntent).toHaveBeenCalledWith(
        WALLET_INTENT_ID,
        50000,
        expect.objectContaining({ correlationId: expect.stringMatching(/^cancel:so-001:initial:[a-f0-9]{32}$/) }),
      );
    });

    it('주문을 찾을 수 없을 때 404', async () => {
      const { service, dbMock } = makeContext();
      // SO를 찾지 못하도록 mock override
      dbMock.db.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              then: jest.fn((fn: (r: unknown[]) => unknown) => fn([])),
            }),
          }),
        }),
      });
      await expect(service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getActionsByChannelOrderBatch', () => {
    // makeContext 는 findSoOrThrow(limit) 전제라, builder 를 직접 await 하는 배치 쿼리용 mock 을 따로 만든다.
    function makeBatchContext(sos: ReturnType<typeof makeSo>[]) {
      let whereCallIndex = 0;
      const dbMock = {
        db: {
          select: jest.fn().mockImplementation(() => ({
            from: jest.fn().mockImplementation(() => ({
              where: jest.fn().mockImplementation(() => {
                const idx = whereCallIndex++;
                return {
                  // idx 0: 배치 SO 조회, idx 1+: SO별 FO 조회(빈 목록)
                  then: jest.fn((fn: (r: unknown[]) => unknown) => fn(idx === 0 ? sos : [])),
                  limit: jest.fn().mockReturnValue({
                    then: jest.fn((fn: (r: unknown[]) => unknown) => fn([])),
                  }),
                };
              }),
            })),
          })),
        },
      };
      const service = new StoreSalesOrdersService(
        dbMock as any,
        { cancel: jest.fn(), createBusinessLink: jest.fn() } as any,
        { refundByIntent: jest.fn() } as any,
      );
      return { service, dbMock };
    }

    it('DB가 반환한 본인 주문만 SO별 액션 뷰로 매핑한다 (미수집 id는 제외)', async () => {
      const { service } = makeBatchContext([
        makeSo({ walletIntentId: null }),
        makeSo({ id: 'so-002', channelOrderId: 'medusa-order-002', walletIntentId: null }),
      ]);
      const result = await service.getActionsByChannelOrderBatch(
        [CHANNEL_ORDER_ID, 'medusa-order-002', 'medusa-order-unknown'],
        CUSTOMER_ID,
      );
      expect(result.map((r) => r.channelOrderId)).toEqual([CHANNEL_ORDER_ID, 'medusa-order-002']);
      expect(result[0]!.availableActions).toContain('cancel');
    });

    it('빈 id 목록이면 DB 조회 없이 빈 배열을 반환한다', async () => {
      const { service, dbMock } = makeBatchContext([]);
      await expect(service.getActionsByChannelOrderBatch([], CUSTOMER_ID)).resolves.toEqual([]);
      expect(dbMock.db.select).not.toHaveBeenCalled();
    });
  });

  describe('getActionsByChannelOrder', () => {
    it('취소된 주문에 walletIntentId가 있으면 refundStatus=pending', async () => {
      const { service } = makeContext({ so: makeSo({ status: 'cancelled' }) });
      const result = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
      expect(result.refundStatus).toBe('pending');
    });

    it('취소된 주문에 walletIntentId가 없으면 refundStatus=none', async () => {
      const { service } = makeContext({ so: makeSo({ status: 'cancelled', walletIntentId: null }) });
      const result = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
      expect(result.refundStatus).toBe('none');
    });

    it('확정된 주문은 refundStatus=none', async () => {
      const { service } = makeContext();
      const result = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
      expect(result.refundStatus).toBe('none');
      expect(result.availableActions).toContain('cancel');
    });

    it('claimStatus는 항상 none (Phase 4 이전)', async () => {
      const { service } = makeContext();
      const result = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
      expect(result.claimStatus).toBe('none');
    });

    it('SO status=delivered이면 return/exchange 가능', async () => {
      const { service } = makeContext({
        so: makeSo({ status: 'delivered' }),
        fos: [{ status: 'completed', shippedAt: new Date() }],
      });
      const result = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
      expect(result.availableActions).toContain('return');
      expect(result.availableActions).toContain('exchange');
      expect(result.availableActions).toContain('track');
      expect(result.availableActions).not.toContain('cancel');
    });

    it('FO status=completed(delivered)이면 return/exchange 가능', async () => {
      const { service } = makeContext({
        so: makeSo({ status: 'shipped' }),
        fos: [{ status: 'completed', shippedAt: new Date() }],
      });
      const result = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
      expect(result.availableActions).toContain('return');
      expect(result.availableActions).toContain('exchange');
    });

    it('배송중(shipped, FO=shipped)이면 return/exchange 불가', async () => {
      const { service } = makeContext({
        so: makeSo({ status: 'shipped' }),
        fos: [{ status: 'shipped', shippedAt: new Date() }],
      });
      const result = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
      expect(result.availableActions).not.toContain('return');
      expect(result.availableActions).not.toContain('exchange');
      expect(result.availableActions).toContain('track');
    });

    it('FO가 picking 상태이면 cancel 액션 없음, cancelUnavailableReason=already_processing', async () => {
      const { service } = makeContext({ fos: [{ status: 'picking', shippedAt: null }] });
      const result = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
      expect(result.availableActions).not.toContain('cancel');
      expect(result.cancelUnavailableReason).toBe('already_processing');
    });

    it('FO가 packed 상태(picked)이면 cancel 액션 없음, cancelUnavailableReason=already_processing', async () => {
      const { service } = makeContext({ fos: [{ status: 'picked', shippedAt: null }] });
      const result = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
      expect(result.availableActions).not.toContain('cancel');
      expect(result.cancelUnavailableReason).toBe('already_processing');
    });

    it('FO가 없거나 created 상태이면 cancel 가능', async () => {
      const { service } = makeContext({ fos: [] });
      const result = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
      expect(result.availableActions).toContain('cancel');
      expect(result.cancelUnavailableReason).toBeUndefined();
    });

    it('배송완료라도 FO에 출고증거만 있고(shipped) SO가 delivered 아니면 return/exchange 불가', async () => {
      const { service } = makeContext({
        so: makeSo({ status: 'processing' }),
        fos: [{ status: 'shipped', shippedAt: new Date() }],
      });
      const result = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
      expect(result.availableActions).not.toContain('return');
      expect(result.availableActions).not.toContain('exchange');
    });
  });

  // adminCancelRequest mock: SO를 항상 반환 (부분취소 시 두 번 조회됨)
  function makeAdminContext(
    options: {
      so?: ReturnType<typeof makeSo>;
      walletOutcome?: WalletRefundOutcome;
      cancelError?: Error;
      orderLines?: Array<{ id: string; quantity: number; unitPrice: number | null }>;
    } = {},
  ) {
    const so = options.so ?? makeSo();
    // Default order lines matching the cancelled line in tests
    const orderLines = options.orderLines ?? [{ id: 'line-001', quantity: 2, unitPrice: 25000 }];
    const walletOutcome = options.walletOutcome ?? {
      kind: 'success',
      refunds: [
        {
          refundId: 'rf-001',
          intentId: WALLET_INTENT_ID,
          status: 'SUCCEEDED',
          amount: 50000,
          currency: 'KRW',
          reasonCode: null,
          reasonMessage: null,
          manualConfirmable: false,
        },
      ],
    };

    const dbMock = {
      db: {
        select: jest.fn().mockImplementation(() => ({
          from: jest.fn().mockImplementation(() => ({
            where: jest.fn().mockImplementation(() => ({
              // limit().then() — findSoOrThrow and businessLink lookups
              limit: jest.fn().mockReturnValue({
                then: jest.fn((fn: (r: unknown[]) => unknown) => fn([so])),
              }),
              // Direct await without .limit() — salesOrderLines query
              then: jest.fn((fn: (r: unknown[]) => unknown) => fn(orderLines)),
              orderBy: jest.fn().mockReturnValue({
                limit: jest.fn().mockReturnValue({
                  then: jest.fn((fn: (r: unknown[]) => unknown) => fn([])),
                }),
              }),
            })),
          })),
        })),
      },
    };

    const salesOrdersServiceMock = {
      cancel: options.cancelError
        ? jest.fn().mockRejectedValue(options.cancelError)
        : jest.fn().mockResolvedValue(undefined),
      createBusinessLink: jest.fn().mockResolvedValue(undefined),
    };

    const walletClientMock: Partial<WalletRefundClient> = {
      refundByIntent: jest.fn().mockResolvedValue(walletOutcome),
    };

    const service = new StoreSalesOrdersService(
      dbMock as any,
      salesOrdersServiceMock as any,
      walletClientMock as WalletRefundClient,
    );

    return { service, dbMock, salesOrdersServiceMock, walletClientMock };
  }

  describe('adminCancelRequest', () => {
    it('lines 없으면 전체취소 — Wallet 환불 호출, refundStatus=succeeded', async () => {
      const { service, walletClientMock } = makeAdminContext();
      const result = await service.adminCancelRequest(SO_ID, {});
      expect(walletClientMock.refundByIntent).toHaveBeenCalled();
      expect(result.refundStatus).toBe('succeeded');
      expect(result.status).toBe('cancelled');
    });

    it('관리자 최초 취소 correlationId는 :initial: 포함 per-attempt 형식', async () => {
      const { service, walletClientMock } = makeAdminContext();
      await service.adminCancelRequest(SO_ID, {});
      const calledWith = (walletClientMock.refundByIntent as jest.Mock).mock.calls[0][2] as { correlationId: string };
      expect(calledWith.correlationId).toMatch(/^cancel:so-001:initial:[0-9a-f-]{36}$/);
      expect(calledWith.correlationId).not.toBe(`cancel:${SO_ID}`);
    });

    it('부분취소 — 조건 충족 시에도 항상 manual_pending (쿠폰/포인트 배분 불확실)', async () => {
      // line-001: qty=2, unitPrice=25000 → cancel qty=1
      // 자동환불 정책이 manual_review로 변경되어 Wallet 미호출, refundAmount는 참고용으로만 반환
      const { service, walletClientMock, salesOrdersServiceMock } = makeAdminContext({
        orderLines: [{ id: 'line-001', quantity: 2, unitPrice: 25000 }],
      });
      const lines = [{ salesOrderLineId: 'line-001', quantity: 1 }];
      const result = await service.adminCancelRequest(SO_ID, { lines });
      expect(walletClientMock.refundByIntent).not.toHaveBeenCalled();
      expect(salesOrdersServiceMock.cancel).toHaveBeenCalledWith(
        SO_ID,
        expect.objectContaining({ lines, cancelledBy: 'admin' }),
      );
      expect(result.refundStatus).toBe('manual_pending');
      expect(result.manualReason).toBe('PARTIAL_CANCEL_MANUAL_REVIEW');
    });

    it('부분취소 — walletIntentId 없음 → manual_pending, Wallet 미호출', async () => {
      const { service, walletClientMock, salesOrdersServiceMock } = makeAdminContext({
        so: makeSo({ walletIntentId: null }),
        orderLines: [{ id: 'line-001', quantity: 2, unitPrice: 25000 }],
      });
      const lines = [{ salesOrderLineId: 'line-001', quantity: 1 }];
      const result = await service.adminCancelRequest(SO_ID, { lines });
      expect(walletClientMock.refundByIntent).not.toHaveBeenCalled();
      expect(salesOrdersServiceMock.cancel).toHaveBeenCalledWith(
        SO_ID,
        expect.objectContaining({ lines, cancelledBy: 'admin' }),
      );
      expect(result.refundStatus).toBe('manual_pending');
      expect(result.manualReason).toBe('NO_WALLET_INTENT');
    });

    it('부분취소 — 채널 주문(naver) → manual_pending, Wallet 미호출', async () => {
      const { service, walletClientMock } = makeAdminContext({
        so: makeSo({ salesChannel: 'naver' }),
        orderLines: [{ id: 'line-001', quantity: 2, unitPrice: 25000 }],
      });
      const lines = [{ salesOrderLineId: 'line-001', quantity: 1 }];
      const result = await service.adminCancelRequest(SO_ID, { lines });
      expect(walletClientMock.refundByIntent).not.toHaveBeenCalled();
      expect(result.refundStatus).toBe('manual_pending');
      expect(result.manualReason).toBe('CHANNEL_ORDER');
    });

    it('부분취소 — unitPrice 없는 라인 취소 → manual_pending', async () => {
      const { service, walletClientMock } = makeAdminContext({
        orderLines: [{ id: 'line-001', quantity: 2, unitPrice: null }],
      });
      const lines = [{ salesOrderLineId: 'line-001', quantity: 1 }];
      const result = await service.adminCancelRequest(SO_ID, { lines });
      expect(walletClientMock.refundByIntent).not.toHaveBeenCalled();
      expect(result.refundStatus).toBe('manual_pending');
      expect(result.manualReason).toBe('NO_LINE_PRICING');
    });

    it('이미 취소된 주문이면 400', async () => {
      const { service } = makeAdminContext({ so: makeSo({ status: 'cancelled' }) });
      await expect(service.adminCancelRequest(SO_ID, {})).rejects.toThrow('이미 취소된 주문입니다.');
    });

    it('타임아웃 주문이면 400', async () => {
      const { service } = makeAdminContext({ so: makeSo({ status: 'timeout' }) });
      await expect(service.adminCancelRequest(SO_ID, {})).rejects.toThrow('타임아웃된 주문은 취소할 수 없습니다.');
    });

    it('Core 취소 실패 시 예외 throw, Wallet 미호출', async () => {
      const { service, walletClientMock } = makeAdminContext({ cancelError: new Error('재고 부족') });
      await expect(service.adminCancelRequest(SO_ID, {})).rejects.toThrow('재고 부족');
      expect(walletClientMock.refundByIntent).not.toHaveBeenCalled();
    });

    it('walletIntentId 없으면 전체취소도 refundStatus=manual_pending', async () => {
      const { service, walletClientMock } = makeAdminContext({ so: makeSo({ walletIntentId: null }) });
      const result = await service.adminCancelRequest(SO_ID, {});
      expect(walletClientMock.refundByIntent).not.toHaveBeenCalled();
      expect(result.refundStatus).toBe('manual_pending');
    });
  });

  // retryWalletRefund mock: cancelled SO + businessLinks를 상태별로 제어
  function makeRetryContext(
    options: {
      so?: ReturnType<typeof makeSo>;
      currentRefundStatus?: string;
      walletOutcome?: WalletRefundOutcome;
    } = {},
  ) {
    const so = options.so ?? makeSo({ status: 'cancelled' });
    const walletOutcome = options.walletOutcome ?? {
      kind: 'success',
      refunds: [
        {
          refundId: 'rf-002',
          intentId: WALLET_INTENT_ID,
          status: 'SUCCEEDED',
          amount: 50000,
          currency: 'KRW',
          reasonCode: null,
          reasonMessage: null,
          manualConfirmable: false,
        },
      ],
    };

    const refundLink =
      options.currentRefundStatus !== undefined
        ? { metadata: { refundStatus: options.currentRefundStatus } }
        : undefined;

    const dbMock = {
      db: {
        select: jest.fn().mockImplementation(() => ({
          from: jest.fn().mockImplementation(() => ({
            where: jest.fn().mockImplementation(() => ({
              // findSoOrThrow
              limit: jest.fn().mockReturnValue({
                then: jest.fn((fn: (r: unknown[]) => unknown) => fn([so])),
              }),
              // businessLinks orderBy().limit().then()
              orderBy: jest.fn().mockReturnValue({
                limit: jest.fn().mockReturnValue({
                  then: jest.fn((fn: (r: unknown[]) => unknown) => fn(refundLink ? [refundLink] : [])),
                }),
              }),
            })),
          })),
        })),
      },
    };

    const salesOrdersServiceMock = {
      cancel: jest.fn().mockResolvedValue(undefined),
      createBusinessLink: jest.fn().mockResolvedValue(undefined),
    };

    const walletClientMock: Partial<WalletRefundClient> = {
      refundByIntent: jest.fn().mockResolvedValue(walletOutcome),
    };

    const service = new StoreSalesOrdersService(
      dbMock as any,
      salesOrdersServiceMock as any,
      walletClientMock as WalletRefundClient,
    );

    return { service, walletClientMock };
  }

  describe('retryWalletRefund', () => {
    it('status=succeeded → Wallet 미호출, succeeded 반환', async () => {
      const { service, walletClientMock } = makeRetryContext({ currentRefundStatus: 'succeeded' });
      const result = await service.retryWalletRefund(SO_ID);
      expect(walletClientMock.refundByIntent).not.toHaveBeenCalled();
      expect(result.refundStatus).toBe('succeeded');
    });

    it('status=pending → Wallet 미호출, pending 반환 (중복 재시도 방지)', async () => {
      const { service, walletClientMock } = makeRetryContext({ currentRefundStatus: 'pending' });
      const result = await service.retryWalletRefund(SO_ID);
      expect(walletClientMock.refundByIntent).not.toHaveBeenCalled();
      expect(result.refundStatus).toBe('pending');
    });

    it('walletIntentId 없으면 400 (수동 처리 필요)', async () => {
      const { service } = makeRetryContext({
        so: makeSo({ status: 'cancelled', walletIntentId: null }),
        currentRefundStatus: 'manual_pending',
      });
      await expect(service.retryWalletRefund(SO_ID)).rejects.toThrow('자동 재시도가 불가합니다');
    });

    it('totalAmount 없으면 400 (수동 처리 필요)', async () => {
      const { service } = makeRetryContext({
        so: makeSo({ status: 'cancelled', totalAmount: null }),
        currentRefundStatus: 'manual_pending',
      });
      await expect(service.retryWalletRefund(SO_ID)).rejects.toThrow('환불 금액 정보가 없어');
    });

    it('status=failed → 새 idempotency key cancel:{id}:retry:* 로 Wallet 호출', async () => {
      const { service, walletClientMock } = makeRetryContext({ currentRefundStatus: 'failed' });
      const result = await service.retryWalletRefund(SO_ID);
      expect(walletClientMock.refundByIntent).toHaveBeenCalledWith(
        WALLET_INTENT_ID,
        50000,
        expect.objectContaining({
          correlationId: expect.stringMatching(/^cancel:so-001:retry:/),
        }),
      );
      expect(result.refundStatus).toBe('succeeded');
    });

    it('링크 없음 → 새 key로 Wallet 호출 (첫 실패 시 링크 없는 경우 포함)', async () => {
      // currentRefundStatus undefined → refundLink 없음
      const { service, walletClientMock } = makeRetryContext();
      const result = await service.retryWalletRefund(SO_ID);
      expect(walletClientMock.refundByIntent).toHaveBeenCalledWith(
        WALLET_INTENT_ID,
        50000,
        expect.objectContaining({
          correlationId: expect.stringMatching(/^cancel:so-001:retry:/),
        }),
      );
      expect(result.refundStatus).toBe('succeeded');
    });

    it('failed 재시도에서 초기 취소 key cancel:{id}는 사용하지 않음', async () => {
      const { service, walletClientMock } = makeRetryContext({ currentRefundStatus: 'failed' });
      await service.retryWalletRefund(SO_ID);
      const calledWith = (walletClientMock.refundByIntent as jest.Mock).mock.calls[0][2] as { correlationId: string };
      expect(calledWith.correlationId).not.toBe(`cancel:${SO_ID}`);
    });

    it('재시도 correlationId는 :retry: 포함 per-attempt 형식, initial key 미사용', async () => {
      const { service, walletClientMock } = makeRetryContext({ currentRefundStatus: 'failed' });
      await service.retryWalletRefund(SO_ID);
      const calledWith = (walletClientMock.refundByIntent as jest.Mock).mock.calls[0][2] as { correlationId: string };
      expect(calledWith.correlationId).toMatch(/^cancel:so-001:retry:[0-9a-f-]{36}$/);
      expect(calledWith.correlationId).not.toContain(':initial:');
    });

    it('취소되지 않은 주문이면 400', async () => {
      const { service } = makeRetryContext({ so: makeSo({ status: 'confirmed' }) });
      await expect(service.retryWalletRefund(SO_ID)).rejects.toThrow('취소된 주문에만 환불 재시도를 할 수 있습니다.');
    });
  });

  describe('tracking query V2 graph', () => {
    function makeTrackingService(rowsBySelect: unknown[][]) {
      let call = 0;
      const dbMock = {
        db: {
          select: jest.fn().mockImplementation(() => ({
            from: jest.fn().mockImplementation(() => ({
              where: jest.fn().mockImplementation(() => {
                const rows = rowsBySelect[call++] ?? [];
                const promise = Promise.resolve(rows);
                return {
                  then: promise.then.bind(promise),
                  limit: jest.fn().mockReturnValue(promise),
                  orderBy: jest.fn().mockReturnValue(promise),
                };
              }),
            })),
          })),
        },
      };
      return new StoreSalesOrdersService(dbMock as never, {} as never, {} as WalletRefundClient);
    }

    const fo = (id: string, overrides: Record<string, unknown> = {}) => ({
      id,
      salesOrderId: SO_ID,
      status: 'shipped',
      shippedAt: new Date('2026-07-14T00:00:00Z'),
      ...overrides,
    });
    const item = (id: string, fulfillmentOrderId: string, salesOrderLineId: string) => ({
      id,
      fulfillmentOrderId,
      salesOrderId: SO_ID,
      salesOrderLineId,
    });
    const shipment = { id: 'shipment-shared', status: 'in_transit' };

    it('합배송 shipment에서 해당 SO line만 보여주고 recalled attempt와 재출고 tracking을 모두 보존한다', async () => {
      const oldDispatchedAt = new Date('2026-07-14T01:00:00Z');
      const recalledAt = new Date('2026-07-14T02:00:00Z');
      const newDispatchedAt = new Date('2026-07-14T03:00:00Z');
      const service = makeTrackingService([
        [makeSo()],
        [fo('fo-1')],
        [item('foi-1', 'fo-1', 'sol-1')],
        [
          {
            id: 'shipment-line-own',
            shipmentId: shipment.id,
            fulfillmentOrderItemId: 'foi-1',
            skuId: 'sku-1',
            qty: 2,
          },
        ],
        [shipment],
        [
          {
            id: 'attempt-1',
            shipmentId: shipment.id,
            attemptNo: 1,
            status: 'recalled',
            invoiceId: 'invoice-1',
            dispatchedAt: oldDispatchedAt,
            carrierAcceptedAt: null,
            recalledAt,
          },
          {
            id: 'attempt-2',
            shipmentId: shipment.id,
            attemptNo: 2,
            status: 'dispatched',
            invoiceId: 'invoice-2',
            dispatchedAt: newDispatchedAt,
            carrierAcceptedAt: newDispatchedAt,
            recalledAt: null,
          },
        ],
        [
          { id: 'invoice-1', carrier: 'CJ', trackingNo: 'OLD-TRACKING' },
          { id: 'invoice-2', carrier: 'HANJIN', trackingNo: 'NEW-TRACKING' },
        ],
        [
          {
            shipmentId: shipment.id,
            dispatchAttemptId: 'attempt-1',
            status: 'delivered',
            location: 'old destination',
            timestamp: new Date('2026-07-14T02:30:00Z'),
          },
          {
            shipmentId: shipment.id,
            dispatchAttemptId: 'attempt-2',
            status: 'in_transit',
            location: 'new hub',
            timestamp: new Date('2026-07-14T04:00:00Z'),
          },
        ],
        [{ id: 'sol-1', channelOrderItemId: 'channel-item-1' }],
      ]);

      const result = await service.getTracking(SO_ID, CUSTOMER_ID);

      expect(result.status).toBe('shipping');
      expect(result.shipments).toHaveLength(1);
      expect(result.shipments[0]).toMatchObject({
        shipmentId: shipment.id,
        fulfillmentOrderIds: ['fo-1'],
        trackingNumber: 'NEW-TRACKING',
        status: 'in_transit',
        lines: [
          {
            shipmentLineId: 'shipment-line-own',
            fulfillmentOrderItemId: 'foi-1',
            salesOrderLineId: 'sol-1',
            channelOrderItemId: 'channel-item-1',
            quantity: 2,
          },
        ],
      });
      expect(result.shipments[0].dispatchAttempts).toEqual([
        expect.objectContaining({
          dispatchAttemptId: 'attempt-1',
          attemptNo: 1,
          recalled: true,
          recalledAt,
          trackingNumber: 'OLD-TRACKING',
        }),
        expect.objectContaining({
          dispatchAttemptId: 'attempt-2',
          attemptNo: 2,
          recalled: false,
          trackingNumber: 'NEW-TRACKING',
        }),
      ]);
    });

    it('FO completed 상태만으로 delivered를 만들지 않고 최신 carrier attempt evidence를 사용한다', async () => {
      const service = makeTrackingService([
        [makeSo()],
        [fo('fo-completed', { status: 'completed' })],
        [item('foi-completed', 'fo-completed', 'sol-completed')],
        [
          {
            id: 'shipment-line-completed',
            shipmentId: shipment.id,
            fulfillmentOrderItemId: 'foi-completed',
            skuId: 'sku-1',
            qty: 1,
          },
        ],
        [shipment],
        [
          {
            id: 'attempt-pending',
            shipmentId: shipment.id,
            attemptNo: 1,
            status: 'pending',
            invoiceId: 'invoice-pending',
            dispatchedAt: null,
            carrierAcceptedAt: null,
            recalledAt: null,
          },
        ],
        [{ id: 'invoice-pending', carrier: 'CJ', trackingNo: 'PENDING-TRACKING' }],
        [],
        [{ id: 'sol-completed', channelOrderItemId: null }],
      ]);

      const result = await service.getTracking(SO_ID, CUSTOMER_ID);

      expect(result.status).toBe('preparing');
      expect(result.shipments[0].status).toBe('pending');
      expect(result.shipments[0].deliveredAt).toBeNull();
    });

    it('attempt가 없는 legacy line shipment의 flat tracking에는 voided 송장이 아니라 active 송장을 쓴다', async () => {
      const service = makeTrackingService([
        [makeSo()],
        [fo('fo-legacy-line')],
        [item('foi-legacy-line', 'fo-legacy-line', 'sol-legacy-line')],
        [
          {
            id: 'shipment-line-legacy',
            shipmentId: shipment.id,
            fulfillmentOrderItemId: 'foi-legacy-line',
            skuId: 'sku-1',
            qty: 1,
          },
        ],
        [{ ...shipment, status: 'shipped', shippedAt: new Date('2026-07-14T01:00:00Z'), deliveredAt: null }],
        [],
        [
          {
            id: 'invoice-voided',
            shipmentId: shipment.id,
            status: 'voided',
            carrier: 'CJ',
            trackingNo: 'VOIDED-TRACKING',
          },
          {
            id: 'invoice-active',
            shipmentId: shipment.id,
            status: 'used',
            carrier: 'HANJIN',
            trackingNo: 'ACTIVE-TRACKING',
          },
        ],
        [],
        [{ id: 'sol-legacy-line', channelOrderItemId: null }],
      ]);

      const result = await service.getTracking(SO_ID, CUSTOMER_ID);

      expect(result.shipments[0]).toMatchObject({
        trackingNumber: 'ACTIVE-TRACKING',
        carrier: 'HANJIN',
        dispatchAttempts: [],
      });
    });

    it('V2 shipment line이 없는 legacy FO-header shipment를 fallback으로 읽는다', async () => {
      const deliveredAt = new Date('2026-07-14T05:00:00Z');
      const service = makeTrackingService([
        [makeSo()],
        [fo('legacy-fo')],
        [],
        [
          {
            id: 'legacy-shipment',
            openedForFulfillmentOrderId: 'legacy-fo',
            status: 'delivered',
            shippedAt: new Date('2026-07-14T01:00:00Z'),
            deliveredAt,
          },
        ],
        [
          {
            id: 'legacy-invoice',
            issuedForFulfillmentOrderId: 'legacy-fo',
            carrier: 'CJ',
            trackingNo: 'LEGACY-TRACKING',
          },
        ],
        [
          {
            shipmentId: 'legacy-shipment',
            dispatchAttemptId: null,
            status: 'delivered',
            location: 'legacy destination',
            timestamp: deliveredAt,
          },
        ],
      ]);

      const result = await service.getTracking(SO_ID, CUSTOMER_ID);

      expect(result.status).toBe('delivered');
      expect(result.shipments[0]).toMatchObject({
        shipmentId: 'legacy-shipment',
        fulfillmentOrderId: 'legacy-fo',
        trackingNumber: 'LEGACY-TRACKING',
        lines: [],
        dispatchAttempts: [],
      });
      expect(result.shipments[0].trackingEvents).toHaveLength(1);
    });

    it('shipment가 아직 없는 선발급 legacy FO invoice도 fallback으로 읽는다', async () => {
      const service = makeTrackingService([
        [makeSo()],
        [fo('legacy-invoice-fo', { shippedAt: null })],
        [],
        [],
        [
          {
            id: 'legacy-issued-invoice',
            issuedForFulfillmentOrderId: 'legacy-invoice-fo',
            carrier: 'CJ',
            trackingNo: 'PREISSUED-TRACKING',
          },
        ],
      ]);

      const result = await service.getTracking(SO_ID, CUSTOMER_ID);

      expect(result.status).toBe('preparing');
      expect(result.shipments).toEqual([
        expect.objectContaining({
          shipmentId: null,
          fulfillmentOrderId: 'legacy-invoice-fo',
          trackingNumber: 'PREISSUED-TRACKING',
          status: 'created',
        }),
      ]);
    });
  });
});
