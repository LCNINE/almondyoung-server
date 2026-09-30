import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { BarcodeService } from '../../inventory/shared/services/barcode.service';
import {
  ReturnBinContentsDto,
  ReturnBinDto,
  ReturnBinItemDto,
  ReturnBinPutawayResponseDto,
} from '../dto/return-bin.dto';
import { BatchInventorySessionService, ReturnBinRef } from './batch-inventory-session.service';
import { FulfillmentCommandService } from './fulfillment-command.service';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { resolveSkuIdByBarcode } from './sku-barcode-resolution';

const RETURN_BIN_BARCODE = /^RB-[A-Za-z0-9._-]{1,125}$/;
const B = wmsTables.batchInventorySessionBalances;

/** 되돌림 바구니 바코드 — `RB-` 접두어로 토트·상품·로케이션과 갈린다(S1 §6.3, `ck_return_bins_barcode_prefix`). */
export function normalizeReturnBinBarcode(value: string): string {
  const barcode = value.trim();
  if (!RETURN_BIN_BARCODE.test(barcode)) {
    throw new BadRequestException(
      'Return bin barcode must start with RB- and use letters, digits, dots, underscores or hyphens',
    );
  }
  return barcode;
}

function binConflict(code: 'RETURN_BIN_UNKNOWN' | 'RETURN_BIN_WAREHOUSE_MISMATCH', message: string) {
  return new ConflictException({ code, message });
}

/**
 * 되돌림 바구니 — 등록·조회·되돌림 적치(스펙 §8). 바구니는 배치에 매이지 않는 상주 용기라 한 바구니에
 * 여러 배치(세션)의 물건이 섞인다. 그래서 조회·적치는 세션을 가로질러 `custody_ref = 바코드` 로 찾는다.
 */
