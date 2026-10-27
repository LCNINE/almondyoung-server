import { StoreReturnExchangeService } from './store-return-exchange.service';
import { returnExchangeTables, wmsTables } from '../../inventory/schema/inventory.schema';
import { readReturnRequestSalesUnits } from '../line-quantities/claim-quantities.reader';
import { LineQuantities, readLineQuantities } from '../line-quantities/line-quantities.reader';

// 수량은 수량 문이 정한다 — 환불의 판매 단위(`readReturnRequestSalesUnits`)와 누적 반품(`readLineQuantities`)을 준다.
// 그 문의 SQL 은 DB 통합 스펙(`store-return-exchange.claims.integration.spec.ts`)이 지킨다.
jest.mock('../line-quantities/claim-quantities.reader');
jest.mock('../line-quantities/line-quantities.reader');
const mockedSalesUnits = jest.mocked(readReturnRequestSalesUnits);
const mockedLineQuantities = jest.mocked(readLineQuantities);

/**
 * 반품 완료가 아웃박스로 «나가는가»만 본다. 무엇을 회수할지의 판정은 ugc 쪽 policy 스펙이 본다.
 *
 * 반품 완료 종점은 셋이다 — 환불액 0 즉시 완료 · Wallet 환불 성공 · 관리자 수동 완료.
 * 셋 다 같은 멱등키로 같은 이벤트를 내보내야 한다. 하나라도 빠지면 그 경로로 끝난 반품은
 * 「사서 → 리뷰 → 적립 → 반품」이 그대로 통한다.
 */

const RR_ID = '11111111-1111-1111-1111-111111111111';
const SO_ID = '22222222-2222-2222-2222-222222222222';
const LINE_ID = '33333333-3333-3333-3333-333333333333';
const SKU_ID = '44444444-4444-4444-4444-444444444444';

/** 단품 라인(1개당 1) 의 수량 — 완료 반품에서 돌아온 SKU 수량만 본다. */
function singleSkuLine(ordered: number, returnConsumed: number): LineQuantities {
  return {
    salesOrderLineId: LINE_ID,
    ordered,
    canceledBeforeShipment: 0,
    canceledAfterShipment: 0,
    canceled: 0,
    demand: ordered,
    remaining: ordered,
    returnHeld: 0,
    skus: [
      {
        skuId: SKU_ID,
        qtyPerUnit: 1,
        required: ordered,
        shipped: ordered,
        forwarded: 0,
        delivered: ordered,
        partnerCompleted: 0,
        outstanding: 0,
        returnActive: 0,
        returnConsumed,
        exchangeActive: 0,
        claimable: ordered - returnConsumed,
      },
    ],
  };
}

type Rows = Record<string, unknown>[];

function terminal(rows: Rows): Record<string, unknown> {
  const self: Record<string, unknown> = {
    limit: (n: number) => Promise.resolve(rows.slice(0, n)),
    where: () => terminal(rows),
    orderBy: () => terminal(rows),
    groupBy: () => terminal(rows),
    innerJoin: () => terminal(rows),
    leftJoin: () => terminal(rows),
    for: () => terminal(rows),
    then: (r: (v: Rows) => unknown) => Promise.resolve(rows).then(r),
  };
  return self;
}

function makeHarness(options: {
  status: string;
  /** 반품 요청 라인 (이벤트 helper 의 leftJoin 결과) */
  requestLines?: Rows;
  /** 주문 라인 단가 — 결제 총액이 없어 환불액 = 단가 × 반품 판매 단위 */
  unitPrice?: number;
  /** 그 라인의 완료 반품에서 돌아온 SKU 수량 (이 건 포함) */
  returnConsumed?: number;
  channelOrderId?: string | null;
  walletIntentId?: string | null;
  refundOutcome?: Record<string, unknown>;
}) {
  let currentRr: Record<string, unknown> = {
    id: RR_ID,
    salesOrderId: SO_ID,
    status: options.status,
    reasonCode: 'defective',
    reasonDetail: null,
  };
  const requestLines = options.requestLines ?? [
    {
      salesOrderLineId: LINE_ID,
      channelOrderItemId: 'item_01',
      orderedQuantity: 2,
    },
  ];
  let attemptSel = 0;
  mockedSalesUnits.mockResolvedValue(new Map([[LINE_ID, { kind: 'whole', units: 2 }]]));
  mockedLineQuantities.mockResolvedValue(new Map([[LINE_ID, singleSkuLine(2, options.returnConsumed ?? 2)]]));

  const rowsFor = (table: unknown): Rows => {
    if (table === returnExchangeTables.returnRequests) return [currentRr];
    if (table === wmsTables.salesOrders) {
      return [
        {
          id: SO_ID,
          channelOrderId: options.channelOrderId === undefined ? 'order_01' : options.channelOrderId,
          walletIntentId: options.walletIntentId ?? null,
          totalAmount: null,
          shippingFee: 0,
        },
      ];
    }
    if (table === wmsTables.salesOrderLines) {
      return [{ id: LINE_ID, quantity: 2, unitPrice: options.unitPrice ?? 5000, totalPrice: null }];
    }
    if (table === returnExchangeTables.returnRequestItems) return requestLines;
    if (table === returnExchangeTables.returnRefundAttempts) {
      attemptSel++;
      return attemptSel === 1 ? [] : [{ maxN: 0 }];
    }
    return [];
  };

  const tx = {
    select: jest.fn(() => ({ from: (t: unknown) => terminal(rowsFor(t)) })),
    insert: jest.fn(() => ({
      values: jest.fn((vals: Record<string, unknown>) => ({
        returning: jest.fn().mockResolvedValue([{ id: 'attempt-1', ...vals }]),
        then: (r: (v: unknown) => unknown) => Promise.resolve(undefined).then(r),
      })),
    })),
    update: jest.fn((table: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: () => {
          if (table === returnExchangeTables.returnRequests) {
            currentRr = { ...currentRr, ...set };
            return { returning: jest.fn().mockResolvedValue([currentRr]) };
          }
          return { returning: jest.fn().mockResolvedValue([{ ...set }]) };
        },
      }),
    })),
  };

  const db = { db: { select: tx.select, transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)) } };
  const wallet = {
    refundByIntent: jest.fn().mockResolvedValue(options.refundOutcome ?? { kind: 'success', refunds: [] }),
  };
  const publisher = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const service = new StoreReturnExchangeService(db as never, wallet as never, publisher as never);

  return { service, publisher, tx };
}

