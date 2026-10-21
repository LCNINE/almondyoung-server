import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbTx, returnExchangeTables } from '../../inventory/schema/inventory.schema';
import { seedWorld, World } from '../../fulfillment/order-progress/__support__/order-progress.fixtures';
import { inRollbackTx, makeDb } from '../../fulfillment/services/__support__';
import {
  DeliveredLine,
  seedClaim,
  seedComponentSku,
  seedDeliveredLine,
} from '../line-quantities/__support__/claim-facts.fixtures';
import { recordSalesOrderCancellation } from '../cancellation-record/record-cancellation';
import { StoreCreateReturnRequestDto } from '../dto/store-return-request.dto';
import { readParcelClaimEligibility } from '../line-quantities/parcel-claim-eligibility.reader';
import { StoreReturnExchangeService } from './store-return-exchange.service';

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

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describeIfDb('반품 생성 게이트 — 소포 단위 청구 자격 (K6 PR3a)', () => {
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
      await recordSalesOrderCancellation(tx, {
        salesOrderId: line.salesOrderId,
        cancellationScope: 'partial',
        reasonCode: 'customer',
        metadata: { cancelledLines: [{ salesOrderLineId: line.lineId, quantity: 1 }] },
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
      });
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
});
