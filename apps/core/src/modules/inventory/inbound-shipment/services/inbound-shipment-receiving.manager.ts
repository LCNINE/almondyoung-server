import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { BadRequestError, ConflictError } from '@app/shared';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import type { InboundShipment, InboundShipmentLine } from '../../schema/inventory.schema';
import { InboundReceiptKernel } from '../../inbound/kernel/inbound-receipt.kernel';
import { InventoryIdempotencyService } from '../../core/services/inventory-idempotency.service';
import { warehouseEndpoint, warehouseRequest } from '../../core/services/warehouse-operation-contract';
import { ProductSellableQuantityService } from '../../product-sellable-quantity/services/product-sellable-quantity.service';
import { AddInboundShipmentBoxResultDto, ReceiveBoxDto, ReceiveBoxResult } from '../dto/receive.dto';
import { lockInboundShipment, lockInboundShipmentBox } from './inbound-shipment-locks';
import { deriveShipmentStatus, normalizeSingleBoxLabel } from './inbound-shipment.rules';

/** 상자를 받거나 더할 수 있는 선적 상태 — 도착 예정·입고 중. */
const isOpen = (status: InboundShipment['status']): boolean => status === 'expected' || status === 'receiving';

/** 집계 한 행이 될 것 — 원장에 들어가면 `ledgerIndex` 가 커널 입력의 자리다. */
interface PlannedCount {
  lineId: string | null;
  skuId: string | null;
  countedQty: number;
  ledgerIndex: number | null;
}

/**
 * 상자 확정 — 센 만큼 입고 커널로 RECEIVE 한다 (spec §8.2·§8.7).
 *
 * 잠금 순서: 선적 행 → 상자 행(`FOR UPDATE`) → 커널(회차 라인·원장). 커널은 문서 행을 잠그지 않는다.
 * 한 상자의 확정은 멱등 키 하나로 한 번만 일어난다 — 같은 키 재시도는 같은 응답, 다른 키는 상자가
 * 이미 `received` 라 409.
 */
