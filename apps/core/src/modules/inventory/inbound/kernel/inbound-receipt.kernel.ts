import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../schema/inventory.schema';
import type { InboundReceipt, InboundReceiptLine } from '../../schema/inventory.schema';
import { InventoryCommandService } from '../../core/services/inventory-command.service';
import { LocationService } from '../../core/services/location.service';
import { StockEventStore } from '../../core/repositories/stock-event.store';
import { destinationIssue } from '../../shared/policies/location-work-policy';
import { lockWorkLocations } from '../../shared/locks/location-work-lock';
import { acquireStockAvailabilityLocks } from '../../shared/locks/stock-availability-lock';
import { BatchControlledStockGuard } from '../../core/services/batch-controlled-stock.guard';
import { receiptActionPolicy } from '../services/inbound-receipt-policy';
import { isTodaySeoul } from '../../shared/services/time.util';

export type DirectArrivalMethod = 'simple' | 'simple_fullscan' | 'individual';
export type InboundReceiptSource = 'direct' | 'purchase_order';
export type ArrivalOrigin = { source: 'direct'; method: DirectArrivalMethod } | { source: 'purchase_order' };

export interface ArrivalLineInput {
  skuId: string;
  quantity: number;
  memo?: string;
  /** 원장 이벤트 멱등 키. 호출자가 현행 문자열을 그대로 넘긴다 — 커널은 가공하지 않는다. */
  eventKey: string;
}

export type RecordArrivalInput = ArrivalOrigin & {
  actorId?: string;
  warehouseId: string;
  /** 비우면 입고기본존. 지정값은 검증하지 않는다(현행 개별입고와 같다). */
  locationId?: string | null;
  /** 원장 이벤트와 작업 로그의 reason. */
  reason: string;
  lines: ArrivalLineInput[];
};

export interface RecordArrivalResult {
  receipt: InboundReceipt;
  lines: InboundReceiptLine[];
}

export interface CancelLineInput {
  receiptLineId: string;
  /** 넘기면 라인 수량과 같은지 본다 — 당일 취소는 전량만 허용한다(현행 `/inbound/cancel` 계약). */
  quantity?: number;
  expected: { source: InboundReceiptSource };
}

export interface PutawayInput {
  receiptLineId: string;
  toLocationId: string;
  quantity: number;
  eventKey: string;
}

export interface ReturnLineInput {
  receiptLineId: string;
  quantity: number;
  reason?: string;
  eventKey: string;
}

/**
 * 입고 커널 — 창고에 물건이 들어온 사실과 그 뒤 현장 처리를 소유한다(스펙 §3).
 *
 * 문서(발주·이동 지시서)의 정산은 모른다. 문서가 이 커널을 부르고, 커널은 문서를 부르지 않는다
 * (`inbound-kernel-boundary.arch.spec.ts` 가 import 방향을 잠근다).
 *
 * 🔴 **트랜잭션을 스스로 열지 않는다** — `DbService` 를 주입받지 않는다. 모든 public 메서드의 `tx` 는
 * 마지막 인자이고 **필수**다(CLAUDE.md «tx?: DbTx as last param» 의 예외). 선택 인자면 호출자가 빠뜨렸을 때
 * 원장·회차는 커밋되고 문서 정산은 롤백되는 식으로 원자성이 조용히 깨진다. 스펙 §8.
 *
 * 🔴 **잠금 순서**: 호출자(문서)가 문서 행 → 문서 라인을 먼저 잡고 커널을 부른다. 커널은 회차 라인과
 * 원장을 잠그고(`cancelLine` 은 회차 헤더를 `FOR NO KEY UPDATE` 로 잠근다),
 * 문서 행은 절대 잠그지 않는다 — 역방향 간선이 없으므로 교착 사이클이 생기지 않는다(스펙 §7.1).
 *
 * 예외는 현행 Nest 예외와 메시지를 글자 그대로 옮긴다 — 응답 `error` 필드 보존(계획서 Global Constraints).
 */
