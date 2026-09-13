import { BadRequestException, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../schema/inventory.schema';
import type { InboundReceipt, InboundReceiptLine } from '../../schema/inventory.schema';
import { InventoryCommandService } from '../../core/services/inventory-command.service';
import { LocationService } from '../../core/services/location.service';
import { StockEventStore } from '../../core/repositories/stock-event.store';

export type DirectArrivalMethod = 'simple' | 'simple_fullscan' | 'individual';

export interface ArrivalLineInput {
  skuId: string;
  quantity: number;
  memo?: string;
  /** 원장 이벤트 멱등 키. 호출자가 현행 문자열을 그대로 넘긴다 — 커널은 가공하지 않는다. */
  eventKey: string;
}

export interface RecordArrivalInput {
  source: 'direct';
  method: DirectArrivalMethod;
  warehouseId: string;
  /** 비우면 입고기본존. 지정값은 검증하지 않는다(현행 개별입고와 같다). */
  locationId?: string | null;
  /** 원장 이벤트와 작업 로그의 reason. */
  reason: string;
  lines: ArrivalLineInput[];
}

export interface RecordArrivalResult {
  receipt: InboundReceipt;
  lines: InboundReceiptLine[];
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
 * 원장만 잠그고 문서 행을 절대 잠그지 않는다 — 역방향 간선이 없으므로 교착 사이클이 생기지 않는다(스펙 §7.1).
 *
 * 예외는 현행 Nest 예외와 메시지를 글자 그대로 옮긴다 — 응답 `error` 필드 보존(계획서 Global Constraints).
 */
@Injectable()
export class InboundReceiptKernel {
  constructor(
    private readonly command: InventoryCommandService,
    private readonly location: LocationService,
    private readonly eventStore: StockEventStore,
  ) {}

  /** 도착 한 번 = 저널 1 · 회차 1 · 라인 N · RECEIVE 이벤트 N · 작업 로그 1. */
  async recordArrival(input: RecordArrivalInput, tx: DbTx): Promise<RecordArrivalResult> {
    const locationId = await this.resolveLocation(input.warehouseId, input.locationId ?? null, tx);

    const [journal] = await tx.insert(wmsTables.stockJournals).values({ sourceType: 'inbound' }).returning();

    const [receipt] = await tx
      .insert(wmsTables.inboundReceipts)
      .values({
        method: input.method,
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
      method: input.method,
      reason: input.reason,
    });

    return { receipt: updatedReceipt, lines };
  }

  private async resolveLocation(warehouseId: string, locationId: string | null, tx: DbTx): Promise<string> {
    if (locationId) return locationId;
    await this.location.ensureSystemLocations(warehouseId, tx);
    const inboundZone = await this.location.getSystemLocationByRole(warehouseId, 'inbound_default', tx);
    if (!inboundZone) throw new BadRequestException('입고 기본존이 존재하지 않습니다.');
    return inboundZone.id;
  }
}