@Injectable()
export class InboundShipmentReceivingManager {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly kernel: InboundReceiptKernel,
    private readonly idempotency: InventoryIdempotencyService,
    private readonly productSellableQuantity: ProductSellableQuantityService,
  ) {}

  async receiveBox(
    shipmentId: string,
    boxId: string,
    dto: ReceiveBoxDto,
    actorId: string,
    tx?: DbTx,
  ): Promise<ReceiveBoxResult> {
    const endpoint = warehouseEndpoint('inbound_shipment.box.receive', dto);
    const request: ReceiveBoxDto & { shipmentId: string; boxId: string } = { shipmentId, boxId, ...dto };
    return this.idempotency.withIdempotency(
      endpoint,
      dto.idempotencyKey,
      warehouseRequest(request, actorId),
      async (trx) => {
        const shipment = await lockInboundShipment(trx, shipmentId);
        if (!isOpen(shipment.status))
          throw new ConflictError('확정된 선적(도착 예정·입고 중)의 상자만 받을 수 있습니다.');
        const box = await lockInboundShipmentBox(trx, shipmentId, boxId);
        if (box.status !== 'open') throw new ConflictError(`이미 확정된 상자입니다: ${box.label}`);
        if (box.disposition !== 'stock') throw new ConflictError(`전달용 상자는 확정하지 않습니다: ${box.label}`);

        const lines = await this.linesOfBox(trx, boxId);
        const planned = this.planLineCounts(dto, lines);
        await this.assertUnplannedValid(trx, dto);

        // 커널 입력: sku 줄의 0 보다 큰 수량(counts 순서) → 리스트에 없던 물건(unplanned 순서)
        const ledger: { skuId: string; quantity: number }[] = [];
        for (const p of planned) {
          if (p.skuId !== null && p.countedQty > 0) {
            p.ledgerIndex = ledger.length;
            ledger.push({ skuId: p.skuId, quantity: p.countedQty });
          }
        }
        for (const u of dto.unplanned) {
          planned.push({ lineId: null, skuId: u.skuId, countedQty: u.quantity, ledgerIndex: ledger.length });
          ledger.push({ skuId: u.skuId, quantity: u.quantity });
        }

        const arrival =
          ledger.length === 0
            ? null
            : await this.kernel.recordArrival(
                {
                  source: 'inbound_shipment',
                  actorId,
                  warehouseId: shipment.warehouseId,
                  locationId: null,
                  reason: 'inbound_shipment',
                  lines: ledger.map((l, index) => ({
                    skuId: l.skuId,
                    quantity: l.quantity,
                    eventKey: `${endpoint}:${dto.idempotencyKey}:${index}`,
                  })),
                },
                trx,
              );
        if (arrival && arrival.lines.length !== ledger.length) {
          throw new Error(`kernel returned ${arrival.lines.length} receipt lines for ${ledger.length} inputs`);
        }

        // 집계 id 는 미리 만든다 — RETURNING 행 순서에 기대지 않는다
        const countRows = planned.map((p) => ({
          id: randomUUID(),
          boxId,
          lineId: p.lineId,
          skuId: p.skuId,
          countedQty: p.countedQty,
          receiptLineId: arrival && p.ledgerIndex !== null ? arrival.lines[p.ledgerIndex].id : null,
          createdBy: actorId,
        }));
        if (countRows.length > 0) await trx.insert(wmsTables.inboundShipmentBoxCounts).values(countRows);
        const countIds = countRows.map((r) => r.id);

        const receiptId = arrival?.receipt.id ?? null;
        await trx
          .update(wmsTables.inboundShipmentBoxes)
          .set({
            status: 'received',
            receiptId,
            receivedAt: new Date(),
            receivedBy: actorId,
            version: sql`${wmsTables.inboundShipmentBoxes.version} + 1`,
          })
          .where(eq(wmsTables.inboundShipmentBoxes.id, boxId));

        const boxes = await trx
          .select({
            disposition: wmsTables.inboundShipmentBoxes.disposition,
            status: wmsTables.inboundShipmentBoxes.status,
          })
          .from(wmsTables.inboundShipmentBoxes)
          .where(eq(wmsTables.inboundShipmentBoxes.shipmentId, shipmentId));
        const shipmentStatus = deriveShipmentStatus(shipment.status, boxes, false);
        const now = new Date();
        await trx
          .update(wmsTables.inboundShipments)
          .set(
            shipmentStatus === 'closed'
              ? { status: shipmentStatus, closedAt: now, closedBy: actorId, closedReason: null, updatedAt: now }
              : { status: shipmentStatus, updatedAt: now },
          )
          .where(eq(wmsTables.inboundShipments.id, shipmentId));

        const receivedSkuIds = [...new Set(ledger.map((l) => l.skuId))];
        if (receivedSkuIds.length > 0) {
          await this.productSellableQuantity.recalculateAndPublishForSkus(receivedSkuIds, trx);
        }
        return { boxId, receiptId, shipmentStatus, countIds };
      },
      tx,
    );
  }

  /** 리스트에 없던 상자 — 줄 0개로 생기고 `unplanned` 로만 확정한다 (spec §8.7). */
  async addBox(
    shipmentId: string,
    label: string,
    _actorId: string,
    tx?: DbTx,
  ): Promise<AddInboundShipmentBoxResultDto> {
    const normalized = normalizeSingleBoxLabel(label);
    return this.dbService.run(async (trx: DbTx) => {
      const shipment = await lockInboundShipment(trx, shipmentId);
      if (!isOpen(shipment.status)) {
        throw new ConflictError('확정된 선적(도착 예정·입고 중)에만 상자를 더할 수 있습니다.');
      }
      const existing = await trx
        .select({ label: wmsTables.inboundShipmentBoxes.label, sortKey: wmsTables.inboundShipmentBoxes.sortKey })
        .from(wmsTables.inboundShipmentBoxes)
        .where(eq(wmsTables.inboundShipmentBoxes.shipmentId, shipmentId));
      if (existing.some((b) => b.label === normalized)) {
        throw new ConflictError(`이 선적에 이미 있는 상자입니다: ${normalized}`);
      }
      const sortKey = existing.reduce((m, b) => Math.max(m, b.sortKey), -1) + 1;
      const [box] = await trx
        .insert(wmsTables.inboundShipmentBoxes)
        .values({ shipmentId, label: normalized, sortKey, origin: 'added', disposition: 'stock' })
        .returning({ id: wmsTables.inboundShipmentBoxes.id, label: wmsTables.inboundShipmentBoxes.label });
      await trx
        .update(wmsTables.inboundShipments)
        .set({ updatedAt: new Date() })
        .where(eq(wmsTables.inboundShipments.id, shipmentId));
      return { boxId: box.id, label: box.label };
    }, tx);
  }

  private async linesOfBox(
    trx: DbTx,
    boxId: string,
  ): Promise<Pick<InboundShipmentLine, 'id' | 'kind' | 'skuId' | 'rowNumber'>[]> {
    return trx
      .select({
        id: wmsTables.inboundShipmentLines.id,
        kind: wmsTables.inboundShipmentLines.kind,
        skuId: wmsTables.inboundShipmentLines.skuId,
        rowNumber: wmsTables.inboundShipmentLines.rowNumber,
      })
      .from(wmsTables.inboundShipmentLineBoxes)
      .innerJoin(
        wmsTables.inboundShipmentLines,
        eq(wmsTables.inboundShipmentLines.id, wmsTables.inboundShipmentLineBoxes.lineId),
      )
      .where(eq(wmsTables.inboundShipmentLineBoxes.boxId, boxId));
  }

  /** `counts` 는 이 상자를 덮는 줄 전부를 정확히 한 번씩 — «안 셌다»와 «0개»를 가른다 (spec §8.2). */
  private planLineCounts(
    dto: ReceiveBoxDto,
    lines: Pick<InboundShipmentLine, 'id' | 'kind' | 'skuId' | 'rowNumber'>[],
  ): PlannedCount[] {
    const lineById = new Map(lines.map((l) => [l.id, l]));
    const seen = new Set<string>();
    const matched: { line: (typeof lines)[number]; countedQty: number }[] = [];
    // 1) 덮는 줄 전부를 정확히 한 번씩 — 400
    for (const c of dto.counts) {
      if (seen.has(c.lineId)) throw new BadRequestError(`같은 줄을 두 번 셌습니다: ${c.lineId}`);
      seen.add(c.lineId);
      const line = lineById.get(c.lineId);
      if (!line) throw new BadRequestError(`이 상자의 줄이 아닙니다: ${c.lineId}`);
      if (!Number.isInteger(c.countedQty) || c.countedQty < 0) {
        throw new BadRequestError('센 수량은 0 이상의 정수여야 합니다.');
      }
      matched.push({ line, countedQty: c.countedQty });
    }
    const missing = lines.filter((l) => !seen.has(l.id)).sort((a, b) => a.rowNumber - b.rowNumber);
    if (missing.length > 0) {
      throw new BadRequestError(`세지 않은 줄이 있습니다: ${missing.map((l) => `${l.rowNumber}행`).join(', ')}`);
    }
    // 2) 확정이 막았어야 할 미확인 줄 — 409 (방어선)
    const unresolved = matched.filter((m) => m.line.kind === 'unresolved');
    if (unresolved.length > 0) {
      throw new ConflictError(
        `상품이 정해지지 않은 줄은 받을 수 없습니다: ${unresolved.map((m) => `${m.line.rowNumber}행`).join(', ')}`,
      );
    }
    return matched.map(({ line, countedQty }) => ({
      lineId: line.id,
      skuId: line.kind === 'sku' ? line.skuId : null,
      countedQty,
      ledgerIndex: null,
    }));
  }

  private async assertUnplannedValid(trx: DbTx, dto: ReceiveBoxDto): Promise<void> {
    for (const u of dto.unplanned) {
      if (!Number.isInteger(u.quantity) || u.quantity <= 0) {
        throw new BadRequestError('리스트에 없던 물건의 수량은 1 이상의 정수여야 합니다.');
      }
    }
    const ids = [...new Set(dto.unplanned.map((u) => u.skuId))];
    if (ids.length === 0) return;
    const found = await trx
      .select({ id: wmsTables.skus.id })
      .from(wmsTables.skus)
      .where(inArray(wmsTables.skus.id, ids));
    if (found.length !== ids.length) {
      const known = new Set(found.map((f) => f.id));
      throw new BadRequestError(`존재하지 않는 SKU 입니다: ${ids.filter((id) => !known.has(id)).join(', ')}`);
    }
  }
}