@Injectable()
export class InboundReceiptKernel {
  constructor(
    private readonly command: InventoryCommandService,
    private readonly location: LocationService,
    private readonly eventStore: StockEventStore,
    private readonly stockAvailability: BatchControlledStockGuard = new BatchControlledStockGuard(),
  ) {}

  /**
   * 도착 한 번 = 저널 1 · 회차 1 · 라인 N · RECEIVE 이벤트 N · 작업 로그 1.
   *
   * 커널은 SKU 존재를 검증하지 않는다 — 호출자가 검증한다. 검증 없이 부르면 `InventoryCommandService.receive`
   * 가 400 `SKU not found: <id>` 로 거절한다(단, `InboundService` 는 그 전에 이미 404 `SKU ${id} not found`
   * 로 거절해 왔다 — 현행 계약이 그렇다).
   */
  async recordArrival(input: RecordArrivalInput, tx: DbTx): Promise<RecordArrivalResult> {
    // Claim every SKU before the first projection, including opposite input line orders.
    await acquireStockAvailabilityLocks(
      tx,
      input.lines.map((line) => ({
        skuId: line.skuId,
        warehouseId: input.warehouseId,
      })),
    );
    const locationId = await this.resolveLocation(input.warehouseId, input.locationId ?? null, tx);
    const method = input.source === 'direct' ? input.method : 'planned';

    const [journal] = await tx
      .insert(wmsTables.stockJournals)
      .values({ sourceType: 'inbound', actorId: input.actorId })
      .returning();

    const [receipt] = await tx
      .insert(wmsTables.inboundReceipts)
      .values({
        method,
        warehouseId: input.warehouseId,
        locationId,
        occurredAt: new Date(),
        status: 'posted',
        totalQuantity: 0,
        journalId: journal.id,
      })
      .returning();

    const lines: InboundReceiptLine[] = [];
    let totalQuantity = 0;
    for (const item of input.lines) {
      const { eventId } = await this.command.receive(
        {
          skuId: item.skuId,
          toWarehouseId: input.warehouseId,
          toLocationId: locationId,
          quantity: item.quantity,
          occurredAt: new Date(),
          reason: input.reason,
          journalId: journal.id,
          idempotencyKey: item.eventKey,
        },
        tx,
      );

      const [line] = await tx
        .insert(wmsTables.inboundReceiptLines)
        .values({
          receiptId: receipt.id,
          skuId: item.skuId,
          quantity: item.quantity,
          originLocationId: locationId,
          eventId: eventId ?? null,
          memo: item.memo,
          source: input.source,
        })
        .returning();

      lines.push(line);
      totalQuantity += item.quantity;
    }

    const [updatedReceipt] = await tx
      .update(wmsTables.inboundReceipts)
      .set({ totalQuantity })
      .where(eq(wmsTables.inboundReceipts.id, receipt.id))
      .returning();

    await tx.insert(wmsTables.inboundWorkLogs).values({
      type: 'INBOUND',
      receiptId: receipt.id,
      warehouseId: input.warehouseId,
      toLocationId: locationId,
      quantity: totalQuantity,
      method,
      reason: input.reason,
    });

    return { receipt: updatedReceipt, lines };
  }