@Injectable()
export class ReturnBinService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly commands: FulfillmentCommandService,
    private readonly workflowGate: FulfillmentWorkflowGate,
    private readonly sessions: BatchInventorySessionService,
    private readonly barcodes: BarcodeService,
    private readonly audit: AuditService,
  ) {}

  /** 같은 창고의 활성 바구니가 이미 있으면 그대로 돌려준다 — 여러 PC 가 같은 바구니를 «내 바구니» 로 지정할 수 있다. */
  async register(
    input: { warehouseId: string; barcode: string },
    actor: { id: string },
    tx?: DbTx,
  ): Promise<ReturnBinDto> {
    this.workflowGate.assertV2MutationAllowed('return_bin.register');
    const barcode = normalizeReturnBinBarcode(input.barcode);
    return this.dbService.run(async (trx) => {
      await trx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`return-bin:${barcode}`}, 0))`);
      const [existing] = await trx
        .select()
        .from(wmsTables.returnBins)
        .where(eq(wmsTables.returnBins.barcode, barcode))
        .limit(1);
      if (existing) {
        if (existing.retiredAt) throw binConflict('RETURN_BIN_UNKNOWN', `Return bin ${barcode} is retired`);
        if (existing.warehouseId !== input.warehouseId) {
          throw binConflict('RETURN_BIN_WAREHOUSE_MISMATCH', `Return bin ${barcode} belongs to another warehouse`);
        }
        return { id: existing.id, barcode: existing.barcode, warehouseId: existing.warehouseId };
      }
      const [warehouse] = await trx
        .select({ id: wmsTables.warehouses.id })
        .from(wmsTables.warehouses)
        .where(eq(wmsTables.warehouses.id, input.warehouseId))
        .limit(1);
      if (!warehouse) throw new NotFoundException(`Warehouse ${input.warehouseId} not found`);
      const [bin] = await trx
        .insert(wmsTables.returnBins)
        .values({ warehouseId: input.warehouseId, barcode, registeredBy: actor.id })
        .returning();
      await this.audit.logUserActionRequired(
        'return_bin.register',
        'fulfillment',
        `Registered return bin ${barcode}`,
        { userId: actor.id },
        { returnBinId: bin.id, warehouseId: input.warehouseId, barcode },
        trx,
      );
      return { id: bin.id, barcode: bin.barcode, warehouseId: bin.warehouseId };
    }, tx);
  }

  async lookup(barcodeInput: string, warehouseId: string, tx?: DbTx): Promise<ReturnBinContentsDto> {
    const barcode = barcodeInput.trim();
    return this.dbService.run(async (trx) => {
      const [bin] = await trx
        .select()
        .from(wmsTables.returnBins)
        .where(eq(wmsTables.returnBins.barcode, barcode))
        .limit(1);
      if (!bin || bin.retiredAt) {
        throw new NotFoundException({
          code: 'RETURN_BIN_UNKNOWN',
          error: 'RETURN_BIN_UNKNOWN',
          message: `Return bin ${barcode} is not registered`,
        });
      }
      if (bin.warehouseId !== warehouseId) {
        throw binConflict('RETURN_BIN_WAREHOUSE_MISMATCH', `Return bin ${barcode} belongs to another warehouse`);
      }
      const ref = { id: bin.id, barcode: bin.barcode };
      return { ...ref, warehouseId: bin.warehouseId, items: await this.contentsOf(ref, trx) };
    }, tx);
  }

  /** 명령용 — 오타·엉뚱한 바코드를 거절한다(스펙 §12 `RETURN_BIN_UNKNOWN`). */
  async requireActive(barcodeInput: string, warehouseId: string, trx: DbTx): Promise<ReturnBinRef> {
    const barcode = barcodeInput.trim();
    const [bin] = await trx
      .select()
      .from(wmsTables.returnBins)
      .where(eq(wmsTables.returnBins.barcode, barcode))
      .limit(1);
    if (!bin || bin.retiredAt) throw binConflict('RETURN_BIN_UNKNOWN', `Return bin ${barcode} is not registered`);
    if (bin.warehouseId !== warehouseId) {
      throw binConflict('RETURN_BIN_WAREHOUSE_MISMATCH', `Return bin ${barcode} belongs to another warehouse`);
    }
    return { id: bin.id, barcode: bin.barcode };
  }

  /** 바구니에 남은 물건 — 열린 세션(active·recovery_required)의 `RETURN_PENDING` 합을 SKU·원래 로케이션별로. */
  async contentsOf(bin: ReturnBinRef, trx: DbTx): Promise<ReturnBinItemDto[]> {
    const rows = await trx
      .select({
        skuId: B.skuId,
        skuCode: wmsTables.skus.code,
        skuName: wmsTables.skus.name,
        // RETURN_PENDING grain 은 source_location_id NOT NULL 이다(ck_batch_inventory_session_balances_custody).
        sourceLocationId: sql<string>`${B.sourceLocationId}`,
        locationCode: wmsTables.locations.code,
        qty: sql<number>`sum(${B.qty})::int`,
      })
      .from(B)
      .innerJoin(wmsTables.batchInventorySessions, eq(wmsTables.batchInventorySessions.id, B.sessionId))
      .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, B.skuId))
      .innerJoin(wmsTables.locations, eq(wmsTables.locations.id, B.sourceLocationId))
      .where(
        and(
          eq(B.custodyType, 'RETURN_PENDING'),
          eq(B.custodyRef, bin.barcode),
          gt(B.qty, 0),
          inArray(wmsTables.batchInventorySessions.status, ['active', 'recovery_required']),
        ),
      )
      .groupBy(B.skuId, wmsTables.skus.code, wmsTables.skus.name, B.sourceLocationId, wmsTables.locations.code)
      .orderBy(asc(wmsTables.locations.code), asc(wmsTables.skus.name));
    return rows.map((row) => ({ ...row, qty: Number(row.qty) }));
  }

  /**
   * 되돌림 적치(정한 것 8). 원래 로케이션만 받는다(S1 D12) — 원장상 그 물건은 그 로케이션을 떠난 적이 없으니 원장은 건드리지 않고
   * 세션 통제만 푼다. 한 바구니에 여러 배치의 물건이 섞이므로 세션 id 순으로 뺀다(잠금도 그 순서 — 작업 항목은 잡지 않는다).
   */
  async putaway(
    returnBinBarcode: string,
    input: { warehouseId: string; barcode: string; locationCode: string; quantity: number },
    actor: { id: string },
    idempotencyKey: string,
    tx?: DbTx,
  ): Promise<ReturnBinPutawayResponseDto> {
    this.workflowGate.assertV2MutationAllowed('return_bin.putaway');
    if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
      throw new BadRequestException('quantity must be a positive integer');
    }
    const barcode = input.barcode.trim();
    const locationCode = input.locationCode.trim();
    if (!barcode || !locationCode) throw new BadRequestException('barcode and locationCode are required');
    return this.commands.execute<ReturnBinPutawayResponseDto>(
      {
        commandType: 'return_bin.putaway',
        idempotencyKey,
        canonicalRequest: {
          returnBinBarcode: returnBinBarcode.trim(),
          warehouseId: input.warehouseId,
          barcode,
          locationCode,
          quantity: input.quantity,
          actorId: actor.id,
        },
      },
      async (trx, commandRequestId) => {
        const bin = await this.requireActive(returnBinBarcode, input.warehouseId, trx);
        const skuId = await resolveSkuIdByBarcode(this.barcodes, barcode, trx);
        if (!skuId) {
          throw new ConflictException({
            code: 'SIMPLE_OUTBOUND_BARCODE_UNKNOWN',
            message: 'Barcode does not resolve to a SKU',
          });
        }
        const pending = await trx
          .select({
            sessionId: B.sessionId,
            sessionStatus: wmsTables.batchInventorySessions.status,
            sourceLocationId: sql<string>`${B.sourceLocationId}`,
            locationCode: wmsTables.locations.code,
            qty: B.qty,
          })
          .from(B)
          .innerJoin(wmsTables.batchInventorySessions, eq(wmsTables.batchInventorySessions.id, B.sessionId))
          .innerJoin(wmsTables.locations, eq(wmsTables.locations.id, B.sourceLocationId))
          .where(
            and(
              eq(B.custodyType, 'RETURN_PENDING'),
              eq(B.custodyRef, bin.barcode),
              eq(B.skuId, skuId),
              gt(B.qty, 0),
              inArray(wmsTables.batchInventorySessions.status, ['active', 'recovery_required']),
            ),
          )
          .orderBy(asc(B.sessionId), asc(B.id));
        if (!pending.length) {
          throw new ConflictException({
            code: 'RETURN_BIN_ITEM_NOT_FOUND',
            message: `Return bin ${bin.barcode} holds no ${barcode}`,
          });
        }
        const atLocation = pending.filter((row) => row.locationCode === locationCode);
        if (!atLocation.length) {
          const expected = new Map<string, number>();
          for (const row of pending) expected.set(row.locationCode, (expected.get(row.locationCode) ?? 0) + row.qty);
          throw new ConflictException({
            code: 'RETURN_LOCATION_MISMATCH',
            message: `${barcode} in return bin ${bin.barcode} belongs to ${[...expected.keys()].join(', ')}`,
            errors: [...expected].map(([code, qty]) => ({ locationCode: code, qty })),
          });
        }
        const available = atLocation.reduce((total, row) => total + row.qty, 0);
        if (input.quantity > available) {
          throw new ConflictException({
            code: 'RETURN_BIN_ITEM_SHORT',
            message: `Return bin ${bin.barcode} holds only ${available} of ${barcode} for ${locationCode}`,
          });
        }
        let remaining = input.quantity;
        for (const row of atLocation) {
          if (remaining === 0) break;
          if (row.sessionStatus !== 'active') {
            throw new ConflictException({
              code: 'PICKING_SESSION_NOT_ACTIVE',
              message: `Inventory session ${row.sessionId} is ${row.sessionStatus}`,
            });
          }
          const qty = Math.min(remaining, row.qty);
          await this.sessions.putawayReturn(
            {
              sessionId: row.sessionId,
              operationId: commandRequestId,
              actorId: actor.id,
              skuId,
              sourceLocationId: row.sourceLocationId,
              quantity: qty,
              returnBin: bin,
            },
            trx,
          );
          remaining -= qty;
        }
        await this.audit.logUserActionRequired(
          'return_bin.putaway',
          'fulfillment',
          `Put away ${input.quantity} of ${barcode} from return bin ${bin.barcode} to ${locationCode}`,
          { userId: actor.id },
          { commandRequestId, returnBinId: bin.id, skuId, locationCode, quantity: input.quantity },
          trx,
        );
        const response: ReturnBinPutawayResponseDto = {
          returnBin: { ...bin, warehouseId: input.warehouseId },
          putAwayQty: input.quantity,
          items: await this.contentsOf(bin, trx),
        };
        return { response, resourceType: 'return_bin', resourceId: bin.id };
      },
      tx,
    );
  }
}
