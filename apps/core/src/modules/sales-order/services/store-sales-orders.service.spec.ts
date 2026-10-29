import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getTableName, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { StoreSalesOrdersService, storeRefundStatusOf } from './store-sales-orders.service';
import { CancellationRefundManager } from '../cancellation-refund/cancellation-refund.manager';
import { OrderCancellation } from '../order-cancellation/order-cancellation';
import { OrderCancellationReader } from '../order-cancellation/order-cancellation.reader';
import { PrintOrderReader } from '../../print-order/services/print-order.reader';
import {
  PRINT_IN_PRODUCTION_MESSAGE,
  PrintInProductionError,
  PrintNeedsPartialCancelError,
  PrintOrderCancellationManager,
  PrintPartialCancelAvailableError,
} from '../../print-order/services/print-order-cancellation.manager';
import { WalletRefundClient, WalletRefundOutcome } from './wallet-refund.client';
import {
  readOrderFulfillmentPhases,
  type OrderFulfillmentPhase,
} from '../line-quantities/order-fulfillment-phase.reader';
import { readParcelClaimEligibility } from '../line-quantities/parcel-claim-eligibility.reader';

// 진행 단계는 사다리 SQL 한 벌이 정하고 그 판정은 order-fulfillment-phase.integration.spec.ts 가 소유한다.
// 여기서는 사다리가 낸 (storePhase, anyShipped) 를 넣고 actions·취소 사유만 본다.
jest.mock('../line-quantities/order-fulfillment-phase.reader');
const readPhases = jest.mocked(readOrderFulfillmentPhases);

// 반품·교환 버튼은 청구 가능한 소포(claimable > 0)로 열고 그 판정은 order-fulfillment-phase.integration.spec.ts 가 소유한다(K6 PR3a, C8).
// 여기서는 소포가 청구 가능한지만 넣는다 — 기본은 사다리가 «배송완료»를 낸 주문만 청구 가능.
jest.mock('../line-quantities/parcel-claim-eligibility.reader');
const readClaimEligibility = jest.mocked(readParcelClaimEligibility);

function mockClaimable(parcels: Array<{ salesOrderLineId: string; claimable: number }>) {
  readClaimEligibility.mockResolvedValue(
    parcels.map((parcel) => parcel as Awaited<ReturnType<typeof readParcelClaimEligibility>>[number]),
  );
}

function mockPhase(over: Partial<OrderFulfillmentPhase> = {}) {
  const phase: OrderFulfillmentPhase = { adminPhase: 'preparing', storePhase: 'preparing', anyShipped: false, ...over };
  readPhases.mockImplementation((_db, ids) => Promise.resolve(new Map(ids.map((id) => [id, phase]))));
}

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

function printReaderMock(rows: Array<Record<string, unknown>> = [], allOutsourced = false): PrintOrderReader {
  const fake = {
    forSalesOrder: jest.fn().mockResolvedValue(rows),
    isAllOutsourced: jest.fn().mockResolvedValue(allOutsourced),
  };
  // 클래스의 private db 필드 때문에 구조 대입이 안 되는 부분 가짜
  return fake as unknown as PrintOrderReader;
}

const PRINT_RESULT = { vendorCancelled: ['po-1'], locallyCancelled: [] };

function printCancelMock(
  cancelForOrder: jest.Mock = jest.fn().mockResolvedValue(PRINT_RESULT),
  noteSalesCancelFailed: jest.Mock = jest.fn().mockResolvedValue(undefined),
  holdUnsent: jest.Mock = jest.fn().mockResolvedValue(undefined),
) {
  // 클래스의 private 필드 때문에 구조 대입이 안 되는 부분 가짜
  return {
    cancelForOrder,
    noteSalesCancelFailed,
    holdUnsent,
  } as unknown as PrintOrderCancellationManager;
}

