import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DbTx, returnExchangeTables, wmsTables } from '../../inventory/schema/inventory.schema';
import { seedWorld, World } from '../../fulfillment/order-progress/__support__/order-progress.fixtures';
import { inRollbackTx, makeDb } from '../../fulfillment/services/__support__';
import {
  DeliveredLine,
  seedClaim,
  seedComponentSku,
  seedDeliveredLine,
} from '../line-quantities/__support__/claim-facts.fixtures';
import { recallParcel } from '../line-quantities/__support__/shipment-facts.fixtures';
import { recordSalesOrderCancellation } from '../cancellation-record/record-cancellation';
import { StoreCreateReturnRequestDto } from '../dto/store-return-request.dto';
import { StoreCreateExchangeRequestDto } from '../dto/store-exchange-request.dto';
import { readParcelClaimEligibility } from '../line-quantities/parcel-claim-eligibility.reader';
import { CUSTOM_MADE_CLAIM_MESSAGE, StoreReturnExchangeService } from './store-return-exchange.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** 반품 완료 종점이 아웃박스에 적재하는 발행자. 생성 경로는 적재 호출만 한다. */
const makeCoreOrdersPublisher = () => ({ enqueue: jest.fn().mockResolvedValue(undefined) });

function makeService(tx: DbTx): StoreReturnExchangeService {
  return new StoreReturnExchangeService(
    { db: tx } as never,
    { refundByIntent: jest.fn() } as never,
    makeCoreOrdersPublisher() as never,
  );
}

/** 환불·완료 이벤트를 보는 서비스 — Wallet 은 언제나 성공한다. 두 목을 돌려줘 금액·적재를 본다. */
function makeRefundHarness(tx: DbTx) {
  const wallet = { refundByIntent: jest.fn().mockResolvedValue({ kind: 'success', refunds: [] }) };
  const publisher = makeCoreOrdersPublisher();
  const service = new StoreReturnExchangeService({ db: tx } as never, wallet as never, publisher as never);
  return { service, wallet, publisher };
}

/** 발행자에 적재된 이벤트 — `[eventType, payload]`. */
function enqueued(
  publisher: ReturnType<typeof makeCoreOrdersPublisher>,
): Array<{ eventType: string; payload: unknown }> {
  return publisher.enqueue.mock.calls.map(([params]: [{ eventType: string; payload: unknown }]) => params);
}

const INTENT_ID = 'intent-k6-claims';

/** Wallet 으로 결제된 주문 — 반품 환불이 자동으로 나갈 수 있다. */
async function payOrder(tx: DbTx, salesOrderId: string, money: { totalAmount: number; shippingFee: number }) {
  await tx
    .update(wmsTables.salesOrders)
    .set({ walletIntentId: INTENT_ID, ...money })
    .where(eq(wmsTables.salesOrders.id, salesOrderId));
}

/** 픽스처 맵 조회 — 없으면 픽스처가 틀린 것이다. */
function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`fixture miss: ${what}`);
  return value;
}

/** 소포 i 의 SKU 줄 — 요청 줄과 청구 항목에 같은 모양으로 쓴다. */
function parcelLine(line: DeliveredLine, parcelIndex: number, skuId: string, quantity: number) {
  const parcel = must(line.parcels[parcelIndex], `parcel ${parcelIndex}`);
  return {
    salesOrderLineId: line.lineId,
    shipmentLineId: must(parcel.shipmentLineIdBySku.get(skuId), `parcel ${parcelIndex} line of ${skuId}`),
    dispatchAttemptId: parcel.dispatchAttemptId,
    quantity,
  };
}

function dto(lines: StoreCreateReturnRequestDto['lines']): StoreCreateReturnRequestDto {
  return { reasonCode: 'defective', lines };
}

