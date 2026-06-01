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

  const dbMock = {
    db: {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              then: jest.fn((fn: (r: unknown[]) => unknown) => fn([so])),
            }),
            then: jest.fn((fn: (r: unknown[]) => unknown) => fn(fos)),
          }),
        }),
      }),
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
});