describe('반품 완료 → SalesOrderReturned 발행', () => {
  it('환불액 0으로 즉시 완료된 반품이 이벤트를 낸다', async () => {
    // unitPrice 0 → refundAmount 0 → immediateComplete
    const h = makeHarness({ status: 'inspected', unitPrice: 0 });

    await h.service.completeReturnRequest(RR_ID, 'admin-1');

    expect(h.publisher.enqueue).toHaveBeenCalledTimes(1);
    const [params] = h.publisher.enqueue.mock.calls[0];
    expect(params).toMatchObject({
      idempotencyKey: `so-returned:${RR_ID}`,
      eventType: 'SalesOrderReturned',
      aggregateId: SO_ID,
      payload: {
        orderId: SO_ID,
        channelOrderId: 'order_01',
        returnRequestId: RR_ID,
        reason: 'defective',
        returnedLines: [
          { salesOrderLineId: LINE_ID, channelOrderItemId: 'item_01', orderedQuantity: 2, returnedQuantity: 2 },
        ],
      },
    });
  });

  it('Wallet 환불이 성공해 완료된 반품이 이벤트를 낸다', async () => {
    const h = makeHarness({ status: 'inspected', walletIntentId: 'intent-1' });

    const result = await h.service.completeReturnRequest(RR_ID, 'admin-1');

    expect(result.status).toBe('completed');
    expect(h.publisher.enqueue).toHaveBeenCalledTimes(1);
    expect(h.publisher.enqueue.mock.calls[0][0].idempotencyKey).toBe(`so-returned:${RR_ID}`);
  });

  it('Wallet 환불이 확정 실패하면 완료가 아니므로 이벤트도 나가지 않는다', async () => {
    const h = makeHarness({
      status: 'inspected',
      walletIntentId: 'intent-1',
      refundOutcome: { kind: 'failed', determinate: true, errorCode: 'INVALID' },
    });

    await h.service.completeReturnRequest(RR_ID, 'admin-1');

    expect(h.publisher.enqueue).not.toHaveBeenCalled();
  });

  it('관리자 수동 완료도 같은 이벤트를 낸다 — 종점 하나만 빠져도 그 경로는 회수되지 않는다', async () => {
    const h = makeHarness({ status: 'refund_pending' });

    await h.service.manualCompleteReturn(RR_ID, 'admin-1', '계좌이체로 환불 완료');

    expect(h.publisher.enqueue).toHaveBeenCalledTimes(1);
    expect(h.publisher.enqueue.mock.calls[0][0].payload.returnRequestId).toBe(RR_ID);
  });

  it('주문 라인을 못 찾는 반품 라인은 페이로드에서 빠진다 — 수량을 0으로 뭉개지 않는다', async () => {
    const h = makeHarness({
      status: 'refund_pending',
      requestLines: [{ salesOrderLineId: LINE_ID, channelOrderItemId: null, orderedQuantity: null }],
    });

    await h.service.manualCompleteReturn(RR_ID, 'admin-1');

    expect(h.publisher.enqueue).not.toHaveBeenCalled();
  });

  it('channelOrderId 가 없어도 이벤트는 나간다 — 회수할지는 소비자가 판정한다', async () => {
    const h = makeHarness({ status: 'refund_pending', channelOrderId: null });

    await h.service.manualCompleteReturn(RR_ID, 'admin-1');

    expect(h.publisher.enqueue.mock.calls[0][0].payload.channelOrderId).toBeUndefined();
  });
});