  /**
   * 당일·전량 취소. 원 RECEIVE 이벤트를 역분개하고, 회차의 모든 라인이 취소되면 회차를 voided 로 돌린다.
   * 회차 라인을 **FOR UPDATE** 로 잠근다 — 현행은 잠그지 않고 읽어 적치·회송과 동시에 들어오면 카운터
   * 검증이 샜다(스펙 §7.1).
   *
   * source 검증은 여기 한 곳뿐이다(스펙 §3.3·§8). 반환은 **잠근 시점(갱신 전)의 라인**이다.
   */
  async cancelLine(input: CancelLineInput, tx: DbTx): Promise<InboundReceiptLine> {
    const line = await this.lockLine(input.receiptLineId, tx);
    if (line.source !== input.expected.source) {
      throw new ConflictException(
        line.source === 'purchase_order' ? '발주 입고는 발주에서 취소하세요' : '이 회차 라인은 직접 입고가 아닙니다',
      );
    }
    const receipt = await this.loadReceipt(line.receiptId, tx);
    const originLocationId = this.requireOrigin(line);

    if (input.quantity !== undefined && input.quantity !== line.quantity) {
      throw new BadRequestException('must cancel the full received quantity of the line');
    }
    if ((line.putawayFromOriginQty ?? 0) > 0) {
      throw new BadRequestException('cannot cancel: putaway exists; move all back to origin first');
    }
    if ((line.returnedQty ?? 0) > 0) {
      throw new BadRequestException('cannot cancel: returns exist; cancel returns first');
    }
    if ((line.canceledQty ?? 0) > 0) {
      throw new BadRequestException('already canceled');
    }
    if (!isTodaySeoul(receipt.occurredAt)) {
      throw new BadRequestException('cancel is allowed only on the same day (Asia/Seoul)');
    }

    if (!line.eventId) {
      throw new BadRequestException('original receive eventId missing; cannot perform reversal');
    }
    // reverseEvent also locks event → stock. Keep the same order to avoid a cycle.
    await tx
      .select({ id: wmsTables.stockEvents.id })
      .from(wmsTables.stockEvents)
      .where(eq(wmsTables.stockEvents.id, line.eventId))
      .for('update');
    const onHand = await this.onHandAt(
      { skuId: line.skuId, warehouseId: receipt.warehouseId, locationId: originLocationId },
      tx,
    );
    if (onHand < line.quantity) {
      throw new BadRequestException('insufficient on-hand at origin to cancel');
    }
    await tx
      .update(wmsTables.inboundReceiptLines)
      .set({ canceledQty: line.quantity })
      .where(eq(wmsTables.inboundReceiptLines.id, line.id));
    const reversal = await this.eventStore.reverseEvent(line.eventId, 'CANCEL', tx);

    await tx.insert(wmsTables.inboundWorkLogs).values({
      type: 'CANCEL',
      receiptId: receipt.id,
      lineId: line.id,
      skuId: line.skuId,
      warehouseId: receipt.warehouseId,
      fromLocationId: originLocationId,
      quantity: line.quantity,
      reason: 'CANCEL',
      eventId: reversal?.id ?? null,
    });

    // 모든 라인이 취소되면 헤더를 voided 처리하여 receipts 기반 조회에서 제외
    const siblings = await tx
      .select({
        quantity: wmsTables.inboundReceiptLines.quantity,
        canceledQty: wmsTables.inboundReceiptLines.canceledQty,
      })
      .from(wmsTables.inboundReceiptLines)
      .where(eq(wmsTables.inboundReceiptLines.receiptId, receipt.id));
    if (siblings.every((l) => (l.canceledQty ?? 0) >= (l.quantity ?? 0))) {
      await tx
        .update(wmsTables.inboundReceipts)
        .set({ status: 'voided', totalQuantity: 0 })
        .where(eq(wmsTables.inboundReceipts.id, receipt.id));
    }

    return line;
  }