function makeContext(
  options: {
    so?: ReturnType<typeof makeSo>;
    fos?: { status: string }[];
    /** 창고 상자 status(canceled·superseded 제외) */
    activeShipmentStatuses?: string[];
    /** 입점사 상자(K3 PR4) — 단계는 `supplier-shipment-stage.ts` 가 정한다 */
    supplierShipments?: Array<{ status: 'draft' | 'recovery_required' | 'shipped'; supplierHandoffId: string | null }>;
    printOrders?: Array<Record<string, unknown>>;
    allOutsourced?: boolean;
    /** 판매주문이 아직 없다(수집 전) */
    noSalesOrder?: boolean;
    /** 인쇄가 아닌 판매주문 줄이 있는가 */
    nonPrintLine?: boolean;
    /** 전체 취소 계획의 남은 줄 */
    planLines?: Array<{ salesOrderLineId: string; quantity: number }>;
    walletOutcome?: WalletRefundOutcome;
    cancelError?: Error;
    businessLinkError?: Error;
    replayView?: Record<string, unknown> | null;
    refundLinks?: Array<{ relationName: string; metadata: Record<string, unknown>; createdAt: Date }>;
    /** 이 주문에 다운로드(exercise)된 디지털 상품 ownership 이 있는지 */
    exercisedDigital?: boolean;
    /** 취소 요청(확정 트랜잭션)이 끝난 뒤 판매주문 — 요청 뒤 다시 읽으면 이 값이 나온다 */
    soAfterRequest?: ReturnType<typeof makeSo>;
    /** 채널 취소 정산 사실(최근 순) */
    settlementFacts?: Array<Record<string, unknown>>;
    /** wallet 환불 목록. null = 실패·시간 초과 */
    walletRefunds?: Array<Record<string, unknown>> | null;
    printCancel?: jest.Mock;
    /** 사다리가 낸 이 주문의 단계. 기본은 준비중·나간 것 없음 */
    phase?: Partial<OrderFulfillmentPhase>;
    /** 청구 가능한 소포 수량(일반 줄 소포 하나). 기본은 사다리 단계가 delivered 면 1, 아니면 0 */
    claimable?: number;
    /** 소포별 청구 가능 수량 — 주면 `claimable` 대신 쓴다(인쇄 줄 소포를 섞을 때) */
    claimableParcels?: Array<{ salesOrderLineId: string; claimable: number }>;
    /** 그 판매주문의 인쇄 줄(almond_design_id 있음) id — 조회 mock 은 조건을 보지 않고 이 값을 낸다 */
    printLineIds?: string[];
    /** 진행 중 반품 예정 기록(customer_returns)이 있는가 — 조회 mock 은 상태 필터를 보지 않고 이 값을 낸다 */
    activeCustomerReturn?: boolean;
  } = {},
) {
  mockPhase(options.phase);
  mockClaimable(
    options.claimableParcels ?? [
      {
        salesOrderLineId: 'normal-line',
        claimable: options.claimable ?? (options.phase?.storePhase === 'delivered' ? 1 : 0),
      },
    ],
  );
  const so = options.so ?? makeSo();
  let currentSo = so;
  const printCancel = options.printCancel ?? jest.fn().mockResolvedValue(PRINT_RESULT);
  const printNote = jest.fn().mockResolvedValue(undefined);
  const fos = (options.fos ?? []).map((fo) => ({ shippedAt: null, ...fo }));
  const supplierShipmentRows = (options.supplierShipments ?? []).map((box, i) => ({
    id: `supplier-sh-${i}`,
    status: box.status,
    supplier_handoff_id: box.supplierHandoffId,
  }));
  const warehouseShipmentRows = (options.activeShipmentStatuses ?? []).map((status) => ({
    id: `sh-${status}`,
    status,
  }));
  const dialect = new PgDialect();
  /** db.db.execute 로 나간 SQL(렌더링한 문자열) — 상자 읽기 둘이 어느 주인을 거르는지 본다 */
  const executedSql: string[] = [];
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
  //   sales_orders: findSoOrThrow — limit().then() → [currentSo] (요청 뒤 다시 읽으면 soAfterRequest)
  //   그 밖: FO / customerReturns / businessLinks
  //     - then() directly (no limit) → fos      (fulfillment order list)
  //     - limit().then()             → []        (customerReturns·businessLinks single-row lookups)
  //     - orderBy().limit().then()   → []        (businessLinks ordered lookup)
  const dbMock = {
    run: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(dbMock.db)),
    db: {
      // 상자 읽기 둘 — 입점사 상자 단계(supplier_id IS NOT NULL)와 창고 상자 status(warehouse_id IS NOT NULL)
      execute: jest.fn((query: SQL) => {
        const text = dialect.sqlToQuery(query).sql;
        executedSql.push(text);
        return Promise.resolve(
          text.includes('s.supplier_id IS NOT NULL') ? supplierShipmentRows : warehouseShipmentRows,
        );
      }),
      select: jest.fn().mockImplementation(() => ({
        from: jest.fn().mockImplementation((table: unknown) => ({
          where: jest.fn().mockImplementation(() => {
            const tableName = getTableName(table as Parameters<typeof getTableName>[0]);
            return {
              limit: jest.fn().mockReturnValue({
                then: jest.fn((fn: (r: unknown[]) => unknown) =>
                  fn(
                    tableName === 'digital_asset_ownerships'
                      ? options.exercisedDigital
                        ? [{ id: 'own-1' }]
                        : []
                      : tableName === 'sales_orders'
                        ? options.noSalesOrder
                          ? []
                          : [currentSo]
                        : tableName === 'sales_order_lines' && options.nonPrintLine
                          ? [{ id: 'normal-line' }]
                          : tableName === 'customer_returns' && options.activeCustomerReturn
                            ? [{ id: 'cr-1' }]
                            : [],
                  ),
                ),
              }),
              then: jest.fn((fn: (r: unknown[]) => unknown) =>
                fn(tableName === 'sales_order_lines' ? (options.printLineIds ?? []).map((id) => ({ id })) : fos),
              ),
              orderBy: jest.fn().mockReturnValue({
                then: jest.fn((fn: (r: unknown[]) => unknown) => fn(options.refundLinks ?? [])),
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
    planCancellation: jest.fn().mockResolvedValue({
      lines: options.planLines ?? [],
      hasShippedQuantity: false,
      leavesNothing: true,
    }),
  };

  const walletClientMock: Partial<WalletRefundClient> = {
    refundByIntent: jest.fn().mockResolvedValue(walletOutcome),
    listRefundsByIntent: jest.fn().mockResolvedValue(options.walletRefunds === undefined ? [] : options.walletRefunds),
  };

  const cancelRequestsMock = {
    settlementFactsFor: jest.fn().mockResolvedValue(options.settlementFacts ?? []),
    request: jest.fn().mockImplementation(() => {
      currentSo = options.soAfterRequest ?? currentSo;
      return Promise.resolve({
        id: 'req-1',
        status: 'settling',
        scope: 'full',
        stage: null,
        convertedFromFull: false,
        requestedAt: '2026-10-07T00:00:00.000Z',
        rejection: null,
        outcome: null,
        settlement: null,
        refundMode: 'auto',
      });
    }),
    precheck: jest.fn().mockResolvedValue(undefined),
    // 같은 키의 행이 보인다 = 그 키의 확정 트랜잭션이 커밋됐다 — 그 뒤에 다시 읽는 판매주문은 soAfterRequest 다.
    findBySourceKey: jest.fn().mockImplementation(() => {
      if (options.replayView) currentSo = options.soAfterRequest ?? currentSo;
      return Promise.resolve(options.replayView ?? null);
    }),
  };

  const printReader = printReaderMock(options.printOrders, options.allOutsourced);
  const printCancellation = printCancelMock(printCancel, printNote);
  const refunds = new CancellationRefundManager(
    dbMock as any,
    salesOrdersServiceMock as any,
    walletClientMock as WalletRefundClient,
  );
  const cancellation = new OrderCancellation(
    dbMock as any,
    salesOrdersServiceMock as any,
    cancelRequestsMock as any,
    printReader,
    printCancellation,
    {} as never,
    new OrderCancellationReader(),
    refunds,
  );
  const service = new StoreSalesOrdersService(
    dbMock as any,
    walletClientMock as WalletRefundClient,
    cancelRequestsMock as any,
    printReader,
    cancellation,
    refunds,
  );

  return {
    service,
    cancellation,
    dbMock,
    executedSql,
    salesOrdersServiceMock,
    walletClientMock,
    cancelRequestsMock,
    printCancel,
    printNote,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('storeRefundStatusOf', () => {
  it('waived 는 none, requested 는 pending', () => {
    expect(storeRefundStatusOf('waived')).toBe('none');
    expect(storeRefundStatusOf('requested')).toBe('pending');
    expect(storeRefundStatusOf('succeeded')).toBe('succeeded');
    expect(storeRefundStatusOf('manual_pending')).toBe('manual_pending');
    expect(storeRefundStatusOf(undefined)).toBe('pending');
    expect(storeRefundStatusOf('이상한값')).toBe('pending');
  });
});

describe('StoreSalesOrdersService', () => {
  // makeContext 를 거치지 않는 가짜(배치·관리자·배송조회)도 사다리 문을 읽을 수 있게 기본 단계를 깔아 둔다
  beforeEach(() => mockPhase());

  describe('printStatusByWalletIntent — 결제 상세 환불 제한', () => {
    it('결제의 주문에 제작 접수된 인쇄 줄이 있으면 hasActivePrint=true', async () => {
      const { service } = makeContext({
        printOrders: [
          { status: 'cancelled', orderAttemptedAt: new Date() },
          { status: 'submitted', orderAttemptedAt: new Date() },
        ],
      });
      await expect(service.printStatusByWalletIntent(WALLET_INTENT_ID)).resolves.toEqual({
        hasActivePrint: true,
        channelOrderId: 'medusa-order-001',
      });
    });

    it('아직 안 보낸 실패 행도 재전송되면 제작되므로 true', async () => {
      const { service } = makeContext({ printOrders: [{ status: 'failed', orderAttemptedAt: null }] });
      await expect(service.printStatusByWalletIntent(WALLET_INTENT_ID)).resolves.toEqual({
        hasActivePrint: true,
        channelOrderId: 'medusa-order-001',
      });
    });

    it('인쇄 줄이 모두 취소됐으면 false', async () => {
      const { service } = makeContext({
        printOrders: [{ status: 'cancelled', orderAttemptedAt: new Date() }],
      });
      await expect(service.printStatusByWalletIntent(WALLET_INTENT_ID)).resolves.toEqual({
        hasActivePrint: false,
        channelOrderId: 'medusa-order-001',
      });
    });

    it('인쇄 줄이 없으면 false', async () => {
      const { service } = makeContext({ printOrders: [] });
      await expect(service.printStatusByWalletIntent(WALLET_INTENT_ID)).resolves.toEqual({
        hasActivePrint: false,
        channelOrderId: 'medusa-order-001',
      });
    });
  });

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
      const { service, cancelRequestsMock } = makeContext({
        fos: [{ status: 'shipped' }],
        phase: { storePhase: 'shipping', anyShipped: true },
      });
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
        phase: { storePhase: 'shipping', anyShipped: true },
      });
      await expect(service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {})).rejects.toThrow('이미 출고');
      expect(cancelRequestsMock.request).not.toHaveBeenCalled();
    });

    it('복구 중 상자가 있는 주문은 셀프 취소 시 409 가 아니라 400 — 인쇄·취소 요청을 부르지 않는다 (#1016 33번)', async () => {
      const { service, cancelRequestsMock, printCancel } = makeContext({
        fos: [{ status: 'recovery_required' }],
        activeShipmentStatuses: ['recovery_required', 'draft'],
      });
      const error = await service
        .cancelRequestByChannelOrder(
          CHANNEL_ORDER_ID,
          CUSTOMER_ID,
          {},
          { idempotencyKey: 'k', actorId: CUSTOMER_ID, actorRoles: [] },
        )
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toBe('처리 중인 주문이라 직접 취소할 수 없습니다. 고객센터로 문의해 주세요.');
      expect(cancelRequestsMock.precheck).not.toHaveBeenCalled();
      expect(printCancel).not.toHaveBeenCalled();
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

    it('고객 취소는 요청 전에 인쇄 줄을 gate 로 먼저 취소한다', async () => {
      const order: string[] = [];
      const printCancel = jest.fn(() => {
        order.push('print');
        return Promise.resolve(PRINT_RESULT);
      });
      const { service, cancelRequestsMock } = makeContext({ printCancel });
      cancelRequestsMock.request.mockImplementation(() => {
        order.push('request');
        return Promise.resolve({ id: 'req-1', status: 'settling', scope: 'full', convertedFromFull: false });
      });
      await service.cancelRequestByChannelOrder(
        CHANNEL_ORDER_ID,
        CUSTOMER_ID,
        {},
        { idempotencyKey: 'k', actorId: CUSTOMER_ID, actorRoles: [] },
      );
      expect(printCancel).toHaveBeenCalledWith(SO_ID, 'gate', undefined, { keepOnRefusal: true });
      expect(order).toEqual(['print', 'request']);
    });

    it('인쇄가 제작 중이고 다른 상품이 남아 있으면 PRINT_PARTIAL_CANCEL_AVAILABLE(409) 로 고객 동의를 묻는다', async () => {
      const printCancel = jest.fn().mockRejectedValue(new PrintInProductionError());
      const { service, cancelRequestsMock } = makeContext({
        printCancel,
        printOrders: [{ status: 'submitted', orderAttemptedAt: new Date(), salesOrderLineId: 'print-line' }],
        planLines: [
          { salesOrderLineId: 'print-line', quantity: 1 },
          { salesOrderLineId: 'normal-line', quantity: 2 },
        ],
      });
      const error = await service
        .cancelRequestByChannelOrder(
          CHANNEL_ORDER_ID,
          CUSTOMER_ID,
          {},
          { idempotencyKey: 'k', actorId: CUSTOMER_ID, actorRoles: [] },
        )
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PrintPartialCancelAvailableError);
      expect((error as PrintPartialCancelAvailableError).getHttpStatus()).toBe(409);
      expect((error as PrintPartialCancelAvailableError).getErrorCode()).toBe('PRINT_PARTIAL_CANCEL_AVAILABLE');
      expect(cancelRequestsMock.request).not.toHaveBeenCalled();
    });

    it('excludePrint 면 인쇄 줄을 뺀 남은 수량만 부분 취소로 요청한다', async () => {
      const { service, cancelRequestsMock, printCancel } = makeContext({
        printOrders: [{ status: 'submitted', orderAttemptedAt: new Date(), salesOrderLineId: 'print-line' }],
        planLines: [
          { salesOrderLineId: 'print-line', quantity: 1 },
          { salesOrderLineId: 'normal-line', quantity: 2 },
        ],
      });
      await service.cancelRequestByChannelOrder(
        CHANNEL_ORDER_ID,
        CUSTOMER_ID,
        { excludePrint: true },
        { idempotencyKey: 'k', actorId: CUSTOMER_ID, actorRoles: [] },
      );
      const lines = [{ salesOrderLineId: 'normal-line', quantity: 2 }];
      expect(cancelRequestsMock.precheck).toHaveBeenCalledWith(SO_ID, lines);
      expect(printCancel).toHaveBeenCalledWith(SO_ID, 'gate', lines, { keepOnRefusal: true });
      expect(cancelRequestsMock.request).toHaveBeenCalledWith(expect.objectContaining({ lines }));
    });

    it('excludePrint 인데 남은 상품이 인쇄뿐이면 제작 중 안내로 막는다', async () => {
      const { service, cancelRequestsMock } = makeContext({
        printOrders: [{ status: 'submitted', orderAttemptedAt: new Date(), salesOrderLineId: 'print-line' }],
        planLines: [{ salesOrderLineId: 'print-line', quantity: 1 }],
      });
      const error = await service
        .cancelRequestByChannelOrder(
          CHANNEL_ORDER_ID,
          CUSTOMER_ID,
          { excludePrint: true },
          { idempotencyKey: 'k', actorId: CUSTOMER_ID, actorRoles: [] },
        )
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PrintInProductionError);
      expect(cancelRequestsMock.request).not.toHaveBeenCalled();
    });

    it('exclude-print cancel of a shipped order is refused', async () => {
      // P4 — FO 없이 셀메이트로 나간 주문. 옛 판정은 FO·상자로만 출고를 봐서 버튼이 열렸고, 인쇄 제외 요청은
      // 라인 범위 부분취소가 되어 판매주문 shipped 가드를 지나지 않았다(돈 구멍). 이제 판정 단계에서 막힌다
      const { service, cancelRequestsMock, printCancel } = makeContext({
        so: makeSo({ status: 'shipped' }),
        phase: { adminPhase: 'external_shipped', storePhase: 'shipping', anyShipped: true },
        printOrders: [{ status: 'cancel_refused', orderAttemptedAt: new Date(), salesOrderLineId: 'print-line' }],
        planLines: [
          { salesOrderLineId: 'print-line', quantity: 1 },
          { salesOrderLineId: 'normal-line', quantity: 1 },
        ],
        nonPrintLine: true,
      });
      const error = await service
        .cancelRequestByChannelOrder(
          CHANNEL_ORDER_ID,
          CUSTOMER_ID,
          { excludePrint: true },
          { idempotencyKey: 'k', actorId: CUSTOMER_ID, actorRoles: [] },
        )
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toBe('이미 출고된 주문은 취소할 수 없습니다. 고객센터로 문의해 주세요.');
      expect(cancelRequestsMock.precheck).not.toHaveBeenCalled();
      expect(printCancel).not.toHaveBeenCalled();
      expect(cancelRequestsMock.request).not.toHaveBeenCalled();
    });

    it('와우프레스가 인쇄 취소를 거절하고 남은 상품이 인쇄뿐이면 고객 취소 전체를 막고 안내 문구를 그대로 돌려준다', async () => {
      const printCancel = jest.fn().mockRejectedValue(new PrintInProductionError());
      const { service, cancelRequestsMock } = makeContext({ printCancel });
      const error = await service
        .cancelRequestByChannelOrder(
          CHANNEL_ORDER_ID,
          CUSTOMER_ID,
          {},
          { idempotencyKey: 'k', actorId: CUSTOMER_ID, actorRoles: [] },
        )
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PrintInProductionError);
      expect((error as Error).message).toBe(PRINT_IN_PRODUCTION_MESSAGE);
      expect(cancelRequestsMock.request).not.toHaveBeenCalled();
    });

    it('인쇄를 멈춘 뒤 취소 요청이 실패하면 인쇄 행에 실패를 남기고 원래 오류를 다시 던진다', async () => {
      const { service, cancelRequestsMock, printNote } = makeContext();
      const failure = new Error('채널 줄 번호가 없는 줄은 채널에 취소를 요청할 수 없습니다');
      cancelRequestsMock.request.mockRejectedValue(failure);
      await expect(
        service.cancelRequestByChannelOrder(
          CHANNEL_ORDER_ID,
          CUSTOMER_ID,
          {},
          { idempotencyKey: 'k', actorId: CUSTOMER_ID, actorRoles: [] },
        ),
      ).rejects.toBe(failure);
      expect(printNote).toHaveBeenCalledWith(PRINT_RESULT, failure);
    });

    it('판매주문 취소 판정이 거절할 요청이면 와우프레스를 부르지 않는다', async () => {
      const { service, cancelRequestsMock, printCancel } = makeContext();
      cancelRequestsMock.precheck.mockRejectedValue(
        new Error('취소할 수 있는 수량이 없습니다. 이미 출고된 상품은 반품 접수로 환불해 주세요.'),
      );
      await expect(
        service.cancelRequestByChannelOrder(
          CHANNEL_ORDER_ID,
          CUSTOMER_ID,
          {},
          { idempotencyKey: 'k', actorId: CUSTOMER_ID, actorRoles: [] },
        ),
      ).rejects.toThrow('취소할 수 있는 수량이 없습니다');
      expect(cancelRequestsMock.precheck).toHaveBeenCalledWith(SO_ID, undefined);
      expect(printCancel).not.toHaveBeenCalled();
      expect(cancelRequestsMock.request).not.toHaveBeenCalled();
    });

    it('앞선 거절 사유(출고 등)에 걸리면 와우프레스를 부르지 않는다', async () => {
      const { service, printCancel } = makeContext({
        fos: [{ status: 'shipped' }],
        phase: { storePhase: 'shipping', anyShipped: true },
      });
      await expect(service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {})).rejects.toThrow('이미 출고');
      expect(printCancel).not.toHaveBeenCalled();
    });

    it('고객 취소는 요청 하나로 끝난다 — 이 서비스는 core 취소·Wallet 을 직접 부르지 않는다(확정은 요청 안에서)', async () => {
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

    it('응답은 확정 «뒤»의 판매주문으로 만든다 — 바로 «취소됨»(PR 4 넘길 것 1)', async () => {
      const { service } = makeContext({ soAfterRequest: makeSo({ status: 'cancelled' }) });
      const r = await service.cancelRequestByChannelOrder(
        CHANNEL_ORDER_ID,
        CUSTOMER_ID,
        {},
        { idempotencyKey: 'k-1', actorId: CUSTOMER_ID, actorRoles: ['customer'] },
      );
      expect(r.orderStatus).toBe('cancelled');
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

    it('같은 키 재요청도 확정 «뒤»의 판매주문으로 답한다 — 처음 읽은 주문이 아니라 다시 읽은 «취소됨»', async () => {
      const { service, cancelRequestsMock } = makeContext({
        replayView: { id: 'req-1', status: 'settling' },
        soAfterRequest: makeSo({ status: 'cancelled' }),
      });
      const r = await service.cancelRequestByChannelOrder(
        CHANNEL_ORDER_ID,
        CUSTOMER_ID,
        {},
        { idempotencyKey: 'k-1', actorId: CUSTOMER_ID, actorRoles: ['customer'] },
      );
      expect(r.orderStatus).toBe('cancelled');
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
      mockPhase();
      let whereCallIndex = 0;
      const dbMock = {
        run: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(dbMock.db)),
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
      const salesOrdersServiceMock = { cancel: jest.fn(), createBusinessLink: jest.fn() };
      const cancelRequestsMock = { settlementFactsFor: jest.fn().mockResolvedValue([]) };
      const printReader = printReaderMock();
      const printCancellation = printCancelMock();
      const service = new StoreSalesOrdersService(
        dbMock as any,
        { refundByIntent: jest.fn() } as any,
        cancelRequestsMock as any,
        printReader,
        new OrderCancellation(
          dbMock as any,
          salesOrdersServiceMock as any,
          cancelRequestsMock as any,
          printReader,
          printCancellation,
          {} as never,
          new OrderCancellationReader(),
          new CancellationRefundManager(
            dbMock as any,
            salesOrdersServiceMock as any,
            { refundByIntent: jest.fn() } as any,
          ),
        ),
        new CancellationRefundManager(
          dbMock as any,
          salesOrdersServiceMock as any,
          { refundByIntent: jest.fn() } as any,
        ),
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

    it('진행 단계는 주문마다가 아니라 전체 id 로 한 번에 읽는다', async () => {
      const { service } = makeBatchContext([
        makeSo({ walletIntentId: null }),
        makeSo({ id: 'so-002', channelOrderId: 'medusa-order-002', walletIntentId: null }),
        makeSo({ id: 'so-003', channelOrderId: 'medusa-order-003', walletIntentId: null }),
      ]);
      readPhases.mockClear();

      await service.getActionsByChannelOrderBatch(
        [CHANNEL_ORDER_ID, 'medusa-order-002', 'medusa-order-003'],
        CUSTOMER_ID,
      );

      expect(readPhases).toHaveBeenCalledTimes(1);
      expect(readPhases).toHaveBeenCalledWith(expect.anything(), [SO_ID, 'so-002', 'so-003']);
    });

    it('일괄로 읽은 맵에 주문이 없으면 기본값으로 덮지 않고 던진다', async () => {
      const { service } = makeBatchContext([makeSo({ walletIntentId: null })]);
      readPhases.mockResolvedValueOnce(new Map());

      await expect(service.getActionsByChannelOrderBatch([CHANNEL_ORDER_ID], CUSTOMER_ID)).rejects.toThrow(
        /Fulfillment phase missing/,
      );
    });

    it('빈 id 목록이면 DB 조회 없이 빈 배열을 반환한다', async () => {
      const { service, dbMock } = makeBatchContext([]);
      await expect(service.getActionsByChannelOrderBatch([], CUSTOMER_ID)).resolves.toEqual([]);
      expect(dbMock.db.select).not.toHaveBeenCalled();
    });
  });

  describe('getActionsByChannelOrder', () => {
    describe('채널 취소 정산(#1016 36번 재설계 §8.2)', () => {
      const cancelled = () => makeSo({ status: 'cancelled' });

      it('정산 중 → refundStatus·refundSummary.status 모두 pending', async () => {
        const { service } = makeContext({
          so: cancelled(),
          settlementFacts: [{ status: 'settling', mode: 'auto', phase: 'in_progress' }],
        });
        const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(r.refundStatus).toBe('pending');
        expect(r.refundSummary?.status).toBe('pending');
      });

      it('지연 → delayed, 안내 문장은 null(스토어프론트 i18n 이 정본 — PR 4 넘길 것 4)', async () => {
        const { service } = makeContext({
          so: cancelled(),
          settlementFacts: [{ status: 'settling', mode: 'auto', phase: 'refused' }],
        });
        const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(r.refundStatus).toBe('delayed');
        expect(r.refundSummary).toMatchObject({ status: 'delayed', expectedProcessingMessage: null });
      });

      it('수동으로 끝남 + wallet 송금 대기 → transfer_pending', async () => {
        const { service, walletClientMock } = makeContext({
          so: cancelled(),
          settlementFacts: [{ status: 'applied', mode: 'manual' }],
          walletRefunds: [{ id: 'r1', status: 'PENDING', execution: 'MANUAL', amount: 50000 }],
        });
        const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(r.refundStatus).toBe('transfer_pending');
        expect(r.refundSummary).toMatchObject({ status: 'transfer_pending', expectedProcessingMessage: null });
        expect(walletClientMock.listRefundsByIntent).toHaveBeenCalledWith(WALLET_INTENT_ID);
      });

      it('wallet 실패·시간 초과 → transfer_pending(«완료»라고 하지 않는다)', async () => {
        const { service } = makeContext({
          so: cancelled(),
          settlementFacts: [{ status: 'applied', mode: 'manual' }],
          walletRefunds: null,
        });
        expect((await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID)).refundStatus).toBe(
          'transfer_pending',
        );
      });

      it('수동 송금 끝 → 기존 도출(수집된 환불이면 succeeded)', async () => {
        const { service } = makeContext({
          so: cancelled(),
          settlementFacts: [{ status: 'applied', mode: 'manual' }],
          walletRefunds: [{ id: 'r1', status: 'SUCCEEDED', execution: 'MANUAL', amount: 50000 }],
          refundLinks: [
            { relationName: 'order_lifecycle_refund_collected', metadata: { amount: 50000 }, createdAt: new Date() },
          ],
        });
        expect((await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID)).refundStatus).toBe('succeeded');
      });

      it('자동으로 끝난 정산도 wallet 을 부른다 — wallet 이 송금 대기(무통장 계좌 없음 폴백)로 떨어뜨렸을 수 있다', async () => {
        const { service, walletClientMock } = makeContext({
          so: cancelled(),
          settlementFacts: [{ status: 'applied', mode: 'auto' }],
          walletRefunds: [{ id: 'r1', status: 'PENDING', execution: 'MANUAL', amount: 50000 }],
        });
        const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(walletClientMock.listRefundsByIntent).toHaveBeenCalledWith(WALLET_INTENT_ID);
        expect(r.refundStatus).toBe('transfer_pending');
      });

      it('운영자 부분취소 정산(판매주문은 살아 있음)에도 같은 값을 둘 다 싣는다(PR 4 넘길 것 3)', async () => {
        const { service } = makeContext({
          settlementFacts: [{ status: 'settling', mode: 'auto', phase: 'in_progress' }],
        });
        const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(r.orderStatus).toBe('confirmed');
        expect(r.refundStatus).toBe('pending');
        expect(r.refundSummary?.status).toBe('pending');
      });
    });

    it('취소 요청 상태 칸은 더 싣지 않는다 — 요청은 확정이라 «처리 중» 요청이 없다(PR 6)', async () => {
      const { service } = makeContext({});
      const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
      expect(r).not.toHaveProperty('cancelRequestStatus');
      expect(r.cancelUnavailableReason).not.toBe('cancel_requested');
    });

    it('wallet 연결 없이 수집된 환불만 있으면 합계로 succeeded 요약(스펙 §7.5)', async () => {
      const { service } = makeContext({
        so: makeSo({ status: 'cancelled' }),
        refundLinks: [
          {
            relationName: 'order_lifecycle_refund_collected',
            metadata: { amount: 7000 },
            createdAt: new Date('2026-10-07T01:00:00.000Z'),
          },
          {
            relationName: 'order_lifecycle_refund_collected',
            metadata: { amount: 3000 },
            createdAt: new Date('2026-10-07T00:00:00.000Z'),
          },
        ],
      });
      const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
      expect(r.refundStatus).toBe('succeeded');
      expect(r.refundSummary).toMatchObject({
        status: 'succeeded',
        amount: 10000,
        lastUpdatedAt: '2026-10-07T01:00:00.000Z',
      });
    });

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

    it('반품 예정 기록이 없으면 claimStatus none', async () => {
      const { service } = makeContext();
      const result = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
      expect(result.claimStatus).toBe('none');
    });

    it('SO status=delivered이면 return·exchange 가능 (K8 PR11b N4)', async () => {
      const { service } = makeContext({
        so: makeSo({ status: 'delivered' }),
        fos: [{ status: 'completed' }],
        activeShipmentStatuses: ['delivered'],
        // 사다리: SO shipped·delivered 위에서 사실이 배송완료면 고객은 delivered (R13,
        // 'cellmate shipped order with completed drop-ship shows delivered to the customer')
        phase: { adminPhase: 'external_shipped', storePhase: 'delivered', anyShipped: true },
      });
      const result = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
      expect(result.availableActions).toContain('return');
      expect(result.availableActions).toContain('exchange');
      expect(result.availableActions).toContain('track');
      expect(result.availableActions).not.toContain('cancel');
    });

    describe('교환 버튼 (K8 PR11b N4) — 인쇄 줄이 아닌 청구 가능한 소포가 있어야 낸다', () => {
      const deliveredOrder = {
        so: makeSo({ status: 'delivered' }),
        fos: [{ status: 'completed' }],
        activeShipmentStatuses: ['delivered'],
        phase: { adminPhase: 'external_shipped', storePhase: 'delivered', anyShipped: true },
      } satisfies Parameters<typeof makeContext>[0];

      it('배송완료 + 일반 줄 claimable → return·exchange', async () => {
        const { service } = makeContext({
          ...deliveredOrder,
          claimableParcels: [
            { salesOrderLineId: 'print-line', claimable: 1 },
            { salesOrderLineId: 'normal-line', claimable: 1 },
          ],
          printLineIds: ['print-line'],
        });
        const result = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(result.availableActions).toEqual(expect.arrayContaining(['return', 'exchange']));
        // 교환은 반품 판정 바로 뒤
        expect(result.availableActions.indexOf('exchange')).toBe(result.availableActions.indexOf('return') + 1);
      });

      it('배송완료 + 인쇄 줄만 claimable → return 만', async () => {
        const { service } = makeContext({
          ...deliveredOrder,
          claimableParcels: [
            { salesOrderLineId: 'print-line', claimable: 1 },
            { salesOrderLineId: 'normal-line', claimable: 0 },
          ],
          printLineIds: ['print-line'],
        });
        const result = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(result.availableActions).toContain('return');
        expect(result.availableActions).not.toContain('exchange');
      });

      it('claimable 0 → 둘 다 없음', async () => {
        const { service } = makeContext({ ...deliveredOrder, claimable: 0 });
        const result = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(result.availableActions).not.toContain('return');
        expect(result.availableActions).not.toContain('exchange');
      });

      it('배송 전 → exchange 없음', async () => {
        const { service } = makeContext({ fos: [], phase: { storePhase: 'preparing' }, claimable: 1 });
        const result = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(result.availableActions).toContain('cancel');
        expect(result.availableActions).not.toContain('exchange');
      });
    });

    it('진행 중 반품 예정 기록이 있으면 claimStatus return_requested, 남은 소포가 있으면 return 도 낸다', async () => {
      // Medusa 는 한 주문에 반품 여럿을 받는다(K8 PR 3) — 진행 중 반품이 두 번째 반품을 막지 않는다
      const { service } = makeContext({
        so: makeSo({ status: 'delivered' }),
        fos: [{ status: 'completed' }],
        activeShipmentStatuses: ['delivered'],
        // 사다리: SO shipped·delivered 위에서 사실이 배송완료면 고객은 delivered (R13,
        // 'cellmate shipped order with completed drop-ship shows delivered to the customer')
        phase: { adminPhase: 'external_shipped', storePhase: 'delivered', anyShipped: true },
        activeCustomerReturn: true,
        claimable: 1,
      });
      const result = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
      expect(result.claimStatus).toBe('return_requested');
      expect(result.availableActions).toEqual(expect.arrayContaining(['track', 'receipt', 'return']));
    });

    it('진행 중 반품이 남은 수량을 다 잡으면 claimStatus return_requested 이고 return 은 없다', async () => {
      const { service } = makeContext({
        so: makeSo({ status: 'delivered' }),
        fos: [{ status: 'completed' }],
        activeShipmentStatuses: ['delivered'],
        // 사다리: SO shipped·delivered 위에서 사실이 배송완료면 고객은 delivered (R13,
        // 'cellmate shipped order with completed drop-ship shows delivered to the customer')
        phase: { adminPhase: 'external_shipped', storePhase: 'delivered', anyShipped: true },
        activeCustomerReturn: true,
        claimable: 0,
      });
      const result = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
      expect(result.claimStatus).toBe('return_requested');
      expect(result.availableActions).not.toContain('return');
    });

    it('FO status=completed(delivered)이면 return 가능', async () => {
      const { service } = makeContext({
        so: makeSo({ status: 'shipped' }),
        fos: [{ status: 'completed' }],
        activeShipmentStatuses: ['delivered'],
        // 사다리: SO shipped·delivered 위에서 사실이 배송완료면 고객은 delivered (R13,
        // 'cellmate shipped order with completed drop-ship shows delivered to the customer')
        phase: { adminPhase: 'external_shipped', storePhase: 'delivered', anyShipped: true },
      });
      const result = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
      expect(result.availableActions).toContain('return');
    });

    it('배송중(shipped, FO=shipped)이면 return/exchange 불가', async () => {
      const { service } = makeContext({
        so: makeSo({ status: 'shipped' }),
        fos: [{ status: 'shipped' }],
        activeShipmentStatuses: ['shipped'],
        phase: { adminPhase: 'external_shipped', storePhase: 'shipping', anyShipped: true },
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
        phase: { storePhase: 'shipping', anyShipped: true },
      });
      const result = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
      expect(result.availableActions).not.toContain('return');
      expect(result.availableActions).not.toContain('exchange');
    });

    describe('buildActionsView fulfillmentStatus (V2)', () => {
      // 각 케이스의 phase 는 order-fulfillment-phase.integration.spec.ts 의 같은 시나리오(주석의 이름)가 실 DB 로 낸 값이다.
      // 단계 판정은 그 spec 이 소유하고, 여기서는 그 단계 위의 actions·취소 사유·진행 요약만 본다.
      const shipping = { storePhase: 'shipping', anyShipped: true } as const;
      const delivered = { storePhase: 'delivered', anyShipped: true } as const;

      it('fulfillmentStatus 는 사다리의 storePhase 를 그대로 싣는다', async () => {
        for (const storePhase of ['not_created', 'preparing', 'shipping', 'delivered', 'canceled'] as const) {
          const { service } = makeContext({ phase: { storePhase } });
          expect((await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID)).fulfillmentStatus).toBe(
            storePhase,
          );
        }
      });
      it('사다리 맵에 주문이 없으면 기본값으로 덮지 않고 실패한다', async () => {
        const { service } = makeContext();
        readPhases.mockResolvedValue(new Map());
        await expect(service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID)).rejects.toThrow(SO_ID);
      });
      it('전 라인 외주 + 인쇄 전량 delivered → 반품/교환은 열지 않는다(주문제작)', async () => {
        // 사다리: 'print only all delivered'
        const { service } = makeContext({
          fos: [],
          printOrders: [{ status: 'delivered' }],
          allOutsourced: true,
          phase: delivered,
          claimable: 0, // 인쇄 줄은 소포가 없다
        });
        const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(r.cancelUnavailableReason).toBe('already_shipped');
        expect(r.availableActions).not.toContain('return');
        expect(r.availableActions).not.toContain('exchange');
        expect(r.shipmentProgress).toEqual({ total: 1, shipped: 1, delivered: 1 });
      });
      it('전 라인 외주 + 인쇄 하나라도 shipped → already_shipped', async () => {
        // 사다리: 'print only one shipped one submitted'
        const { service } = makeContext({
          fos: [],
          printOrders: [{ status: 'shipped' }, { status: 'submitted' }],
          allOutsourced: true,
          phase: shipping,
        });
        const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(r.cancelUnavailableReason).toBe('already_shipped');
        expect(r.shipmentProgress).toEqual({ total: 2, shipped: 1, delivered: 0 });
      });
      it('혼합 주문: 인쇄 shipped 는 출고 증거다 — 창고가 준비중이어도 already_shipped', async () => {
        // 사다리: 'fo ready and print shipped'
        const { service } = makeContext({
          fos: [{ status: 'ready' }],
          printOrders: [{ status: 'shipped' }],
          allOutsourced: false,
          phase: shipping,
        });
        const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(r.cancelUnavailableReason).toBe('already_shipped');
        expect(r.availableActions).not.toContain('cancel');
      });
      it('혼합 주문: 창고 상자 delivered + 인쇄 submitted → 반품·교환 미노출', async () => {
        // 사다리: 'warehouse delivered and print submitted'
        const { service } = makeContext({
          so: makeSo({ status: 'processing' }),
          fos: [{ status: 'shipped' }],
          activeShipmentStatuses: ['delivered'],
          printOrders: [{ status: 'submitted' }],
          phase: shipping,
        });
        const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(r.availableActions).not.toContain('return');
        expect(r.availableActions).not.toContain('exchange');
        expect(r.shipmentProgress).toEqual({ total: 2, shipped: 1, delivered: 1 });
      });
      it('인쇄 주문이 없으면 기존 결과와 같다 (회귀)', async () => {
        // 사다리: 'confirmed order with fo and no parcel'
        const { service } = makeContext({ fos: [{ status: 'ready' }], phase: { storePhase: 'preparing' } });
        const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(r.availableActions).toContain('cancel');
        expect(r.shipmentProgress).toBeUndefined();
      });
      it('FO 없음 → 취소 버튼', async () => {
        // 사다리: 'confirmed order without fo'
        const { service } = makeContext({ fos: [], phase: { storePhase: 'not_created' } });
        const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(r.availableActions).toEqual(['cancel', 'receipt']);
        expect(r.shipmentProgress).toBeUndefined();
      });
      it('FO ready, 상자 미로드 → 취소 버튼', async () => {
        // 사다리: 'confirmed order with fo and no parcel'
        const { service } = makeContext({ fos: [{ status: 'ready' }], phase: { storePhase: 'preparing' } });
        const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(r.availableActions).toContain('cancel');
      });
      it('planned 상자만 있는 주문은 취소 버튼이 보인다 — 서버가 그 자리에서 취소한다 (#1016 30번)', async () => {
        // 사다리: 'canceled box is ignored'(발송 전 상자는 움직임이 아니다)
        const { service } = makeContext({
          fos: [{ status: 'ready' }],
          activeShipmentStatuses: ['planned'],
          phase: { storePhase: 'preparing' },
        });
        const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(r.availableActions).toContain('cancel');
        expect(r.cancelUnavailableReason).toBeUndefined();
      });
      it('FO processing → already_processing (셀프취소 불가)', async () => {
        // 사다리: 'confirmed order with fo and no parcel'
        const { service } = makeContext({ fos: [{ status: 'processing' }], phase: { storePhase: 'preparing' } });
        const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(r.availableActions).not.toContain('cancel');
        expect(r.cancelUnavailableReason).toBe('already_processing');
      });
      it('와우프레스 취소 거절 행이 있어도 인쇄 말고 다른 상품이 있으면 취소를 연다(인쇄 제외 취소를 묻는다)', async () => {
        const { service } = makeContext({
          fos: [{ status: 'ready' }],
          printOrders: [{ id: 'po-1', status: 'cancel_refused', trackingNumber: null }],
          nonPrintLine: true,
          phase: { storePhase: 'preparing' },
        });
        const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(r.availableActions).toContain('cancel');
      });
      it('와우프레스 취소 거절(cancel_refused) 행만 있으면 already_processing (셀프취소 불가)', async () => {
        const { service } = makeContext({
          fos: [{ status: 'ready' }],
          printOrders: [{ id: 'po-1', status: 'cancel_refused', trackingNumber: null }],
          phase: { storePhase: 'preparing' },
        });
        const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(r.availableActions).not.toContain('cancel');
        expect(r.cancelUnavailableReason).toBe('already_processing');
      });
      it('FO partially_shipped + 상자 shipped → already_shipped + 진행 요약', async () => {
        // 사다리: 'partially shipped with a draft box'
        const { service } = makeContext({
          fos: [{ status: 'partially_shipped' }],
          activeShipmentStatuses: ['shipped', 'draft'],
          phase: shipping,
        });
        const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(r.shipmentProgress).toEqual({ total: 2, shipped: 1, delivered: 0 });
        expect(r.availableActions).not.toContain('cancel');
        expect(r.cancelUnavailableReason).toBe('already_shipped');
      });
      it('FO completed + 상자 전량 delivered → 반품·교환 노출 (K8 PR11b N4)', async () => {
        // 사다리: 'both parcels delivered'
        const { service } = makeContext({
          fos: [{ status: 'completed' }],
          activeShipmentStatuses: ['delivered'],
          phase: delivered,
        });
        const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(r.availableActions).toContain('return');
        expect(r.availableActions).toContain('exchange');
      });
      it('부분 배송 + 잔여 상자 recovery_required → already_shipped (마스킹 방지)', async () => {
        // 사다리: 'delivered parcel and a recovery box'
        const { service } = makeContext({
          fos: [{ status: 'recovery_required' }],
          activeShipmentStatuses: ['delivered', 'recovery_required'],
          phase: shipping,
        });
        const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(r.availableActions).not.toContain('cancel');
        expect(r.cancelUnavailableReason).toBe('already_shipped');
      });
      it('복구 중 상자가 있고 출고된 박스 없음 → 취소 버튼 없이 already_processing (#1016 33번)', async () => {
        // 사다리: 'recovery box without dispatch'
        const { service } = makeContext({
          fos: [{ status: 'recovery_required' }],
          activeShipmentStatuses: ['recovery_required', 'draft'],
          phase: { storePhase: 'preparing' },
        });
        const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(r.availableActions).toEqual(['receipt']);
        expect(r.cancelUnavailableReason).toBe('already_processing');
      });
      it('넘긴 입점사 상자 → 취소 버튼 없음', async () => {
        // 사다리: 'forwarded drop-ship moves but is not shipped'
        const { service } = makeContext({
          fos: [{ status: 'ready' }],
          supplierShipments: [{ status: 'draft', supplierHandoffId: 'ho-1' }],
          phase: shipping,
        });
        const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(r.availableActions).not.toContain('cancel');
        expect(r.shipmentProgress).toEqual({ total: 1, shipped: 1, delivered: 0 });
      });
      it('발송된 입점사 상자 → 진행 요약 배송완료', async () => {
        // 사다리: 'completed drop-ship shows delivered'
        const { service } = makeContext({
          fos: [{ status: 'ready' }],
          supplierShipments: [{ status: 'shipped', supplierHandoffId: 'ho-1' }],
          phase: delivered,
        });
        const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(r.cancelUnavailableReason).toBe('already_shipped');
        expect(r.shipmentProgress).toEqual({ total: 1, shipped: 1, delivered: 1 });
      });
      it('입점사 상자 pending·forwarded·shipped + 창고 상자 delivered → {4,3,2}, 입점사 상자는 창고 상자 목록에 없다', async () => {
        // 통합: order-fulfillment-phase.integration.spec.ts 'customer progress counts supplier boxes once by their stage'
        const { service, executedSql } = makeContext({
          fos: [{ status: 'partially_shipped' }],
          activeShipmentStatuses: ['delivered'],
          supplierShipments: [
            { status: 'draft', supplierHandoffId: null },
            { status: 'draft', supplierHandoffId: 'ho-1' },
            { status: 'shipped', supplierHandoffId: 'ho-1' },
          ],
          phase: shipping,
        });
        const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(r.shipmentProgress).toEqual({ total: 4, shipped: 3, delivered: 2 });
        expect(executedSql.filter((q) => q.includes('s.warehouse_id IS NOT NULL'))).toHaveLength(1);
        expect(executedSql.filter((q) => q.includes('s.supplier_id IS NOT NULL'))).toHaveLength(1);
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
      printCancel?: jest.Mock;
      holdUnsent?: jest.Mock;
      businessLinkError?: Error;
    } = {},
  ) {
    const so = options.so ?? makeSo();
    const printCancel = options.printCancel ?? jest.fn().mockResolvedValue(PRINT_RESULT);
    const printNote = jest.fn().mockResolvedValue(undefined);
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

    const selectInTx = (): unknown => (dbMock.db.select as jest.Mock<unknown, []>)();
    const dbMock = {
      // 커널이 여는 트랜잭션(무통장 승인 확정) — 가짜 트랜잭션은 같은 db 다
      run: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(dbMock.db)),
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
        // 부분취소는 판매 취소와 환불 검토 기록을 한 트랜잭션에서 한다. 가짜 트랜잭션은 같은 select 를 쓴다
        transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn({ select: selectInTx })),
      },
    };

    const salesOrdersServiceMock = {
      cancel: options.cancelError
        ? jest.fn<Promise<unknown>, unknown[]>().mockRejectedValue(options.cancelError)
        : jest.fn<Promise<unknown>, unknown[]>().mockResolvedValue(undefined),
      createBusinessLink: options.businessLinkError
        ? jest.fn<Promise<unknown>, unknown[]>().mockRejectedValue(options.businessLinkError)
        : jest.fn<Promise<unknown>, unknown[]>().mockResolvedValue(undefined),
      validateCancellationReplay: jest.fn<Promise<boolean>, unknown[]>().mockResolvedValue(false),
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
      precheck: jest.fn().mockResolvedValue(undefined),
    };

    const printReader = printReaderMock();
    const printCancellation = printCancelMock(printCancel, printNote, options.holdUnsent);
    const refunds = new CancellationRefundManager(
      dbMock as any,
      salesOrdersServiceMock as any,
      walletClientMock as WalletRefundClient,
    );
    const cancellation = new OrderCancellation(
      dbMock as any,
      salesOrdersServiceMock as any,
      cancelRequestsMock as any,
      printReader,
      printCancellation,
      {} as never,
      new OrderCancellationReader(),
      refunds,
    );
    const service = new StoreSalesOrdersService(
      dbMock as any,
      walletClientMock as WalletRefundClient,
      cancelRequestsMock as any,
      printReader,
      cancellation,
      refunds,
    );

    return {
      service,
      cancellation,
      dbMock,
      salesOrdersServiceMock,
      walletClientMock,
      cancelRequestsMock,
      printCancel,
      printNote,
    };
  }

  describe('adminCancelRequest', () => {
    describe('인쇄 외주(와우프레스) 취소 게이트', () => {
      const ctx = { idempotencyKey: 'k-p', actorId: 'admin-1', actorRoles: ['admin'] };

      it('Medusa 주문 — 요청 전에 범위 안 인쇄 줄을 gate 로 먼저 취소한다', async () => {
        const order: string[] = [];
        const printCancel = jest.fn(() => {
          order.push('print');
          return Promise.resolve(PRINT_RESULT);
        });
        const { service, cancelRequestsMock } = makeAdminContext({ printCancel });
        cancelRequestsMock.request.mockImplementation(() => {
          order.push('request');
          return Promise.resolve({ id: 'req-1', status: 'requested', scope: 'partial', convertedFromFull: false });
        });
        const lines = [{ salesOrderLineId: 'line-001', quantity: 2 }];
        await service.adminCancelRequest(SO_ID, { lines, fulfillmentCommandContext: ctx });
        expect(printCancel).toHaveBeenCalledWith(SO_ID, 'gate', lines);
        expect(order).toEqual(['print', 'request']);
      });

      it('Medusa 주문 — 와우프레스가 거절하면 취소 요청을 만들지 않는다', async () => {
        const printCancel = jest.fn().mockRejectedValue(new PrintInProductionError());
        const { service, cancelRequestsMock } = makeAdminContext({ printCancel });
        await expect(service.adminCancelRequest(SO_ID, { fulfillmentCommandContext: ctx })).rejects.toThrow(
          PRINT_IN_PRODUCTION_MESSAGE,
        );
        expect(cancelRequestsMock.request).not.toHaveBeenCalled();
      });

      it('Medusa 주문 — 요청이 거절되면 인쇄 행에 실패를 남기고 다시 던진다', async () => {
        const { service, cancelRequestsMock, printNote } = makeAdminContext();
        const failure = new Error('취소 수량(4개)이 취소 가능 수량(3개)을 초과합니다.');
        cancelRequestsMock.request.mockRejectedValue(failure);
        await expect(service.adminCancelRequest(SO_ID, { fulfillmentCommandContext: ctx })).rejects.toBe(failure);
        expect(printNote).toHaveBeenCalledWith(PRINT_RESULT, failure);
      });

      it('Medusa 주문 — 인쇄 1개 + 일반 99개(주문 1개) 요청은 와우프레스를 부르기 전에 거절된다', async () => {
        const { service, cancelRequestsMock, printCancel } = makeAdminContext();
        cancelRequestsMock.precheck.mockRejectedValue(new Error('취소 수량(99개)이 취소 가능 수량(1개)을 초과합니다.'));
        const lines = [
          { salesOrderLineId: 'print-line', quantity: 1 },
          { salesOrderLineId: 'normal-line', quantity: 99 },
        ];
        await expect(service.adminCancelRequest(SO_ID, { lines, fulfillmentCommandContext: ctx })).rejects.toThrow(
          '취소 수량(99개)',
        );
        expect(cancelRequestsMock.precheck).toHaveBeenCalledWith(SO_ID, lines, undefined);
        expect(printCancel).not.toHaveBeenCalled();
        expect(cancelRequestsMock.request).not.toHaveBeenCalled();
      });

      it('Medusa 주문 — 이미 환불한 금액이 범위상 거절되면 인쇄를 취소하기 전에 거절된다', async () => {
        const { service, cancelRequestsMock, printCancel } = makeAdminContext();
        cancelRequestsMock.precheck.mockRejectedValue(new Error('이미 환불한 금액은 부분취소에만 적을 수 있습니다.'));
        const lines = [{ salesOrderLineId: 'print-line', quantity: 1 }];
        await expect(
          service.adminCancelRequest(SO_ID, { lines, alreadyRefundedAmount: 5000, fulfillmentCommandContext: ctx }),
        ).rejects.toThrow('부분취소에만');
        expect(cancelRequestsMock.precheck).toHaveBeenCalledWith(SO_ID, lines, 5000);
        expect(printCancel).not.toHaveBeenCalled();
      });

      it('Medusa 주문 — 같은 Idempotency-Key 재전송은 판정·인쇄 취소 없이 지난 요청을 돌려준다', async () => {
        const { service, cancelRequestsMock, printCancel } = makeAdminContext();
        cancelRequestsMock.findBySourceKey.mockResolvedValue({
          id: 'req-0',
          status: 'settled',
          scope: 'full',
          convertedFromFull: false,
        });
        const result = await service.adminCancelRequest(SO_ID, { fulfillmentCommandContext: ctx });
        expect(result).toEqual({ requestId: 'req-0', status: 'settled', scope: 'full', convertedFromFull: false });
        expect(cancelRequestsMock.precheck).not.toHaveBeenCalled();
        expect(printCancel).not.toHaveBeenCalled();
      });
    });

    describe('core 가 돈을 쥔 주문(3pl) — 커널 한 번, 결과 → 응답 (K7 PR4)', () => {
      const ctx = { idempotencyKey: 'k-c', actorId: 'admin-1', actorRoles: ['admin'] };
      const CORE_SO = () => makeSo({ salesChannel: '3pl' });

      it('커널에 운영자 의도를 그대로 넘긴다 — 키·행위자·권한·줄·사유', async () => {
        const { service, cancellation } = makeAdminContext({ so: CORE_SO() });
        const request = jest
          .spyOn(cancellation, 'request')
          .mockResolvedValue({ kind: 'applied', scope: 'partial', refund: { refundStatus: 'manual_pending' } });
        const lines = [{ salesOrderLineId: 'line-001', quantity: 1 }];
        await service.adminCancelRequest(SO_ID, {
          lines,
          reasonCode: 'ADMIN',
          reasonDetail: '재고 없음',
          fulfillmentCommandContext: ctx,
        });
        expect(request).toHaveBeenCalledWith({
          requester: { kind: 'operator', actorId: 'admin-1' },
          actorRoles: ['admin'],
          salesOrderId: SO_ID,
          sourceKey: 'k-c',
          reasonCode: 'ADMIN',
          reasonDetail: '재고 없음',
          lines,
        });
      });

      it('applied — 다시 읽은 주문 상태와 커널의 환불 결과(추정액·사유)로 답한다', async () => {
        const { service, cancellation } = makeAdminContext({ so: CORE_SO() });
        jest.spyOn(cancellation, 'request').mockResolvedValue({
          kind: 'applied',
          scope: 'partial',
          refund: { refundStatus: 'manual_pending', refundEstimateAmount: 25000, manualReason: 'CHANNEL_ORDER' },
        });
        const result = await service.adminCancelRequest(SO_ID, { fulfillmentCommandContext: ctx });
        expect(result).toEqual({
          status: 'confirmed',
          refundStatus: 'manual_pending',
          refundEstimateAmount: 25000,
          manualReason: 'CHANNEL_ORDER',
        });
      });

      it('applied 전체취소 — 추정액이 없으면 칸도 없다', async () => {
        const { service, cancellation } = makeAdminContext({
          so: makeSo({ salesChannel: '3pl', status: 'cancelled' }),
        });
        jest
          .spyOn(cancellation, 'request')
          .mockResolvedValue({ kind: 'applied', scope: 'full', refund: { refundStatus: 'manual_pending' } });
        expect(await service.adminCancelRequest(SO_ID, { fulfillmentCommandContext: ctx })).toEqual({
          status: 'cancelled',
          refundStatus: 'manual_pending',
        });
      });

      it('replayed — 지금 주문 상태와 지금 환불 상태로 답한다', async () => {
        const { service, cancellation } = makeContext({
          so: makeSo({ salesChannel: '3pl', status: 'cancelled', walletIntentId: null }),
        });
        jest.spyOn(cancellation, 'request').mockResolvedValue({ kind: 'replayed' });
        expect(await service.adminCancelRequest(SO_ID, { fulfillmentCommandContext: ctx })).toEqual({
          status: 'cancelled',
          refundStatus: 'none',
        });
      });

      it('전체취소는 Wallet 을 부르지 않고 «환불 결정 전»으로 남긴다 (D2, 실제 커널)', async () => {
        const { service, salesOrdersServiceMock, walletClientMock, cancelRequestsMock } = makeAdminContext({
          so: CORE_SO(),
        });
        const result = await service.adminCancelRequest(SO_ID, { fulfillmentCommandContext: ctx });
        expect(salesOrdersServiceMock.cancel).toHaveBeenCalledWith(
          SO_ID,
          expect.objectContaining({
            cancelledBy: 'admin',
            walletRefund: expect.objectContaining({
              refundStatus: 'manual_pending',
              metadata: expect.objectContaining({ awaitingDecision: true }),
            }),
          }),
          expect.anything(),
        );
        expect(walletClientMock.refundByIntent).not.toHaveBeenCalled();
        expect(cancelRequestsMock.request).not.toHaveBeenCalled();
        expect(result).toEqual({ status: 'confirmed', refundStatus: 'manual_pending' });
      });

      it('이미 취소된 주문이면 400', async () => {
        const { service } = makeAdminContext({ so: makeSo({ salesChannel: '3pl', status: 'cancelled' }) });
        await expect(service.adminCancelRequest(SO_ID, { fulfillmentCommandContext: ctx })).rejects.toThrow(
          '이미 취소된 주문입니다.',
        );
      });

      it('키가 없으면 400 — 커널 규칙(K7 PR4 부터 core 정산 주문도)', async () => {
        const { service, salesOrdersServiceMock } = makeAdminContext({ so: CORE_SO() });
        await expect(service.adminCancelRequest(SO_ID, {})).rejects.toThrow('Idempotency-Key header is required');
        expect(salesOrdersServiceMock.cancel).not.toHaveBeenCalled();
      });
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
  });

  describe('printGateByWalletIntent (무통장 환불 승인 전)', () => {
    it('살아 있는 인쇄 줄이 있으면 PrintNeedsPartialCancelError(409) — 와우프레스 취소는 시도하지 않는다', async () => {
      const { service, printCancel } = makeContext({
        printOrders: [{ status: 'submitted', orderAttemptedAt: new Date() }],
      });
      const error = await service.printGateByWalletIntent(WALLET_INTENT_ID).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PrintNeedsPartialCancelError);
      expect((error as PrintNeedsPartialCancelError).getHttpStatus()).toBe(409);
      expect((error as PrintNeedsPartialCancelError).getErrorCode()).toBe('PRINT_NEEDS_PARTIAL_CANCEL');
      expect(printCancel).not.toHaveBeenCalled();
    });

    it('판매주문이 아직 없으면 통과시킨다(환불 신청된 주문은 수집되지 않아 막으면 풀리지 않는다)', async () => {
      const { service } = makeContext({ noSalesOrder: true });
      await expect(service.printGateByWalletIntent(WALLET_INTENT_ID)).resolves.toEqual({ ok: true });
    });

    it('인쇄 줄이 없거나 모두 취소됐으면 ok', async () => {
      const { service } = makeContext({ printOrders: [{ status: 'cancelled', orderAttemptedAt: new Date() }] });
      await expect(service.printGateByWalletIntent(WALLET_INTENT_ID)).resolves.toEqual({ ok: true });
    });
  });

  describe('cancelByWalletIntentAfterRefund', () => {
    it('Medusa 주문은 wallet 승인 요청자로 전체취소를 요청한다 — core 취소·Wallet 없음', async () => {
      const { service, dbMock, salesOrdersServiceMock, walletClientMock, cancelRequestsMock } = makeAdminContext();
      const result = await service.cancelByWalletIntentAfterRefund(WALLET_INTENT_ID, { amount: 50000 });
      expect(cancelRequestsMock.request).toHaveBeenCalledWith(
        {
          salesOrderId: SO_ID,
          requester: { kind: 'wallet-refund-approval', intentId: WALLET_INTENT_ID },
          sourceKey: `wallet-refund-approval:${WALLET_INTENT_ID}`,
          reasonCode: 'CUSTOMER_REFUND_REQUEST',
        },
        dbMock.db,
      );
      expect(result).toEqual({ status: 'requested', requestId: 'req-1' });
      expect(salesOrdersServiceMock.cancel).not.toHaveBeenCalled();
      expect(walletClientMock.refundByIntent).not.toHaveBeenCalled();
    });

    it('환불이 이미 나갔으므로 취소를 확정하고 같은 트랜잭션에서 안 보낸 인쇄를 붙잡은 뒤, 커밋 뒤 record 로 멈춘다', async () => {
      const order: string[] = [];
      const printCancel = jest.fn((_id: string, mode: string) => {
        order.push(`print:${mode}`);
        return Promise.resolve(PRINT_RESULT);
      });
      const holdUnsent = jest.fn(() => {
        order.push('print:hold');
        return Promise.resolve(undefined);
      });
      const { service, dbMock, cancelRequestsMock } = makeAdminContext({ printCancel, holdUnsent });
      cancelRequestsMock.request.mockImplementation(() => {
        order.push('request');
        return Promise.resolve({ id: 'req-1', status: 'requested', scope: 'full', convertedFromFull: false });
      });
      const result = await service.cancelByWalletIntentAfterRefund(WALLET_INTENT_ID);
      expect(holdUnsent).toHaveBeenCalledWith(SO_ID, undefined, dbMock.db);
      expect(printCancel).toHaveBeenCalledWith(SO_ID, 'record');
      expect(order).toEqual(['request', 'print:hold', 'print:record']);
      expect(result).toEqual({ status: 'requested', requestId: 'req-1' });
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

  // retryWalletRefund 규칙(재시도·수동 완료·환불 안 함)은 cancellation-refund.manager.spec.ts 가 소유한다.
  // 이 서비스는 한 줄 위임만 한다.
  describe('환불 위임', () => {
    it('retryWalletRefund·adminManualRefundComplete 는 매니저에 그대로 넘긴다', async () => {
      const { service } = makeContext();
      const manager = (service as unknown as { cancellationRefund: CancellationRefundManager }).cancellationRefund;
      const retry = jest.spyOn(manager, 'retry').mockResolvedValue({ refundStatus: 'succeeded' });
      const complete = jest
        .spyOn(manager, 'completeManually')
        .mockResolvedValue({ refundStatus: 'succeeded', completionType: 'manual' });
      await service.retryWalletRefund(SO_ID);
      await service.adminManualRefundComplete(SO_ID, { adminNote: 'n' });
      expect(retry).toHaveBeenCalledWith(SO_ID);
      expect(complete).toHaveBeenCalledWith(SO_ID, { adminNote: 'n' });
    });
  });

  describe('tracking query V2 graph', () => {
    const dialect = new PgDialect();
    const statusOf = (row: unknown): unknown =>
      typeof row === 'object' && row !== null && 'status' in row ? row.status : undefined;

    function makeTrackingService(rowsBySelect: unknown[][], printRows: Array<Record<string, unknown>> = []) {
      let call = 0;
      const dbMock = {
        run: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(dbMock.db)),
        db: {
          select: jest.fn().mockImplementation(() => ({
            from: jest.fn().mockImplementation((table: Parameters<typeof getTableName>[0]) => ({
              where: jest.fn().mockImplementation((condition: SQL) => {
                const given = rowsBySelect[call++] ?? [];
                // 상자 select 는 «id 목록 안 + 이 상태들 제외» 조건이다. 가짜가 WHERE 를 무시하면 상태 필터가 보이지 않으므로
                // 조건에 값으로 실린 상태를 가진 상자를 뺀다
                const excluded = getTableName(table) === 'shipments' ? dialect.sqlToQuery(condition).params : [];
                const rows = given.filter((row) => !excluded.includes(statusOf(row)));
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
      const salesOrdersServiceMock = {};
      const cancelRequestsMock = {};
      const printReader = printReaderMock(printRows);
      const printCancellation = printCancelMock();
      return new StoreSalesOrdersService(
        dbMock as never,
        {} as WalletRefundClient,
        cancelRequestsMock as never,
        printReader,
        new OrderCancellation(
          dbMock as never,
          salesOrdersServiceMock as never,
          cancelRequestsMock as never,
          printReader,
          printCancellation,
          {} as never,
          new OrderCancellationReader(),
          new CancellationRefundManager(dbMock as never, salesOrdersServiceMock as never, {} as WalletRefundClient),
        ),
        new CancellationRefundManager(dbMock as never, salesOrdersServiceMock as never, {} as WalletRefundClient),
      );
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

    const printRow = (overrides: Record<string, unknown> = {}) => ({
      id: 'po-1',
      salesOrderId: SO_ID,
      status: 'shipped',
      carrier: 'LOTTE',
      trackingNumber: '1234567890',
      shippedAt: new Date('2026-10-14T01:00:00Z'),
      deliveredAt: null,
      ...overrides,
    });

    it('includes print_order shipments in tracking response and counts them as shipped evidence', async () => {
      const service = makeTrackingService(
        [[makeSo()], []],
        [printRow(), printRow({ id: 'po-2', trackingNumber: null })],
      );

      const result = await service.getTracking(SO_ID, CUSTOMER_ID);

      expect(result.status).toBe('shipping');
      expect(result.shipments).toEqual([
        expect.objectContaining({
          shipmentId: null,
          fulfillmentOrderId: 'po-1',
          carrier: 'LOTTE',
          carrierName: '롯데택배',
          trackingNumber: '1234567890',
          trackingUrl: 'https://www.lotteglogis.com/mobile/reservation/tracking/linkView?InvNo=1234567890',
          status: 'shipping',
          eta: null,
          trackingEvents: [],
        }),
      ]);
    });

    it('merges print rows sharing a tracking number into one shipment', async () => {
      const service = makeTrackingService(
        [[makeSo()], []],
        [
          printRow({ id: 'po-1' }),
          printRow({ id: 'po-2' }),
          printRow({ id: 'po-3' }),
          printRow({ id: 'po-4', trackingNumber: '9999' }),
        ],
      );

      const result = await service.getTracking(SO_ID, CUSTOMER_ID);

      expect(result.shipments).toHaveLength(2);
      expect(result.shipments[0]).toMatchObject({
        fulfillmentOrderId: 'po-1',
        fulfillmentOrderIds: ['po-1', 'po-2', 'po-3'],
        trackingNumber: '1234567890',
      });
      expect(result.shipments[1]).toMatchObject({ fulfillmentOrderIds: ['po-4'], trackingNumber: '9999' });
    });

    it('reports a merged print shipment as delivered only when every row is delivered', async () => {
      const early = new Date('2026-10-14T01:00:00Z');
      const late = new Date('2026-10-16T00:00:00Z');
      const mixed = makeTrackingService(
        [[makeSo()], []],
        [
          printRow({ id: 'po-1', status: 'delivered', shippedAt: late, deliveredAt: late }),
          printRow({ id: 'po-2', shippedAt: early }),
        ],
      );
      const mixedResult = await mixed.getTracking(SO_ID, CUSTOMER_ID);
      expect(mixedResult.shipments[0]).toMatchObject({ status: 'shipping', shippedAt: early, deliveredAt: null });

      const all = makeTrackingService(
        [[makeSo()], []],
        [
          printRow({ id: 'po-1', status: 'delivered', shippedAt: early, deliveredAt: early }),
          printRow({ id: 'po-2', status: 'delivered', shippedAt: late, deliveredAt: late }),
        ],
      );
      const allResult = await all.getTracking(SO_ID, CUSTOMER_ID);
      expect(allResult.shipments[0]).toMatchObject({ status: 'delivered', shippedAt: early, deliveredAt: late });
    });

    it('keeps an empty carrier and null url for an unknown carrier, and reports delivered', async () => {
      const service = makeTrackingService(
        [[makeSo()], []],
        [printRow({ carrier: null, status: 'delivered', deliveredAt: new Date('2026-10-15T00:00:00Z') })],
      );

      const result = await service.getTracking(SO_ID, CUSTOMER_ID);

      expect(result.status).toBe('delivered');
      expect(result.shipments[0]).toMatchObject({
        carrier: '',
        carrierName: '',
        trackingUrl: null,
        status: 'delivered',
      });
    });

    it('does not report delivered while another active print order has no tracking yet', async () => {
      const delivered = printRow({ status: 'delivered', deliveredAt: new Date() });
      const waiting = printRow({
        id: 'po-2',
        status: 'submitted',
        carrier: null,
        trackingNumber: null,
        shippedAt: null,
      });
      const service = makeTrackingService([[makeSo()], []], [delivered, waiting]);
      expect((await service.getTracking(SO_ID, CUSTOMER_ID)).status).toBe('shipping');

      const onlyWaiting = makeTrackingService([[makeSo()], []], [waiting]);
      expect((await onlyWaiting.getTracking(SO_ID, CUSTOMER_ID)).status).toBe('not_shipped');
    });

    it('still reports not_shipped for an order without FO and without print shipments', async () => {
      const service = makeTrackingService([[makeSo()], []]);
      const result = await service.getTracking(SO_ID, CUSTOMER_ID);
      expect(result).toMatchObject({ status: 'not_shipped', shipments: [] });
    });

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

    it('tracking hides superseded boxes', async () => {
      // 합포장으로 합쳐진 원래 상자(superseded)의 라인이 남아 있어도 고객 배송조회에는 합친 상자만 보인다(F11)
      const merged = { id: 'shipment-merged', status: 'superseded' };
      const service = makeTrackingService([
        [makeSo()],
        [fo('fo-1')],
        [item('foi-1', 'fo-1', 'sol-1')],
        [
          { id: 'line-merged', shipmentId: merged.id, fulfillmentOrderItemId: 'foi-1', skuId: 'sku-1', qty: 1 },
          { id: 'line-shared', shipmentId: shipment.id, fulfillmentOrderItemId: 'foi-1', skuId: 'sku-1', qty: 1 },
        ],
        [merged, shipment],
        [],
        [],
        [],
        [{ id: 'sol-1', channelOrderItemId: null }],
      ]);

      const result = await service.getTracking(SO_ID, CUSTOMER_ID);

      expect(result.shipments.map((s) => s.shipmentId)).toEqual([shipment.id]);
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
