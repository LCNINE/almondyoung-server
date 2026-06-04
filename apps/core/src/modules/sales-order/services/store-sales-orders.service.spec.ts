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

function makeContext(options: {
  so?: ReturnType<typeof makeSo>;
  fos?: { status: string; shippedAt: Date | null }[];
  walletOutcome?: WalletRefundOutcome;
  cancelError?: Error;
  businessLinkError?: Error;
} = {}) {
  const so = options.so ?? makeSo();
  const fos = options.fos ?? [];
  const walletOutcome = options.walletOutcome ?? { kind: 'success', refunds: [{ refundId: 'rf-001', intentId: WALLET_INTENT_ID, status: 'SUCCEEDED', amount: 50000, currency: 'KRW', reasonCode: null, reasonMessage: null, manualConfirmable: false }] };

  // Each where() call gets a fresh mock object so we can distinguish:
  //   call 0: findSoOrThrow — limit().then() → [so]
  //   call 1+: FO / returnRequests / exchangeRequests / businessLinks
  //     - then() directly (no limit) → fos      (fulfillment order list)
  //     - limit().then()             → []        (return/exchange/businessLinks single-row lookups)
  //     - orderBy().limit().then()   → []        (businessLinks ordered lookup)
  let whereCallIndex = 0;
  const dbMock = {
    db: {
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
                limit: jest.fn().mockReturnValue({
                  then: jest.fn((fn: (r: unknown[]) => unknown) => fn([])),
                }),
              }),
            };
          }),
        })),
      })),
    },
  };

  const salesOrdersServiceMock = {
    cancel: options.cancelError
      ? jest.fn().mockRejectedValue(options.cancelError)
      : jest.fn().mockResolvedValue(undefined),
    createBusinessLink: options.businessLinkError
      ? jest.fn().mockRejectedValue(options.businessLinkError)
      : jest.fn().mockResolvedValue(undefined),
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
          refunds: [{ refundId: 'rf-002', intentId: WALLET_INTENT_ID, status: 'PENDING', amount: 50000, currency: 'KRW', reasonCode: null, reasonMessage: null, manualConfirmable: true }],
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
        walletOutcome: { kind: 'already_refunded', errorCode: 'REFUND_AMOUNT_EXCEEDS_AVAILABLE', errorMessage: '환불 가능 금액 초과' },
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
  function makeAdminContext(options: {
    so?: ReturnType<typeof makeSo>;
    walletOutcome?: WalletRefundOutcome;
    cancelError?: Error;
  } = {}) {
    const so = options.so ?? makeSo();
    const walletOutcome = options.walletOutcome ?? {
      kind: 'success',
      refunds: [{
        refundId: 'rf-001',
        intentId: WALLET_INTENT_ID,
        status: 'SUCCEEDED',
        amount: 50000,
        currency: 'KRW',
        reasonCode: null,
        reasonMessage: null,
        manualConfirmable: false,
      }],
    };

    const dbMock = {
      db: {
        select: jest.fn().mockImplementation(() => ({
          from: jest.fn().mockImplementation(() => ({
            where: jest.fn().mockImplementation(() => ({
              limit: jest.fn().mockReturnValue({
                then: jest.fn((fn: (r: unknown[]) => unknown) => fn([so])),
              }),
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

    it('lines 있으면 부분취소 — Wallet 미호출, refundStatus=manual_pending', async () => {
      const { service, walletClientMock, salesOrdersServiceMock } = makeAdminContext();
      const lines = [{ salesOrderLineId: 'line-001', quantity: 1 }];
      const result = await service.adminCancelRequest(SO_ID, { lines });
      expect(walletClientMock.refundByIntent).not.toHaveBeenCalled();
      expect(salesOrdersServiceMock.cancel).toHaveBeenCalledWith(
        SO_ID,
        expect.objectContaining({ lines, cancelledBy: 'admin' }),
      );
      expect(result.refundStatus).toBe('manual_pending');
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
  function makeRetryContext(options: {
    so?: ReturnType<typeof makeSo>;
    currentRefundStatus?: string;
    walletOutcome?: WalletRefundOutcome;
  } = {}) {
    const so = options.so ?? makeSo({ status: 'cancelled' });
    const walletOutcome = options.walletOutcome ?? {
      kind: 'success',
      refunds: [{
        refundId: 'rf-002',
        intentId: WALLET_INTENT_ID,
        status: 'SUCCEEDED',
        amount: 50000,
        currency: 'KRW',
        reasonCode: null,
        reasonMessage: null,
        manualConfirmable: false,
      }],
    };

    const refundLink = options.currentRefundStatus !== undefined
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
});