  /** 즉시 적치 — 원위치(입고 로케이션)에서 같은 창고의 목적지로 내부 이동. 정산에 영향 없음. */
  async putaway(input: PutawayInput, tx: DbTx): Promise<void> {
    const line = await this.lockLine(input.receiptLineId, tx);
    const receipt = await this.loadReceipt(line.receiptId, tx);
    const originLocationId = this.requireOrigin(line);

    await acquireStockAvailabilityLocks(tx, [{ skuId: line.skuId, warehouseId: receipt.warehouseId }]);
    const locations = await lockWorkLocations(tx, [originLocationId, input.toLocationId]);
    const dest = locations.get(input.toLocationId);
    // Preserve the putaway API's historical precedence before the shared policy's
    // warehouse-first classification (system/same, missing, inactive, warehouse).
    if (input.toLocationId === originLocationId || dest?.isSystem) {
      throw new ConflictException({ code: 'INBOUND_PUTAWAY_DESTINATION_INVALID' });
    }
    if (!dest) throw new NotFoundException('destination location not found');
    if (!dest.isActive) throw new BadRequestException('destination location is inactive');
    if (
      destinationIssue({
        purpose: 'putaway',
        warehouseId: receipt.warehouseId,
        sourceLocationId: originLocationId,
        destination: dest,
      }) === 'WRONG_WAREHOUSE'
    ) {
      throw new BadRequestException('destination location must be in the same warehouse');
    }

    const originAvailable = line.quantity - line.putawayFromOriginQty - line.returnedQty - line.canceledQty;
    if (input.quantity <= 0 || input.quantity > originAvailable) {
      throw new BadRequestException('quantity exceeds origin available');
    }

    // Receipt/header, stock and location locks protect these facts before releasing pending quantity.
    const availability = await this.stockAvailability.getAvailability(
      { skuId: line.skuId, warehouseId: receipt.warehouseId, sourceLocationId: originLocationId },
      tx,
      { lock: true },
    );
    const origin = locations.get(originLocationId);
    const [event] = line.eventId
      ? await tx.select().from(wmsTables.stockEvents).where(eq(wmsTables.stockEvents.id, line.eventId))
      : [];
    const policy = receiptActionPolicy({
      receiptStatus: receipt.status,
      quantity: line.quantity,
      canceledQty: line.canceledQty,
      returnedQty: line.returnedQty,
      putawayFromOriginQty: line.putawayFromOriginQty,
      originValid: origin?.warehouseId === receipt.warehouseId,
      isStagingOrigin: origin?.isSystem === true,
      eventExists: event?.transitionType === 'RECEIVE',
      invalidReceipt: false, // getAvailability already rejects invalid bucket facts.
      onHandQty: availability.onHandQty,
      bucketPendingQty: availability.inboundPendingQty,
      custodyQty: availability.batchControlledQty,
      isToday: isTodaySeoul(receipt.occurredAt),
    });
    if (!policy.canPutaway) {
      throw new BadRequestException({
        message: 'receipt is not eligible for putaway',
        reason: policy.putawayBlockReason,
      });
    }

    await tx
      .update(wmsTables.inboundReceiptLines)
      .set({ putawayFromOriginQty: line.putawayFromOriginQty + input.quantity })
      .where(eq(wmsTables.inboundReceiptLines.id, line.id));

    const moveResult = await this.command.moveInternal(
      {
        skuId: line.skuId,
        warehouseId: receipt.warehouseId,
        fromLocationId: originLocationId,
        toLocationId: input.toLocationId,
        quantity: input.quantity,
        reason: 'putaway_internal_move',
        idempotencyKey: input.eventKey,
      },
      tx,
    );

    await tx.insert(wmsTables.inboundWorkLogs).values({
      type: 'PUTAWAY',
      receiptId: receipt.id,
      lineId: line.id,
      skuId: line.skuId,
      warehouseId: receipt.warehouseId,
      fromLocationId: originLocationId,
      toLocationId: input.toLocationId,
      quantity: input.quantity,
      eventId: moveResult.eventId ?? null,
    });
  }

