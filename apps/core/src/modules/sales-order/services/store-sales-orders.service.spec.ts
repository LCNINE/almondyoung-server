import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { getTableName } from 'drizzle-orm';
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
    fos?: { status: string; directShipStatus?: string | null; fulfillmentMode?: string | null }[];
    activeShipmentStatuses?: string[];
    walletOutcome?: WalletRefundOutcome;
    cancelError?: Error;
    businessLinkError?: Error;
    openRequestView?: Record<string, unknown> | null;
    replayView?: Record<string, unknown> | null;
    /** 이 주문에 다운로드(exercise)된 디지털 상품 ownership 이 있는지 */
    exercisedDigital?: boolean;
  } = {},
) {
  const so = options.so ?? makeSo();
  const fos = (options.fos ?? []).map((fo) => ({
    directShipStatus: null,
    fulfillmentMode: null,
    shippedAt: null,
    ...fo,
  }));
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
      execute: jest
        .fn()
        .mockResolvedValue((options.activeShipmentStatuses ?? []).map((status) => ({ id: `sh-${status}`, status }))),
      select: jest.fn().mockImplementation(() => ({
        from: jest.fn().mockImplementation((table: unknown) => ({
          where: jest.fn().mockImplementation(() => {
            const idx = whereCallIndex++;
            const isOwnership =
              getTableName(table as Parameters<typeof getTableName>[0]) === 'digital_asset_ownerships';
            return {
              limit: jest.fn().mockReturnValue({
                then: jest.fn((fn: (r: unknown[]) => unknown) =>
                  fn(isOwnership ? (options.exercisedDigital ? [{ id: 'own-1' }] : []) : idx === 0 ? [so] : []),
                ),
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
  };

  const walletClientMock: Partial<WalletRefundClient> = {
    refundByIntent: jest.fn().mockResolvedValue(walletOutcome),
  };

  const cancelRequestsMock = {
    request: jest.fn().mockResolvedValue({
      id: 'req-1',
      status: 'requested',
      scope: 'full',
      stage: null,
      convertedFromFull: false,
      requestedAt: '2026-10-07T00:00:00.000Z',
      rejection: null,
      outcome: null,
    }),
    findBySourceKey: jest.fn().mockResolvedValue(options.replayView ?? null),
    latestFor: jest.fn().mockResolvedValue(options.openRequestView ?? null),
  };

  const service = new StoreSalesOrdersService(
    dbMock as any,
    salesOrdersServiceMock as any,
    walletClientMock as WalletRefundClient,
    cancelRequestsMock as any,
  );

  return { service, dbMock, salesOrdersServiceMock, walletClientMock, cancelRequestsMock };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('StoreSalesOrdersService', () => {
  describe('cancelRequestByChannelOrder', () => {
    it('이미 취소된 주문에 중복 취소 요청 시 400', async () => {
      const { service, cancelRequestsMock } = makeContext({ so: makeSo({ status: 'cancelled' }) });
      await expect(service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {})).rejects.toThrow(
        '이미 취소된 주문입니다.',
      );
      expect(cancelRequestsMock.request).not.toHaveBeenCalled();
    });

    it('타임아웃 주문 취소 요청 시 400', async () => {
      const { service, cancelRequestsMock } = makeContext({ so: makeSo({ status: 'timeout' }) });
      await expect(service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {})).rejects.toThrow(
        '타임아웃된 주문은 취소할 수 없습니다.',
      );
      expect(cancelRequestsMock.request).not.toHaveBeenCalled();
    });

    it('본인이 아닌 고객이 취소 요청 시 403', async () => {
      const { service } = makeContext();
      await expect(service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, 'other-customer', {})).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('Medusa가 아닌 채널 주문은 취소 불가', async () => {
      const { service, cancelRequestsMock } = makeContext({ so: makeSo({ salesChannel: 'naver' }) });
      await expect(service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {})).rejects.toThrow(
        'naver 채널 주문은 해당 채널에서 직접 취소해 주세요.',
      );
      expect(cancelRequestsMock.request).not.toHaveBeenCalled();
    });

    it('출고증거(shippedAt) 있는 주문은 고객 직접 취소 불가 (400)', async () => {
      const { service, cancelRequestsMock } = makeContext({ fos: [{ status: 'shipped' }] });
      await expect(service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {})).rejects.toThrow(
        '이미 출고된 주문은 취소할 수 없습니다.',
      );
      expect(cancelRequestsMock.request).not.toHaveBeenCalled();
    });

    it('피킹 시작(FO processing) 주문은 셀프 취소 시 400', async () => {
      const { service, cancelRequestsMock } = makeContext({ fos: [{ status: 'processing' }] });
      await expect(service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {})).rejects.toThrow(
        '피킹이 시작된',
      );
      expect(cancelRequestsMock.request).not.toHaveBeenCalled();
    });

    it('부분 출고(상자 shipped) 주문은 셀프 취소 시 400', async () => {
      const { service, cancelRequestsMock } = makeContext({
        fos: [{ status: 'partially_shipped' }],
        activeShipmentStatuses: ['shipped', 'draft'],
      });
      await expect(service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {})).rejects.toThrow('이미 출고');
      expect(cancelRequestsMock.request).not.toHaveBeenCalled();
    });

    it('다운로드한 디지털 상품이 포함된 주문은 셀프 취소 시 400', async () => {
      const { service, cancelRequestsMock } = makeContext({ exercisedDigital: true });
      await expect(service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {})).rejects.toThrow(
        '이미 다운로드한 디지털 상품',
      );
      expect(cancelRequestsMock.request).not.toHaveBeenCalled();
    });

    it('디지털 상품이 있어도 미다운로드면 셀프 취소 성공', async () => {
      const { service, cancelRequestsMock } = makeContext({ exercisedDigital: false });
      await service.cancelRequestByChannelOrder(
        CHANNEL_ORDER_ID,
        CUSTOMER_ID,
        {},
        { idempotencyKey: 'k', actorId: CUSTOMER_ID, actorRoles: [] },
      );
      expect(cancelRequestsMock.request).toHaveBeenCalled();
    });

    it('준비중(FO ready, 미피킹) 주문은 셀프 취소 성공', async () => {
      const { service, cancelRequestsMock } = makeContext({ fos: [{ status: 'ready' }] });
      const r = await service.cancelRequestByChannelOrder(
        CHANNEL_ORDER_ID,
        CUSTOMER_ID,
        {},
        { idempotencyKey: 'k', actorId: CUSTOMER_ID, actorRoles: [] },
      );
      expect(cancelRequestsMock.request).toHaveBeenCalled();
      expect(r.orderStatus).toBe('confirmed');
    });

    it('고객 취소는 요청을 기록하고 core 취소·Wallet 을 부르지 않는다 (ADR-0042 원칙 1)', async () => {
      const { service, salesOrdersServiceMock, walletClientMock, cancelRequestsMock } = makeContext();
      const context = { idempotencyKey: 'k-1', actorId: CUSTOMER_ID, actorRoles: ['customer'] };
      await service.cancelRequestByChannelOrder(
        CHANNEL_ORDER_ID,
        CUSTOMER_ID,
        { reasonCode: 'OTHER', reasonDetail: '변심' },
        context,
      );
      expect(cancelRequestsMock.request).toHaveBeenCalledWith({
        salesOrderId: SO_ID,
        requester: { kind: 'customer', customerId: CUSTOMER_ID },
        sourceKey: 'k-1',
        reasonCode: 'OTHER',
        reasonDetail: '변심',
      });
      expect(salesOrdersServiceMock.cancel).not.toHaveBeenCalled();
      expect(walletClientMock.refundByIntent).not.toHaveBeenCalled();
    });

    it('같은 키 재요청은 가드보다 먼저 지금 뷰를 돌려준다 — 이미 취소된 뒤여도 400 이 아니다', async () => {
      const { service, cancelRequestsMock } = makeContext({
        so: makeSo({ status: 'cancelled' }),
        replayView: { id: 'req-1', status: 'applied' },
      });
      const context = { idempotencyKey: 'k-1', actorId: CUSTOMER_ID, actorRoles: ['customer'] };
      await expect(
        service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {}, context),
      ).resolves.toMatchObject({
        orderStatus: 'cancelled',
      });
      expect(cancelRequestsMock.request).not.toHaveBeenCalled();
    });

    it('Idempotency-Key 없는 고객 취소는 400', async () => {
      const { service } = makeContext();
      await expect(service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {})).rejects.toThrow(
        'Idempotency-Key header is required',
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
        {} as any,
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
      expect(result[0].availableActions).toContain('cancel');
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
        fos: [{ status: 'completed' }],
        activeShipmentStatuses: ['delivered'],
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
        fos: [{ status: 'completed' }],
        activeShipmentStatuses: ['delivered'],
      });
      const result = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
      expect(result.availableActions).toContain('return');
      expect(result.availableActions).toContain('exchange');
    });

    it('배송중(shipped, FO=shipped)이면 return/exchange 불가', async () => {
      const { service } = makeContext({
        so: makeSo({ status: 'shipped' }),
        fos: [{ status: 'shipped' }],
        activeShipmentStatuses: ['shipped'],
      });
      const result = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
      expect(result.availableActions).not.toContain('return');
      expect(result.availableActions).not.toContain('exchange');
      expect(result.availableActions).toContain('track');
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
        fos: [{ status: 'shipped' }],
        activeShipmentStatuses: ['shipped'],
      });
      const result = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
      expect(result.availableActions).not.toContain('return');
      expect(result.availableActions).not.toContain('exchange');
    });

    describe('buildActionsView fulfillmentStatus (V2)', () => {
      it('FO 없음 → not_created', async () => {
        const { service } = makeContext({ fos: [] });
        const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(r.fulfillmentStatus).toBe('not_created');
      });
      it('FO ready, 상자 미로드 → preparing', async () => {
        const { service } = makeContext({ fos: [{ status: 'ready' }] });
        const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(r.fulfillmentStatus).toBe('preparing');
        expect(r.availableActions).toContain('cancel');
      });
      it('FO processing → preparing + already_processing (셀프취소 불가)', async () => {
        const { service } = makeContext({ fos: [{ status: 'processing' }] });
        const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(r.fulfillmentStatus).toBe('preparing');
        expect(r.availableActions).not.toContain('cancel');
        expect(r.cancelUnavailableReason).toBe('already_processing');
      });
      it('FO partially_shipped + 상자 shipped → shipping + already_shipped', async () => {
        const { service } = makeContext({
          fos: [{ status: 'partially_shipped' }],
          activeShipmentStatuses: ['shipped', 'draft'],
        });
        const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(r.fulfillmentStatus).toBe('shipping');
        expect(r.shipmentProgress).toEqual({ total: 2, shipped: 1, delivered: 0 });
        expect(r.availableActions).not.toContain('cancel');
        expect(r.cancelUnavailableReason).toBe('already_shipped');
      });
      it('FO completed + 상자 전량 delivered → delivered + 반품/교환 노출', async () => {
        const { service } = makeContext({ fos: [{ status: 'completed' }], activeShipmentStatuses: ['delivered'] });
        const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(r.fulfillmentStatus).toBe('delivered');
        expect(r.availableActions).toEqual(expect.arrayContaining(['return', 'exchange']));
      });
      it('부분 배송 + 잔여 상자 recovery_required → shipping + already_shipped (마스킹 방지)', async () => {
        const { service } = makeContext({
          fos: [{ status: 'recovery_required' }],
          activeShipmentStatuses: ['delivered', 'recovery_required'],
        });
        const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(r.fulfillmentStatus).toBe('shipping');
        expect(r.availableActions).not.toContain('cancel');
        expect(r.cancelUnavailableReason).toBe('already_shipped');
      });
      it('recovery_required 이나 출고된 박스 없음 → preparing + cancel 가능', async () => {
        const { service } = makeContext({
          fos: [{ status: 'recovery_required' }],
          activeShipmentStatuses: ['recovery_required'],
        });
        const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(r.fulfillmentStatus).toBe('preparing');
        expect(r.availableActions).toContain('cancel');
      });
      it('직배(drop_ship) forwarded → shipping (loader dropShipStatuses 추출)', async () => {
        const { service } = makeContext({
          fos: [{ status: 'ready', fulfillmentMode: 'drop_ship', directShipStatus: 'forwarded' }],
        });
        const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(r.fulfillmentStatus).toBe('shipping');
        expect(r.availableActions).not.toContain('cancel');
      });
      it('직배 completed → delivered', async () => {
        const { service } = makeContext({
          fos: [{ status: 'ready', fulfillmentMode: 'drop_ship', directShipStatus: 'completed' }],
        });
        const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(r.fulfillmentStatus).toBe('delivered');
      });
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

    const cancelRequestsMock = {
      request: jest.fn().mockResolvedValue({
        id: 'req-1',
        status: 'requested',
        scope: 'full',
        stage: null,
        convertedFromFull: false,
        requestedAt: '2026-10-07T00:00:00.000Z',
        rejection: null,
        outcome: null,
      }),
      findBySourceKey: jest.fn().mockResolvedValue(null),
      latestFor: jest.fn().mockResolvedValue(null),
    };

    const service = new StoreSalesOrdersService(
      dbMock as any,
      salesOrdersServiceMock as any,
      walletClientMock as WalletRefundClient,
      cancelRequestsMock as any,
    );

    return { service, dbMock, salesOrdersServiceMock, walletClientMock, cancelRequestsMock };
  }

  describe('adminCancelRequest', () => {
    const CORE_SO = () => makeSo({ salesChannel: '3pl' });

    it('core 경로(3pl) — lines 없으면 전체취소 — Wallet 환불 호출, refundStatus=succeeded', async () => {
      const { service, walletClientMock } = makeAdminContext({ so: CORE_SO() });
      const result = await service.adminCancelRequest(SO_ID, {});
      expect(walletClientMock.refundByIntent).toHaveBeenCalled();
      expect(result).toMatchObject({ refundStatus: 'succeeded' });
      expect(result).toMatchObject({ status: 'cancelled' });
    });

    it('core 경로(3pl) — 관리자 최초 취소 correlationId는 :initial: 포함 per-attempt 형식', async () => {
      const { service, walletClientMock } = makeAdminContext({ so: CORE_SO() });
      await service.adminCancelRequest(SO_ID, {});
      const calledWith = (walletClientMock.refundByIntent as jest.Mock).mock.calls[0][2] as { correlationId: string };
      expect(calledWith.correlationId).toMatch(/^cancel:so-001:initial:[0-9a-f-]{36}$/);
      expect(calledWith.correlationId).not.toBe(`cancel:${SO_ID}`);
    });

    it('core 경로(3pl) — 부분취소는 지금처럼 manual_pending 기록, Wallet 미호출', async () => {
      const { service, walletClientMock, salesOrdersServiceMock } = makeAdminContext({
        so: CORE_SO(),
        orderLines: [{ id: 'line-001', quantity: 2, unitPrice: 25000 }],
      });
      const lines = [{ salesOrderLineId: 'line-001', quantity: 1 }];
      const result = await service.adminCancelRequest(SO_ID, { lines });
      expect(walletClientMock.refundByIntent).not.toHaveBeenCalled();
      expect(salesOrdersServiceMock.cancel).toHaveBeenCalledWith(
        SO_ID,
        expect.objectContaining({ lines, cancelledBy: 'admin' }),
      );
      expect(result).toMatchObject({ refundStatus: 'manual_pending', manualReason: 'CHANNEL_ORDER' });
    });

    it.each([
      ['naver', '네이버 판매자센터에서 취소해 주세요.'],
      ['coupang', '쿠팡 판매자센터에서 취소해 주세요.'],
    ])('%s 주문은 판매자센터 문구로 400 — core 취소·요청 둘 다 없음', async (salesChannel, message) => {
      const { service, salesOrdersServiceMock, cancelRequestsMock } = makeAdminContext({
        so: makeSo({ salesChannel }),
      });
      await expect(
        service.adminCancelRequest(SO_ID, { lines: [{ salesOrderLineId: 'line-001', quantity: 1 }] }),
      ).rejects.toThrow(message);
      expect(salesOrdersServiceMock.cancel).not.toHaveBeenCalled();
      expect(cancelRequestsMock.request).not.toHaveBeenCalled();
    });

    it('Medusa 주문 — 요청 경로, 응답은 { requestId, status, scope, convertedFromFull }, core 취소·Wallet 없음', async () => {
      const { service, salesOrdersServiceMock, walletClientMock, cancelRequestsMock } = makeAdminContext();
      const lines = [{ salesOrderLineId: 'line-001', quantity: 1 }];
      const result = await service.adminCancelRequest(SO_ID, {
        lines,
        reasonCode: 'CUSTOMER_REQUEST',
        fulfillmentCommandContext: { idempotencyKey: 'k-9', actorId: 'admin-1', actorRoles: ['admin'] },
      });
      expect(cancelRequestsMock.request).toHaveBeenCalledWith({
        salesOrderId: SO_ID,
        lines,
        requester: { kind: 'operator', actorId: 'admin-1' },
        sourceKey: 'k-9',
        reasonCode: 'CUSTOMER_REQUEST',
        reasonDetail: undefined,
      });
      expect(result).toEqual({ requestId: 'req-1', status: 'requested', scope: 'full', convertedFromFull: false });
      expect(salesOrdersServiceMock.cancel).not.toHaveBeenCalled();
      expect(walletClientMock.refundByIntent).not.toHaveBeenCalled();
    });

    it('Medusa 주문인데 Idempotency-Key 컨텍스트가 없으면 400', async () => {
      const { service } = makeAdminContext();
      await expect(service.adminCancelRequest(SO_ID, {})).rejects.toThrow('Idempotency-Key header is required');
    });

    it('core 경로(3pl) — 이미 취소된 주문이면 400', async () => {
      const { service } = makeAdminContext({ so: makeSo({ salesChannel: '3pl', status: 'cancelled' }) });
      await expect(service.adminCancelRequest(SO_ID, {})).rejects.toThrow('이미 취소된 주문입니다.');
    });

    it('core 경로(3pl) — 타임아웃 주문이면 400', async () => {
      const { service } = makeAdminContext({ so: makeSo({ salesChannel: '3pl', status: 'timeout' }) });
      await expect(service.adminCancelRequest(SO_ID, {})).rejects.toThrow('타임아웃된 주문은 취소할 수 없습니다.');
    });

    it('core 경로(3pl) — Core 취소 실패 시 예외 throw, Wallet 미호출', async () => {
      const { service, walletClientMock } = makeAdminContext({ so: CORE_SO(), cancelError: new Error('재고 부족') });
      await expect(service.adminCancelRequest(SO_ID, {})).rejects.toThrow('재고 부족');
      expect(walletClientMock.refundByIntent).not.toHaveBeenCalled();
    });

    it('core 경로(3pl) — walletIntentId 없으면 전체취소도 refundStatus=manual_pending', async () => {
      const { service, walletClientMock } = makeAdminContext({
        so: makeSo({ salesChannel: '3pl', walletIntentId: null }),
      });
      const result = await service.adminCancelRequest(SO_ID, {});
      expect(walletClientMock.refundByIntent).not.toHaveBeenCalled();
      expect(result).toMatchObject({ refundStatus: 'manual_pending' });
    });
  });

  describe('cancelByWalletIntentAfterRefund', () => {
    it('Medusa 주문은 wallet 승인 요청자로 전체취소를 요청한다 — core 취소·Wallet 없음', async () => {
      const { service, salesOrdersServiceMock, walletClientMock, cancelRequestsMock } = makeAdminContext();
      const result = await service.cancelByWalletIntentAfterRefund(WALLET_INTENT_ID, { amount: 50000 });
      expect(cancelRequestsMock.request).toHaveBeenCalledWith({
        salesOrderId: SO_ID,
        requester: { kind: 'wallet-refund-approval', intentId: WALLET_INTENT_ID },
        sourceKey: `wallet-refund-approval:${WALLET_INTENT_ID}`,
        reasonCode: 'CUSTOMER_REFUND_REQUEST',
      });
      expect(result).toEqual({ status: 'requested', requestId: 'req-1' });
      expect(salesOrdersServiceMock.cancel).not.toHaveBeenCalled();
      expect(walletClientMock.refundByIntent).not.toHaveBeenCalled();
    });

    it('이미 취소·출고면 지금처럼 건너뛴다', async () => {
      const cancelled = makeAdminContext({ so: makeSo({ status: 'cancelled' }) });
      await expect(cancelled.service.cancelByWalletIntentAfterRefund(WALLET_INTENT_ID)).resolves.toEqual({
        status: 'cancelled',
        skipped: 'already_cancelled',
      });
      const shipped = makeAdminContext({ so: makeSo({ status: 'shipped' }) });
      await expect(shipped.service.cancelByWalletIntentAfterRefund(WALLET_INTENT_ID)).resolves.toMatchObject({
        skipped: 'already_shipped',
      });
      expect(shipped.cancelRequestsMock.request).not.toHaveBeenCalled();
    });
  });

  describe('가드 — 채널(Medusa) 주문 취소 경로는 WalletRefundClient 를 부르지 않는다 (스펙 §5.7)', () => {
    it.each([
      [
        '운영자 전체',
        (s: StoreSalesOrdersService) =>
          s.adminCancelRequest(SO_ID, {
            fulfillmentCommandContext: { idempotencyKey: 'k', actorId: 'a', actorRoles: [] },
          }),
      ],
      [
        '운영자 부분',
        (s: StoreSalesOrdersService) =>
          s.adminCancelRequest(SO_ID, {
            lines: [{ salesOrderLineId: 'line-001', quantity: 1 }],
            fulfillmentCommandContext: { idempotencyKey: 'k', actorId: 'a', actorRoles: [] },
          }),
      ],
      ['wallet 환불 승인', (s: StoreSalesOrdersService) => s.cancelByWalletIntentAfterRefund(WALLET_INTENT_ID)],
    ])('%s', async (_label, call) => {
      const { service, walletClientMock } = makeAdminContext();
      await call(service);
      expect(walletClientMock.refundByIntent).not.toHaveBeenCalled();
    });

    it('고객', async () => {
      const { service, walletClientMock } = makeContext();
      await service.cancelRequestByChannelOrder(
        CHANNEL_ORDER_ID,
        CUSTOMER_ID,
        {},
        { idempotencyKey: 'k', actorId: CUSTOMER_ID, actorRoles: [] },
      );
      expect(walletClientMock.refundByIntent).not.toHaveBeenCalled();
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

    const cancelRequestsMock = {
      request: jest.fn().mockResolvedValue({
        id: 'req-1',
        status: 'requested',
        scope: 'full',
        stage: null,
        convertedFromFull: false,
        requestedAt: '2026-10-07T00:00:00.000Z',
        rejection: null,
        outcome: null,
      }),
      findBySourceKey: jest.fn().mockResolvedValue(null),
      latestFor: jest.fn().mockResolvedValue(null),
    };

    const service = new StoreSalesOrdersService(
      dbMock as any,
      salesOrdersServiceMock as any,
      walletClientMock as WalletRefundClient,
      cancelRequestsMock as any,
    );

    return { service, walletClientMock, cancelRequestsMock };
  }

  describe('retryWalletRefund', () => {
    it('status=succeeded → Wallet 미호출, succeeded 반환', async () => {
      const { service, walletClientMock } = makeRetryContext({ currentRefundStatus: 'succeeded' });
      const result = await service.retryWalletRefund(SO_ID);
      expect(walletClientMock.refundByIntent).not.toHaveBeenCalled();
      expect(result).toMatchObject({ refundStatus: 'succeeded' });
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
      expect(result).toMatchObject({ refundStatus: 'succeeded' });
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
      expect(result).toMatchObject({ refundStatus: 'succeeded' });
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
      return new StoreSalesOrdersService(dbMock as never, {} as never, {} as WalletRefundClient, {} as never);
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
            waybillId: 'waybill-1',
            dispatchedAt: oldDispatchedAt,
            carrierAcceptedAt: null,
            recalledAt,
          },
          {
            id: 'attempt-2',
            shipmentId: shipment.id,
            attemptNo: 2,
            status: 'dispatched',
            waybillId: 'waybill-2',
            dispatchedAt: newDispatchedAt,
            carrierAcceptedAt: newDispatchedAt,
            recalledAt: null,
          },
        ],
        [
          { id: 'waybill-1', shipmentId: shipment.id, status: 'voided', carrier: 'CJ', trackingNo: 'OLD-TRACKING' },
          { id: 'waybill-2', shipmentId: shipment.id, status: 'used', carrier: 'HANJIN', trackingNo: 'NEW-TRACKING' },
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
          waybillId: 'waybill-1',
          trackingNumber: 'OLD-TRACKING',
        }),
        expect.objectContaining({
          dispatchAttemptId: 'attempt-2',
          attemptNo: 2,
          recalled: false,
          waybillId: 'waybill-2',
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
            waybillId: 'waybill-pending',
            dispatchedAt: null,
            carrierAcceptedAt: null,
            recalledAt: null,
          },
        ],
        [
          {
            id: 'waybill-pending',
            shipmentId: shipment.id,
            status: 'allocated',
            carrier: 'CJ',
            trackingNo: 'PENDING-TRACKING',
          },
        ],
        [],
        [{ id: 'sol-completed', channelOrderItemId: null }],
      ]);

      const result = await service.getTracking(SO_ID, CUSTOMER_ID);

      expect(result.status).toBe('preparing');
      expect(result.shipments[0].status).toBe('pending');
      expect(result.shipments[0].deliveredAt).toBeNull();
    });

    it('attempt가 없는 legacy line shipment의 flat tracking에는 종료된 운송장이 아니라 활성 운송장을 쓴다', async () => {
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
            id: 'waybill-voided',
            shipmentId: shipment.id,
            status: 'voided',
            carrier: 'CJ',
            trackingNo: 'VOIDED-TRACKING',
          },
          {
            id: 'waybill-active',
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
            id: 'legacy-waybill',
            shipmentId: 'legacy-shipment',
            status: 'used',
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

    // NOTE: 구 legacy 빌더의 "shipment 없는 선발급 invoice" fallback 은 waybill 모델에서 제거됨 —
    // waybills 는 shipmentId(notNull) 로만 존재하므로 shipment-less 운송장 표시 경로가 구조적으로 사라졌다.
  });
});