function exchangeDto(lines: StoreCreateExchangeRequestDto['lines']): StoreCreateExchangeRequestDto {
  return { reasonCode: 'defective', lines };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describeIfDb('반품·교환 생성 게이트 — 소포 단위 청구 자격 (K6 PR3a)', () => {
  jest.setTimeout(120_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  async function seedSingle(
    tx: DbTx,
    args: { quantity?: number; parcels?: Array<{ qty: number; delivered?: boolean }> } = {},
  ): Promise<{ w: World; customerId: string; line: DeliveredLine }> {
    const w = await seedWorld(tx);
    const customerId = randomUUID();
    const line = await seedDeliveredLine(tx, w, {
      quantity: args.quantity ?? 1,
      composition: [{ skuId: w.skuId, qtyPerUnit: 1 }],
      parcels: (args.parcels ?? [{ qty: 1 }]).map((parcel) => ({
        qtyBySku: { [w.skuId]: parcel.qty },
        delivered: parcel.delivered,
      })),
      customerId,
    });
    return { w, customerId, line };
  }

  it('line-level request with one parcel is expanded', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, customerId, line } = await seedSingle(tx);
      const created = await makeService(tx).createReturnRequest(
        line.salesOrderId,
        customerId,
        dto([{ salesOrderLineId: line.lineId, quantity: 1 }]),
      );

      const expected = parcelLine(line, 0, w.skuId, 1);
      expect(created.items).toEqual([expect.objectContaining(expected)]);
      const stored = await tx
        .select()
        .from(returnExchangeTables.returnRequestItems)
        .where(eq(returnExchangeTables.returnRequestItems.returnRequestId, created.id));
      expect(stored).toEqual([expect.objectContaining(expected)]);
    });
  });

  it('line-level request with two parcels asks for a parcel', async () => {
    await inRollbackTx(db, async (tx) => {
      const { customerId, line } = await seedSingle(tx, { quantity: 2, parcels: [{ qty: 1 }, { qty: 1 }] });
      const error = await rejection(
        makeService(tx).createReturnRequest(
          line.salesOrderId,
          customerId,
          dto([{ salesOrderLineId: line.lineId, quantity: 1 }]),
        ),
      );
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error).toMatchObject({
        message: `주문 라인 ${line.lineId}은 소포와 구성품을 지정해야 합니다(후보 2개). 반품 가능 목록에서 고르세요.`,
      });
    });
  });

  it('line-level request for a set line asks for a parcel', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const customerId = randomUUID();
      const skuB = await seedComponentSku(tx, w);
      const line = await seedDeliveredLine(tx, w, {
        quantity: 1,
        composition: [
          { skuId: w.skuId, qtyPerUnit: 1 },
          { skuId: skuB, qtyPerUnit: 1 },
        ],
        parcels: [{ qtyBySku: { [w.skuId]: 1, [skuB]: 1 } }],
        customerId,
      });
      const error = await rejection(
        makeService(tx).createReturnRequest(
          line.salesOrderId,
          customerId,
          dto([{ salesOrderLineId: line.lineId, quantity: 1 }]),
        ),
      );
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error).toMatchObject({
        message: `주문 라인 ${line.lineId}은 소포와 구성품을 지정해야 합니다(후보 2개). 반품 가능 목록에서 고르세요.`,
      });
    });
  });

  it('line-level request for a two-per-unit line asks for a parcel', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const customerId = randomUUID();
      const line = await seedDeliveredLine(tx, w, {
        quantity: 1,
        composition: [{ skuId: w.skuId, qtyPerUnit: 2 }],
        parcels: [{ qtyBySku: { [w.skuId]: 2 } }],
        customerId,
      });
      const error = await rejection(
        makeService(tx).createReturnRequest(
          line.salesOrderId,
          customerId,
          dto([{ salesOrderLineId: line.lineId, quantity: 1 }]),
        ),
      );
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error).toMatchObject({
        message: `주문 라인 ${line.lineId}은 소포와 구성품을 지정해야 합니다(후보 1개). 반품 가능 목록에서 고르세요.`,
      });
    });
  });

  it('half parcel identity is refused', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, customerId, line } = await seedSingle(tx);
      const { shipmentLineId } = parcelLine(line, 0, w.skuId, 1);
      const error = await rejection(
        makeService(tx).createReturnRequest(
          line.salesOrderId,
          customerId,
          dto([{ salesOrderLineId: line.lineId, shipmentLineId, quantity: 1 }]),
        ),
      );
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error).toMatchObject({ message: 'shipmentLineId 와 dispatchAttemptId 는 함께 보내야 합니다.' });
    });
  });

  it('set component return is capped per sku', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const customerId = randomUUID();
      const skuB = await seedComponentSku(tx, w);
      const line = await seedDeliveredLine(tx, w, {
        quantity: 1,
        composition: [
          { skuId: w.skuId, qtyPerUnit: 1 },
          { skuId: skuB, qtyPerUnit: 2 },
        ],
        parcels: [{ qtyBySku: { [w.skuId]: 1, [skuB]: 2 } }],
        customerId,
      });
      const service = makeService(tx);
      const over = parcelLine(line, 0, skuB, 3);
      const error = await rejection(service.createReturnRequest(line.salesOrderId, customerId, dto([over])));
      expect(error).toBeInstanceOf(BadRequestException);
      // 옛 판매 단위 상한이면 라인 수량 1 이 상한이었다(F8) — 이제 상한은 그 소포의 B 2 다
      expect(error).toMatchObject({
        message: `배송 시도 ${over.dispatchAttemptId}의 라인 ${over.shipmentLineId} 반품 가능 수량(2)을 초과하였습니다. (요청: 3)`,
      });

      const created = await service.createReturnRequest(
        line.salesOrderId,
        customerId,
        dto([parcelLine(line, 0, skuB, 2)]),
      );
      expect(created.items).toEqual([expect.objectContaining({ quantity: 2 })]);
    });
  });

  it('duplicate lines for one parcel are summed', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, customerId, line } = await seedSingle(tx);
      const one = parcelLine(line, 0, w.skuId, 1);
      const error = await rejection(
        makeService(tx).createReturnRequest(line.salesOrderId, customerId, dto([one, { ...one }])),
      );
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error).toMatchObject({
        message: `배송 시도 ${one.dispatchAttemptId}의 라인 ${one.shipmentLineId} 반품 가능 수량(1)을 초과하였습니다. (요청: 2)`,
      });
    });
  });

  it('over-limit message clamps a negative claimable to 0', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, customerId, line } = await seedSingle(tx);
      const one = parcelLine(line, 0, w.skuId, 1);
      // 완료 반품 1 + 출고 뒤 취소 1 — SKU 몫이 1 − 1 − 1 = −1, 소포 claimable 도 −1 이다
      await seedClaim(tx, { kind: 'return', salesOrderId: line.salesOrderId, status: 'completed', items: [one] });
      // 엔진은 다 나간 라인의 부분취소를 거절하므로(R1) 엔진이 남기는 모양을 쓰기 문에 직접 넘긴다
      await recordSalesOrderCancellation(
        tx,
        {
          salesOrderId: line.salesOrderId,
          cancellationScope: 'partial',
          reasonCode: 'customer',
          effects: [
            {
              type: 'preserved_shipped_fulfillment_order_item',
              metadata: {
                salesOrderLineId: line.lineId,
                skuId: w.skuId,
                requestedFulfillmentQuantity: 1,
                affectedShippedQuantity: 1,
              },
            },
          ],
        },
        [{ salesOrderLineId: line.lineId, quantity: 1 }],
      );
      const [parcel] = await readParcelClaimEligibility(tx, line.salesOrderId);
      expect(parcel).toMatchObject({ skuClaimable: -1, claimable: -1 });

      const error = await rejection(makeService(tx).createReturnRequest(line.salesOrderId, customerId, dto([one])));
      expect(error).toBeInstanceOf(BadRequestException);
      // 비교는 원값(−1), 문구는 0 으로 클램프한다(R6)
      expect(error).toMatchObject({
        message: `배송 시도 ${one.dispatchAttemptId}의 라인 ${one.shipmentLineId} 반품 가능 수량(0)을 초과하였습니다. (요청: 1)`,
      });
    });
  });

  it('active exchange blocks a return of the same parcel', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, customerId, line } = await seedSingle(tx);
      const one = parcelLine(line, 0, w.skuId, 1);
      await seedClaim(tx, { kind: 'exchange', salesOrderId: line.salesOrderId, status: 'approved', items: [one] });
      const error = await rejection(makeService(tx).createReturnRequest(line.salesOrderId, customerId, dto([one])));
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error).toMatchObject({
        message: `배송 시도 ${one.dispatchAttemptId}의 라인 ${one.shipmentLineId} 반품 가능 수량(0)을 초과하였습니다. (요청: 1)`,
      });
    });
  });

  it('undelivered line has no candidate', async () => {
    await inRollbackTx(db, async (tx) => {
      const { customerId, line } = await seedSingle(tx, { parcels: [{ qty: 1, delivered: false }] });
      const error = await rejection(
        makeService(tx).createReturnRequest(
          line.salesOrderId,
          customerId,
          dto([{ salesOrderLineId: line.lineId, quantity: 1 }]),
        ),
      );
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error).toMatchObject({
        message: `주문 라인 ${line.lineId}에 반품할 수 있는 배송 완료 소포가 없습니다.`,
      });
    });
  });

  it('attempt that does not carry the box line is refused', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, customerId, line } = await seedSingle(tx, { quantity: 2, parcels: [{ qty: 1 }, { qty: 1 }] });
      const first = parcelLine(line, 0, w.skuId, 1);
      const second = parcelLine(line, 1, w.skuId, 1);
      const crossed = { ...first, shipmentLineId: second.shipmentLineId };
      const error = await rejection(makeService(tx).createReturnRequest(line.salesOrderId, customerId, dto([crossed])));
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error).toMatchObject({
        message: `배송 완료된 소포가 아니거나 이 주문 라인의 것이 아닙니다: ${first.dispatchAttemptId}/${second.shipmentLineId}`,
      });
    });
  });

  it('line of another order is refused', async () => {
    await inRollbackTx(db, async (tx) => {
      const { customerId, line } = await seedSingle(tx);
      const other = await seedSingle(tx);
      const error = await rejection(
        makeService(tx).createReturnRequest(
          line.salesOrderId,
          customerId,
          dto([{ salesOrderLineId: other.line.lineId, quantity: 1 }]),
        ),
      );
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error).toMatchObject({
        message: `다음 주문 라인이 해당 주문에 속하지 않습니다: ${other.line.lineId}`,
      });
    });
  });

  it('active return request blocks a new one', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, customerId, line } = await seedSingle(tx, { quantity: 2, parcels: [{ qty: 1 }, { qty: 1 }] });
      await seedClaim(tx, {
        kind: 'return',
        salesOrderId: line.salesOrderId,
        status: 'requested',
        items: [parcelLine(line, 0, w.skuId, 1)],
      });
      const error = await rejection(
        makeService(tx).createReturnRequest(line.salesOrderId, customerId, dto([parcelLine(line, 1, w.skuId, 1)])),
      );
      expect(error).toBeInstanceOf(ConflictException);
      expect(error).toMatchObject({ message: '이미 진행 중인 반품 요청이 있습니다.' });
    });
  });

  it('exact delivered attempt is allowed while the order is partial', async () => {
    await inRollbackTx(db, async (tx) => {
      // 주문은 confirmed, FO 는 ready — 소포 하나만 배송완료, 하나는 아직 배송 중
      const { w, customerId, line } = await seedSingle(tx, {
        quantity: 2,
        parcels: [{ qty: 1 }, { qty: 1, delivered: false }],
      });
      const delivered = parcelLine(line, 0, w.skuId, 1);
      const created = await makeService(tx).createReturnRequest(line.salesOrderId, customerId, dto([delivered]));
      expect(created).toMatchObject({ status: 'requested', items: [expect.objectContaining(delivered)] });

      const inTransit = parcelLine(line, 1, w.skuId, 1);
      await tx
        .update(returnExchangeTables.returnRequests)
        .set({ status: 'cancelled' })
        .where(eq(returnExchangeTables.returnRequests.id, created.id));
      const error = await rejection(
        makeService(tx).createReturnRequest(line.salesOrderId, customerId, dto([inTransit])),
      );
      expect(error).toMatchObject({
        message: `배송 완료된 소포가 아니거나 이 주문 라인의 것이 아닙니다: ${inTransit.dispatchAttemptId}/${inTransit.shipmentLineId}`,
      });
    });
  });

  it('eligibility mirrors the parcel claim facts of a set line', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const customerId = randomUUID();
      const skuB = await seedComponentSku(tx, w);
      const line = await seedDeliveredLine(tx, w, {
        quantity: 1,
        composition: [
          { skuId: w.skuId, qtyPerUnit: 1 },
          { skuId: skuB, qtyPerUnit: 2 },
        ],
        parcels: [{ qtyBySku: { [w.skuId]: 1, [skuB]: 2 } }],
        customerId,
      });
      const a = parcelLine(line, 0, w.skuId, 1);
      const b = parcelLine(line, 0, skuB, 1);
      await seedClaim(tx, { kind: 'return', salesOrderId: line.salesOrderId, status: 'completed', items: [b] });

      const eligibility = await makeService(tx).getReturnEligibility(line.salesOrderId, customerId);
      expect(eligibility.items).toHaveLength(2);
      expect(eligibility.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            salesOrderLineId: line.lineId,
            shipmentLineId: a.shipmentLineId,
            dispatchAttemptId: a.dispatchAttemptId,
            shipmentId: line.parcels[0].shipmentId,
            shippedQty: 1,
            claimedQty: 0,
            remainingEligibleQty: 1,
            salesOrderLineRemainingEligibleQty: 1,
          }),
          expect.objectContaining({
            salesOrderLineId: line.lineId,
            shipmentLineId: b.shipmentLineId,
            dispatchAttemptId: b.dispatchAttemptId,
            shippedQty: 2,
            claimedQty: 1,
            remainingEligibleQty: 1,
            salesOrderLineRemainingEligibleQty: 1,
          }),
        ]),
      );
    });
  });

  // ── 교환 — 반품과 같은 게이트(Task 4) ───────────────────────────────────

  it('exchange needs a delivered parcel', async () => {
    await inRollbackTx(db, async (tx) => {
      // 옛 자격(SO delivered · FO completed)은 다 갖췄지만 소포는 아직 배송 중이다 — 자격은 소포가 정한다(C1)
      const { customerId, line } = await seedSingle(tx, { parcels: [{ qty: 1, delivered: false }] });
      await tx
        .update(wmsTables.salesOrders)
        .set({ status: 'delivered' })
        .where(eq(wmsTables.salesOrders.id, line.salesOrderId));
      await tx
        .update(wmsTables.fulfillmentOrders)
        .set({ status: 'completed' })
        .where(eq(wmsTables.fulfillmentOrders.salesOrderId, line.salesOrderId));

      const error = await rejection(
        makeService(tx).createExchangeRequest(
          line.salesOrderId,
          customerId,
          exchangeDto([{ salesOrderLineId: line.lineId, quantity: 1 }]),
        ),
      );
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error).toMatchObject({
        message: `주문 라인 ${line.lineId}에 교환할 수 있는 배송 완료 소포가 없습니다.`,
      });
    });
  });

  it('exchange records the parcel', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, customerId, line } = await seedSingle(tx);
      const desiredVariantId = randomUUID();
      const created = await makeService(tx).createExchangeRequest(
        line.salesOrderId,
        customerId,
        exchangeDto([{ salesOrderLineId: line.lineId, quantity: 1, desiredVariantId }]),
      );

      const expected = parcelLine(line, 0, w.skuId, 1);
      expect(created.items).toEqual([expect.objectContaining({ ...expected, desiredVariantId })]);
      const stored = await tx
        .select()
        .from(returnExchangeTables.exchangeRequestItems)
        .where(eq(returnExchangeTables.exchangeRequestItems.exchangeRequestId, created.id));
      expect(stored).toEqual([expect.objectContaining({ ...expected, desiredVariantId })]);
    });
  });

  it('completed return consumes exchange', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, customerId, line } = await seedSingle(tx);
      const one = parcelLine(line, 0, w.skuId, 1);
      await seedClaim(tx, { kind: 'return', salesOrderId: line.salesOrderId, status: 'completed', items: [one] });

      const error = await rejection(
        makeService(tx).createExchangeRequest(line.salesOrderId, customerId, exchangeDto([one])),
      );
      expect(error).toBeInstanceOf(BadRequestException);
      // 돌려받은 물건은 교환할 수 없다(F3) — 옛 교환 검사는 진행 중 청구만 빼서 이걸 통과시켰다
      expect(error).toMatchObject({
        message: `배송 시도 ${one.dispatchAttemptId}의 라인 ${one.shipmentLineId} 교환 가능 수량(0)을 초과하였습니다. (요청: 1)`,
      });
    });
  });

  it('completed exchange does not consume', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, customerId, line } = await seedSingle(tx);
      const one = parcelLine(line, 0, w.skuId, 1);
      await seedClaim(tx, { kind: 'exchange', salesOrderId: line.salesOrderId, status: 'completed', items: [one] });

      // 교환으로 받은 물건도 다시 교환할 수 있다(D3)
      const created = await makeService(tx).createExchangeRequest(line.salesOrderId, customerId, exchangeDto([one]));
      expect(created).toMatchObject({ status: 'requested', items: [expect.objectContaining(one)] });
    });
  });

  it('exchange of a recalled parcel is refused', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, customerId, line } = await seedSingle(tx);
      const one = parcelLine(line, 0, w.skuId, 1);
      await recallParcel(tx, {
        dispatchAttemptId: one.dispatchAttemptId,
        lines: [{ foItemId: must(line.foItemIdBySku.get(w.skuId), 'FOI of A'), qty: 1 }],
      });

      const error = await rejection(
        makeService(tx).createExchangeRequest(line.salesOrderId, customerId, exchangeDto([one])),
      );
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error).toMatchObject({
        message: `배송 완료된 소포가 아니거나 이 주문 라인의 것이 아닙니다: ${one.dispatchAttemptId}/${one.shipmentLineId}`,
      });
    });
  });

  it('active exchange request blocks a new one', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, customerId, line } = await seedSingle(tx, { quantity: 2, parcels: [{ qty: 1 }, { qty: 1 }] });
      await seedClaim(tx, {
        kind: 'exchange',
        salesOrderId: line.salesOrderId,
        status: 'requested',
        items: [parcelLine(line, 0, w.skuId, 1)],
      });
      const error = await rejection(
        makeService(tx).createExchangeRequest(
          line.salesOrderId,
          customerId,
          exchangeDto([parcelLine(line, 1, w.skuId, 1)]),
        ),
      );
      expect(error).toBeInstanceOf(ConflictException);
      expect(error).toMatchObject({ message: '이미 진행 중인 교환 요청이 있습니다.' });
    });
  });

  it('custom-made line is refused before anything', async () => {
    await inRollbackTx(db, async (tx) => {
      // 배송 중 소포 + 진행 중 교환 — 게이트까지 갔다면 409 가 났을 것이다. 주문제작 거절이 그보다 먼저다
      const { w, customerId, line } = await seedSingle(tx, { parcels: [{ qty: 1, delivered: false }] });
      await tx
        .update(wmsTables.salesOrderLines)
        .set({ almondDesignId: randomUUID() })
        .where(eq(wmsTables.salesOrderLines.id, line.lineId));
      await seedClaim(tx, {
        kind: 'exchange',
        salesOrderId: line.salesOrderId,
        status: 'requested',
        items: [parcelLine(line, 0, w.skuId, 1)],
      });

      const error = await rejection(
        makeService(tx).createExchangeRequest(
          line.salesOrderId,
          customerId,
          exchangeDto([{ salesOrderLineId: line.lineId, quantity: 1 }]),
        ),
      );
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error).toMatchObject({ message: CUSTOM_MADE_CLAIM_MESSAGE });
      const requests = await tx
        .select({ id: returnExchangeTables.exchangeRequests.id })
        .from(returnExchangeTables.exchangeRequests)
        .where(eq(returnExchangeTables.exchangeRequests.salesOrderId, line.salesOrderId));
      expect(requests).toHaveLength(1);
    });
  });

  // ── 반품 환불 수량과 반품 완료 이벤트 (Task 5) ───────────────────────────

  /** A×1·B×2 세트 라인 수량 1, 소포 하나에 통째로 배송완료. */
  async function seedSetLine(
    tx: DbTx,
  ): Promise<{ customerId: string; line: DeliveredLine; skuA: string; skuB: string }> {
    const w = await seedWorld(tx);
    const customerId = randomUUID();
    const skuB = await seedComponentSku(tx, w);
    const line = await seedDeliveredLine(tx, w, {
      quantity: 1,
      composition: [
        { skuId: w.skuId, qtyPerUnit: 1 },
        { skuId: skuB, qtyPerUnit: 2 },
      ],
      parcels: [{ qtyBySku: { [w.skuId]: 1, [skuB]: 2 } }],
      customerId,
    });
    return { customerId, line, skuA: w.skuId, skuB };
  }

  it('two parcels of one line are refunded together', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, line } = await seedSingle(tx, { quantity: 2, parcels: [{ qty: 1 }, { qty: 1 }] });
      // 단가 1000 × 2 = 상품 2000, 배송비 3000 — 전체 반품이면 5000, 1개만 세면 1000 이다
      await payOrder(tx, line.salesOrderId, { totalAmount: 5000, shippingFee: 3000 });
      const { requestId } = await seedClaim(tx, {
        kind: 'return',
        salesOrderId: line.salesOrderId,
        status: 'inspected',
        items: [parcelLine(line, 0, w.skuId, 1), parcelLine(line, 1, w.skuId, 1)],
      });
      const { service, wallet } = makeRefundHarness(tx);

      const result = await service.completeReturnRequest(requestId, 'admin-1');

      // 옛 계산은 같은 라인의 마지막 줄(1개)만 셌다(F2)
      expect(wallet.refundByIntent).toHaveBeenCalledWith(INTENT_ID, 5000, expect.anything());
      expect(result.status).toBe('completed');
    });
  });

  it('whole set return is refunded by sets', async () => {
    await inRollbackTx(db, async (tx) => {
      const { line, skuA, skuB } = await seedSetLine(tx);
      await payOrder(tx, line.salesOrderId, { totalAmount: 5000, shippingFee: 3000 });
      const { requestId } = await seedClaim(tx, {
        kind: 'return',
        salesOrderId: line.salesOrderId,
        status: 'inspected',
        items: [parcelLine(line, 0, skuA, 1), parcelLine(line, 0, skuB, 2)],
      });
      const { service, wallet } = makeRefundHarness(tx);

      const result = await service.completeReturnRequest(requestId, 'admin-1');

      // SKU 수량 A 1·B 2 = 세트 1 = 라인 수량 전부 → 전체 반품
      expect(wallet.refundByIntent).toHaveBeenCalledWith(INTENT_ID, 5000, expect.anything());
      expect(result.status).toBe('completed');
    });
  });

  it('whole set return of a two-set line is prorated by sets', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const customerId = randomUUID();
      const skuB = await seedComponentSku(tx, w);
      // A×1·B×2 세트 라인 수량 2 — 소포 하나에 A 2·B 4 배송완료
      const line = await seedDeliveredLine(tx, w, {
        quantity: 2,
        composition: [
          { skuId: w.skuId, qtyPerUnit: 1 },
          { skuId: skuB, qtyPerUnit: 2 },
        ],
        parcels: [{ qtyBySku: { [w.skuId]: 2, [skuB]: 4 } }],
        customerId,
      });
      const money = { totalAmount: 5000, shippingFee: 3000 };
      await payOrder(tx, line.salesOrderId, money);
      // A 1·B 2 = 세트 1. SKU 수량(3, 또는 B 2)을 판매 단위로 읽으면 라인 수량 2 이상이라 전체 반품(5000)이 된다
      const { requestId } = await seedClaim(tx, {
        kind: 'return',
        salesOrderId: line.salesOrderId,
        status: 'inspected',
        items: [parcelLine(line, 0, w.skuId, 1), parcelLine(line, 0, skuB, 2)],
      });
      const { service, wallet } = makeRefundHarness(tx);

      await service.completeReturnRequest(requestId, 'admin-1');

      // 부분 반품 공식: 라인 무게 × (반품 세트 ÷ 라인 수량) × (결제총액 − 배송비) ÷ 라인 무게 합
      const [orderLine] = await tx
        .select({ unitPrice: wmsTables.salesOrderLines.unitPrice, quantity: wmsTables.salesOrderLines.quantity })
        .from(wmsTables.salesOrderLines)
        .where(eq(wmsTables.salesOrderLines.id, line.lineId));
      const lineWeight = (orderLine.unitPrice ?? 0) * orderLine.quantity;
      const expected = Math.round(
        (((lineWeight * 1) / orderLine.quantity) * (money.totalAmount - money.shippingFee)) / lineWeight,
      );
      expect(expected).not.toBe(money.totalAmount);
      expect(wallet.refundByIntent).toHaveBeenCalledWith(INTENT_ID, expected, expect.anything());
    });
  });

  // ── 세트 일부 반품 — 관리자가 상한 안에서 금액을 넣어 완료한다 (K6 PR3b) ─────────

  /** 세트 일부(B 1개) 반품 요청 — 상품 소계 2000(결제 5000 − 배송비 3000). */
  async function seedSetPartialReturn(tx: DbTx) {
    const set = await seedSetLine(tx);
    await payOrder(tx, set.line.salesOrderId, { totalAmount: 5000, shippingFee: 3000 });
    const { requestId } = await seedClaim(tx, {
      kind: 'return',
      salesOrderId: set.line.salesOrderId,
      status: 'inspected',
      items: [parcelLine(set.line, 0, set.skuB, 1)],
    });
    return { ...set, requestId };
  }

  async function returnRow(tx: DbTx, requestId: string) {
    const [row] = await tx
      .select({
        status: returnExchangeTables.returnRequests.status,
        adminRefundAmount: returnExchangeTables.returnRequests.adminRefundAmount,
        adminNote: returnExchangeTables.returnRequests.adminNote,
      })
      .from(returnExchangeTables.returnRequests)
      .where(eq(returnExchangeTables.returnRequests.id, requestId));
    return row;
  }

  it('plain completion of a set-partial return asks for an amount', async () => {
    await inRollbackTx(db, async (tx) => {
      const { requestId } = await seedSetPartialReturn(tx);
      const { service, wallet } = makeRefundHarness(tx);

      const error = await rejection(service.completeReturnRequest(requestId, 'admin-1'));

      // B 1개는 세트 몇 개인지 정할 수 없다 — 자동 금액이 없으므로 금액 완료로 보낸다(A3)
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error).toMatchObject({ message: '세트 구성품 일부 반품입니다. 환불 금액을 입력해 완료하세요.' });
      expect((await returnRow(tx, requestId)).status).toBe('inspected');
      expect(wallet.refundByIntent).not.toHaveBeenCalled();
    });
  });

  it('quote of a set-partial return is the admin cap', async () => {
    await inRollbackTx(db, async (tx) => {
      const { requestId } = await seedSetPartialReturn(tx);
      const { service } = makeRefundHarness(tx);

      await expect(service.getReturnRefundQuote(requestId)).resolves.toEqual({ kind: 'admin_amount', cap: 2000 });
    });
  });

  it('quote of a whole-set return is automatic', async () => {
    await inRollbackTx(db, async (tx) => {
      const { line, skuA, skuB } = await seedSetLine(tx);
      await payOrder(tx, line.salesOrderId, { totalAmount: 5000, shippingFee: 3000 });
      const { requestId } = await seedClaim(tx, {
        kind: 'return',
        salesOrderId: line.salesOrderId,
        status: 'inspected',
        items: [parcelLine(line, 0, skuA, 1), parcelLine(line, 0, skuB, 2)],
      });
      const { service } = makeRefundHarness(tx);

      await expect(service.getReturnRefundQuote(requestId)).resolves.toEqual({ kind: 'automatic', amount: 5000 });
    });
  });

  it('admin amount within the cap is refunded', async () => {
    await inRollbackTx(db, async (tx) => {
      const { requestId } = await seedSetPartialReturn(tx);
      const { service, wallet } = makeRefundHarness(tx);

      const result = await service.completeReturnRequestWithAmount(requestId, 'admin-1', {
        refundAmount: 1200,
        adminNote: '구성품 B 1개',
      });

      expect(wallet.refundByIntent).toHaveBeenCalledWith(INTENT_ID, 1200, expect.anything());
      expect(result.status).toBe('completed');
      expect(await returnRow(tx, requestId)).toEqual({
        status: 'completed',
        adminRefundAmount: 1200,
        adminNote: '구성품 B 1개',
      });
      const links = await tx
        .select({ metadata: wmsTables.businessLinks.metadata })
        .from(wmsTables.businessLinks)
        .where(
          and(
            eq(wmsTables.businessLinks.sourceId, requestId),
            eq(wmsTables.businessLinks.relationName, 'return_lifecycle_event'),
          ),
        );
      expect(links).toHaveLength(1);
      expect(links[0].metadata).toMatchObject({
        event: 'return_refund_pending',
        refundAmountSource: 'admin_input',
        refundAmount: 1200,
        refundCap: 2000,
        adminNote: '구성품 B 1개',
      });
    });
  });

  it('admin amount over the cap is refused', async () => {
    await inRollbackTx(db, async (tx) => {
      const { requestId } = await seedSetPartialReturn(tx);
      const { service, wallet } = makeRefundHarness(tx);

      const error = await rejection(
        service.completeReturnRequestWithAmount(requestId, 'admin-1', { refundAmount: 2001, adminNote: '초과' }),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error).toMatchObject({ message: '환불 금액이 상한(2000원)을 넘습니다.' });
      expect((await returnRow(tx, requestId)).status).toBe('inspected');
      expect(wallet.refundByIntent).not.toHaveBeenCalled();
    });
  });

  it('admin amount on an automatic return is refused', async () => {
    await inRollbackTx(db, async (tx) => {
      const { line, skuA, skuB } = await seedSetLine(tx);
      await payOrder(tx, line.salesOrderId, { totalAmount: 5000, shippingFee: 3000 });
      const { requestId } = await seedClaim(tx, {
        kind: 'return',
        salesOrderId: line.salesOrderId,
        status: 'inspected',
        items: [parcelLine(line, 0, skuA, 1), parcelLine(line, 0, skuB, 2)],
      });
      const { service, wallet } = makeRefundHarness(tx);

      const error = await rejection(
        service.completeReturnRequestWithAmount(requestId, 'admin-1', { refundAmount: 1000, adminNote: '통째' }),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error).toMatchObject({ message: '자동 환불 금액이 정해지는 반품입니다. 완료 처리를 사용하세요.' });
      expect((await returnRow(tx, requestId)).status).toBe('inspected');
      expect(wallet.refundByIntent).not.toHaveBeenCalled();
    });
  });

  it('zero admin amount completes without refund', async () => {
    await inRollbackTx(db, async (tx) => {
      const { requestId } = await seedSetPartialReturn(tx);
      const { service, wallet, publisher } = makeRefundHarness(tx);

      const result = await service.completeReturnRequestWithAmount(requestId, 'admin-1', {
        refundAmount: 0,
        adminNote: '환불 없음',
      });

      expect(result.status).toBe('completed');
      expect(wallet.refundByIntent).not.toHaveBeenCalled();
      expect(enqueued(publisher).map((event) => event.eventType)).toContain('SalesOrderClaimProgressed');
      expect((await returnRow(tx, requestId)).adminRefundAmount).toBe(0);
      const links = await tx
        .select({ metadata: wmsTables.businessLinks.metadata })
        .from(wmsTables.businessLinks)
        .where(
          and(
            eq(wmsTables.businessLinks.sourceId, requestId),
            eq(wmsTables.businessLinks.relationName, 'return_lifecycle_event'),
          ),
        );
      expect(links.map((link) => link.metadata)).toEqual([
        expect.objectContaining({ event: 'return_completed', refundAmountSource: 'admin_input', refundAmount: 0 }),
      ]);
    });
  });

  it('retry after admin amount reuses the stored amount', async () => {
    await inRollbackTx(db, async (tx) => {
      const { requestId } = await seedSetPartialReturn(tx);
      const { service, wallet } = makeRefundHarness(tx);
      // 첫 호출만 확정 실패 — attempt 가 닫혀 재시도는 새 attempt 를 만든다
      wallet.refundByIntent.mockResolvedValueOnce({
        kind: 'failed',
        errorCode: 'X',
        errorMessage: 'refused',
        determinate: true,
      });

      const first = await service.completeReturnRequestWithAmount(requestId, 'admin-1', {
        refundAmount: 1200,
        adminNote: '구성품 B 1개',
      });
      expect(first.status).toBe('refund_pending');

      const retried = await service.retryReturnRefund(requestId, 'admin-1');

      // 재시도는 다시 계산하지 않고 저장된 금액을 쓴다(A6) — 계산하면 세트 일부라 400 이다
      expect(wallet.refundByIntent).toHaveBeenCalledTimes(2);
      expect(wallet.refundByIntent).toHaveBeenNthCalledWith(2, INTENT_ID, 1200, expect.anything());
      expect(retried.status).toBe('completed');
    });
  });

  it('prior known refund reduces the cap', async () => {
    await inRollbackTx(db, async (tx) => {
      const { line, skuA, requestId } = await seedSetPartialReturn(tx);
      const prior = await seedClaim(tx, {
        kind: 'return',
        salesOrderId: line.salesOrderId,
        status: 'completed',
        items: [parcelLine(line, 0, skuA, 1)],
      });
      await tx.insert(returnExchangeTables.returnRefundAttempts).values({
        returnRequestId: prior.requestId,
        attemptNumber: 1,
        idempotencyKey: `return:${prior.requestId}:refund:1`,
        amount: 700,
        status: 'succeeded',
      });
      const { service } = makeRefundHarness(tx);

      // 같은 라인을 건드린 앞선 완료 반품이 700 을 이미 돌려줬다
      await expect(service.getReturnRefundQuote(requestId)).resolves.toEqual({ kind: 'admin_amount', cap: 1300 });
    });
  });

  it('prior manual return zeroes the cap', async () => {
    await inRollbackTx(db, async (tx) => {
      const { line, skuA, requestId } = await seedSetPartialReturn(tx);
      // 시도 행 없는 완료 반품 = 금액 모름 → 그 라인의 배분액은 0(A4)
      await seedClaim(tx, {
        kind: 'return',
        salesOrderId: line.salesOrderId,
        status: 'completed',
        items: [parcelLine(line, 0, skuA, 1)],
      });
      const { service } = makeRefundHarness(tx);

      await expect(service.getReturnRefundQuote(requestId)).resolves.toEqual({ kind: 'admin_amount', cap: 0 });
      const error = await rejection(
        service.completeReturnRequestWithAmount(requestId, 'admin-1', { refundAmount: 1, adminNote: '1원' }),
      );
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error).toMatchObject({ message: '환불 금액이 상한(0원)을 넘습니다.' });
      const result = await service.completeReturnRequestWithAmount(requestId, 'admin-1', {
        refundAmount: 0,
        adminNote: '이미 환불됨',
      });
      expect(result.status).toBe('completed');
    });
  });

  it('prior admin zero return is a known zero', async () => {
    await inRollbackTx(db, async (tx) => {
      const { line, skuA, requestId } = await seedSetPartialReturn(tx);
      // 관리자가 0원을 넣고 시도 행이 없는 완료 반품 = 돈이 안 나간 것이 확실하다 → 배분액을 지우지 않는다
      const { requestId: priorId } = await seedClaim(tx, {
        kind: 'return',
        salesOrderId: line.salesOrderId,
        status: 'completed',
        items: [parcelLine(line, 0, skuA, 1)],
      });
      await tx
        .update(returnExchangeTables.returnRequests)
        .set({ adminRefundAmount: 0 })
        .where(eq(returnExchangeTables.returnRequests.id, priorId));
      const { service } = makeRefundHarness(tx);

      await expect(service.getReturnRefundQuote(requestId)).resolves.toEqual({ kind: 'admin_amount', cap: 2000 });
    });
  });

  it('automatic return after an admin amount on the same line asks for an amount', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const customerId = randomUUID();
      const skuB = await seedComponentSku(tx, w);
      // A×1·B×2 세트 라인 수량 2 — 소포 하나에 A 2·B 4 배송완료. 라인 배분액 2000(결제 5000 − 배송비 3000)
      const line = await seedDeliveredLine(tx, w, {
        quantity: 2,
        composition: [
          { skuId: w.skuId, qtyPerUnit: 1 },
          { skuId: skuB, qtyPerUnit: 2 },
        ],
        parcels: [{ qtyBySku: { [w.skuId]: 2, [skuB]: 4 } }],
        customerId,
      });
      await payOrder(tx, line.salesOrderId, { totalAmount: 5000, shippingFee: 3000 });
      // 앞선 반품 B 1개 — 관리자가 배분액 전부(2000)를 넣어 환불했다
      const prior = await seedClaim(tx, {
        kind: 'return',
        salesOrderId: line.salesOrderId,
        status: 'completed',
        items: [parcelLine(line, 0, skuB, 1)],
      });
      await tx
        .update(returnExchangeTables.returnRequests)
        .set({ adminRefundAmount: 2000 })
        .where(eq(returnExchangeTables.returnRequests.id, prior.requestId));
      await tx.insert(returnExchangeTables.returnRefundAttempts).values({
        returnRequestId: prior.requestId,
        attemptNumber: 1,
        idempotencyKey: `return:${prior.requestId}:refund:1`,
        amount: 2000,
        status: 'succeeded',
      });
      // 이번 반품 A 1·B 2 = 세트 1 통째 — 자동이면 1000 이 더 나가 라인 배분액(2000)을 넘는다
      const { requestId } = await seedClaim(tx, {
        kind: 'return',
        salesOrderId: line.salesOrderId,
        status: 'inspected',
        items: [parcelLine(line, 0, w.skuId, 1), parcelLine(line, 0, skuB, 2)],
      });
      const { service, wallet } = makeRefundHarness(tx);

      await expect(service.getReturnRefundQuote(requestId)).resolves.toEqual({ kind: 'admin_amount', cap: 0 });
      const error = await rejection(service.completeReturnRequest(requestId, 'admin-1'));
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error).toMatchObject({ message: '세트 구성품 일부 반품입니다. 환불 금액을 입력해 완료하세요.' });
      expect((await returnRow(tx, requestId)).status).toBe('inspected');
      expect(wallet.refundByIntent).not.toHaveBeenCalled();
    });
  });

  it('admin amount without a wallet intent waits for manual refund', async () => {
    await inRollbackTx(db, async (tx) => {
      const { line, skuB } = await seedSetLine(tx);
      // Wallet 결제가 아닌 주문 — 금액 칸만 있다
      await tx
        .update(wmsTables.salesOrders)
        .set({ totalAmount: 5000, shippingFee: 3000 })
        .where(eq(wmsTables.salesOrders.id, line.salesOrderId));
      const { requestId } = await seedClaim(tx, {
        kind: 'return',
        salesOrderId: line.salesOrderId,
        status: 'inspected',
        items: [parcelLine(line, 0, skuB, 1)],
      });
      const { service, wallet } = makeRefundHarness(tx);

      const result = await service.completeReturnRequestWithAmount(requestId, 'admin-1', {
        refundAmount: 1200,
        adminNote: '구성품 B 1개',
      });

      // 양수 + walletIntentId 없음 → 수동 완료 대기(A1)
      expect(result.status).toBe('refund_pending');
      expect(wallet.refundByIntent).not.toHaveBeenCalled();
      expect(await returnRow(tx, requestId)).toMatchObject({ status: 'refund_pending', adminRefundAmount: 1200 });

      const completed = await service.manualCompleteReturn(requestId, 'admin-1', '계좌 이체');
      expect(completed.status).toBe('completed');
    });
  });

  it('cancelled unit is not refundable again', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const customerId = randomUUID();
      const skuB = await seedComponentSku(tx, w);
      // A×1·B×2 세트 라인 수량 2 — 소포 하나에 A 2·B 4 배송완료
      const line = await seedDeliveredLine(tx, w, {
        quantity: 2,
        composition: [
          { skuId: w.skuId, qtyPerUnit: 1 },
          { skuId: skuB, qtyPerUnit: 2 },
        ],
        parcels: [{ qtyBySku: { [w.skuId]: 2, [skuB]: 4 } }],
        customerId,
      });
      await payOrder(tx, line.salesOrderId, { totalAmount: 5000, shippingFee: 3000 });
      // 1세트 취소(출고 전 갈래) — totalAmount 는 그대로라 배분액을 남은 비율로 줄여야 한다(U1)
      await recordSalesOrderCancellation(
        tx,
        {
          salesOrderId: line.salesOrderId,
          cancellationScope: 'partial',
          reasonCode: 'customer',
          effects: [],
        },
        [{ salesOrderLineId: line.lineId, quantity: 1 }],
      );
      const { requestId } = await seedClaim(tx, {
        kind: 'return',
        salesOrderId: line.salesOrderId,
        status: 'inspected',
        items: [parcelLine(line, 0, skuB, 1)],
      });
      const { service } = makeRefundHarness(tx);

      await expect(service.getReturnRefundQuote(requestId)).resolves.toEqual({ kind: 'admin_amount', cap: 1000 });
    });
  });

  it('second completion of the same return is refused', async () => {
    await inRollbackTx(db, async (tx) => {
      const { requestId } = await seedSetPartialReturn(tx);
      const { service, wallet } = makeRefundHarness(tx);
      await service.completeReturnRequestWithAmount(requestId, 'admin-1', {
        refundAmount: 1200,
        adminNote: '구성품 B 1개',
      });

      const error = await rejection(
        service.completeReturnRequestWithAmount(requestId, 'admin-1', { refundAmount: 1200, adminNote: '또' }),
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect(wallet.refundByIntent).toHaveBeenCalledTimes(1);
    });
  });

  it('set-partial return publishes no returned event', async () => {
    await inRollbackTx(db, async (tx) => {
      const { line, skuB } = await seedSetLine(tx);
      const { requestId } = await seedClaim(tx, {
        kind: 'return',
        salesOrderId: line.salesOrderId,
        status: 'refund_pending',
        items: [parcelLine(line, 0, skuB, 1)],
      });
      const { service, publisher } = makeRefundHarness(tx);

      await service.manualCompleteReturn(requestId, 'admin-1', '계좌이체로 환불');

      // 통째로 돌아온 세트가 0 이라 라인이 빠지고, 빠진 라인뿐이라 이벤트가 안 나간다(C7)
      const eventTypes = enqueued(publisher).map((event) => event.eventType);
      expect(eventTypes).toContain('SalesOrderClaimProgressed');
      expect(eventTypes).not.toContain('SalesOrderReturned');
    });
  });

  it('whole set return publishes returned sets', async () => {
    await inRollbackTx(db, async (tx) => {
      const { line, skuA, skuB } = await seedSetLine(tx);
      const { requestId } = await seedClaim(tx, {
        kind: 'return',
        salesOrderId: line.salesOrderId,
        status: 'refund_pending',
        items: [parcelLine(line, 0, skuA, 1), parcelLine(line, 0, skuB, 2)],
      });
      const { service, publisher } = makeRefundHarness(tx);

      await service.manualCompleteReturn(requestId, 'admin-1');

      const returned = enqueued(publisher).filter((event) => event.eventType === 'SalesOrderReturned');
      expect(returned).toHaveLength(1);
      // SKU 수량 합 3 이 아니라 통째 세트 1 — 라인 하나에 한 번
      expect(returned[0].payload).toMatchObject({
        returnRequestId: requestId,
        returnedLines: [
          { salesOrderLineId: line.lineId, orderedQuantity: 1, returnedQuantity: 1, remainingQuantity: 1 },
        ],
      });
    });
  });

  it('returned event carries remaining after an after-shipment cancellation', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, line } = await seedSingle(tx, { quantity: 2, parcels: [{ qty: 2 }] });
      await recordSalesOrderCancellation(
        tx,
        {
          salesOrderId: line.salesOrderId,
          cancellationScope: 'partial',
          reasonCode: 'customer',
          effects: [
            {
              type: 'preserved_shipped_fulfillment_order_item',
              metadata: {
                salesOrderLineId: line.lineId,
                skuId: w.skuId,
                requestedFulfillmentQuantity: 1,
                affectedShippedQuantity: 1,
              },
            },
          ],
        },
        [{ salesOrderLineId: line.lineId, quantity: 1 }],
      );
      const { requestId } = await seedClaim(tx, {
        kind: 'return',
        salesOrderId: line.salesOrderId,
        status: 'refund_pending',
        items: [parcelLine(line, 0, w.skuId, 1)],
      });
      const { service, publisher } = makeRefundHarness(tx);

      await service.manualCompleteReturn(requestId, 'admin-1');

      const returned = enqueued(publisher).filter((event) => event.eventType === 'SalesOrderReturned');
      expect(returned).toHaveLength(1);
      expect(returned[0].payload).toMatchObject({
        returnedLines: [{ orderedQuantity: 2, returnedQuantity: 1, remainingQuantity: 1 }],
      });
    });
  });
});