  /** 회송 — 원위치 잔량에서 차감(ADJUST_DOWN). 발주 정산은 바꾸지 않는다(스펙 §3.3). */
  async returnLine(input: ReturnLineInput, tx: DbTx): Promise<void> {
    const line = await this.lockLine(input.receiptLineId, tx);
    const receipt = await this.loadReceipt(line.receiptId, tx);
    const originLocationId = this.requireOrigin(line);

    // 선행 제약: 적치가 존재하면 회송 불가 (원위치로 모두 되돌린 후 처리)
    if ((line.putawayFromOriginQty ?? 0) > 0) {
      throw new BadRequestException('cannot return: putaway exists; move all back to origin first');
    }
    const originAvailable = line.quantity - line.putawayFromOriginQty - line.returnedQty - line.canceledQty;
    if (input.quantity <= 0 || input.quantity > originAvailable) {
      throw new BadRequestException('quantity exceeds origin available');
    }

    const onHand = await this.onHandAt(
      { skuId: line.skuId, warehouseId: receipt.warehouseId, locationId: originLocationId },
      tx,
    );
    if (onHand < input.quantity) {
      throw new BadRequestException('insufficient on-hand at origin');
    }

    await tx
      .update(wmsTables.inboundReceiptLines)
      .set({ returnedQty: line.returnedQty + input.quantity })
      .where(eq(wmsTables.inboundReceiptLines.id, line.id));

    const event = await this.eventStore.createEvent(
      {
        skuId: line.skuId,
        fromWarehouseId: receipt.warehouseId,
        fromLocationId: originLocationId,
        fromState: 'ON_HAND',
        transitionType: 'ADJUST_DOWN',
        quantity: input.quantity,
        occurredAt: new Date(),
        reason: 'RETURN',
        idempotencyKey: input.eventKey,
      },
      tx,
    );

    await tx.insert(wmsTables.inboundWorkLogs).values({
      type: 'RETURN',
      receiptId: receipt.id,
      lineId: line.id,
      skuId: line.skuId,
      warehouseId: receipt.warehouseId,
      fromLocationId: originLocationId,
      quantity: input.quantity,
      reason: input.reason,
      eventId: event?.id ?? null,
    });
  }

  private async resolveLocation(warehouseId: string, locationId: string | null, tx: DbTx): Promise<string> {
    if (locationId) return locationId;
    await this.location.ensureSystemLocations(warehouseId, tx);
    const inboundZone = await this.location.getSystemLocationByRole(warehouseId, 'inbound_default', tx);
    if (!inboundZone) throw new BadRequestException('입고 기본존이 존재하지 않습니다.');
    return inboundZone.id;
  }

  /** 커널 조작마다 **첫 DB 문장**이어야 한다(회차 라인 잠금 → 원장 잠금 순서; 뒤바뀌면 적치·취소가 교착할 수 있다). */
  private async lockLine(receiptLineId: string, tx: DbTx): Promise<InboundReceiptLine> {
    const [line] = await tx
      .select()
      .from(wmsTables.inboundReceiptLines)
      .where(eq(wmsTables.inboundReceiptLines.id, receiptLineId))
      .limit(1)
      .for('update');
    if (!line) throw new NotFoundException('inbound line not found');
    return line;
  }

  /**
   * 회차 헤더를 `FOR NO KEY UPDATE` 로 잠근다 — 형제 라인 두 건이 동시에 취소될 때 둘 다
   * 「아직 남은 형제가 있다」고 읽어 voided 를 놓치는 경합을 직렬화한다.
   * `FOR UPDATE` 가 아니다: 적치·작업 로그 insert 의 FK `KEY SHARE` 와 교착한다(스펙 §7.1).
   */
  private async loadReceipt(receiptId: string, tx: DbTx): Promise<InboundReceipt> {
    const [receipt] = await tx
      .select()
      .from(wmsTables.inboundReceipts)
      .where(eq(wmsTables.inboundReceipts.id, receiptId))
      .limit(1)
      .for('no key update');
    if (!receipt) throw new NotFoundException('inbound receipt not found');
    return receipt;
  }

  /** 현행 적치와 같은 문구. 회송·취소는 non-null 단언으로 통과시켰으나 도달 불가 경로라 거절로 통일한다(계획서 Global Constraints 3). */
  private requireOrigin(line: InboundReceiptLine): string {
    if (!line.originLocationId) throw new BadRequestException('origin location missing');
    return line.originLocationId;
  }

  private async onHandAt(grain: { skuId: string; warehouseId: string; locationId: string }, tx: DbTx): Promise<number> {
    await acquireStockAvailabilityLocks(tx, [grain]);
    // Read all receipt/custody protection before releasing this line's pending quantity.
    const availability = await this.stockAvailability.getAvailability(
      {
        skuId: grain.skuId,
        warehouseId: grain.warehouseId,
        sourceLocationId: grain.locationId,
      },
      tx,
      { lock: true },
    );
    return availability.onHandQty;
  }
}
