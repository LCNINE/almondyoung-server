import { BadRequestException, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { DEMO_LOGISTICS_FIXTURE as fixture } from '@app/shared/demo-logistics.fixture';
import { InboundService } from '../inventory/inbound/services/inbound.service';
import { InventoryIdempotencyService } from '../inventory/core/services/inventory-idempotency.service';
import { DemandProfileRefresher } from '../inventory/replenishment/demand/demand-profile.refresher';
import { ReplenishmentSettingsReader } from '../inventory/replenishment/demand/replenishment-settings.reader';
import { kstDateOf } from '../inventory/replenishment/demand/calendar';

const requestSchema = z.object({
  requestId: z.string().uuid(),
  items: z
    .array(z.object({ skuId: z.string().uuid(), quantity: z.number().int().min(1).max(1000) }))
    .min(1)
    .max(50)
    .refine((items) => new Set(items.map((item) => item.skuId)).size === items.length)
    .transform((items) => [...items].sort((a, b) => a.skuId.localeCompare(b.skuId))),
  prepareDemand: z.boolean().default(false),
});
export function parsePracticeRequest(body: unknown) {
  const result = requestSchema.safeParse(body);
  if (!result.success)
    throw new BadRequestException('실습 상품은 중복 없이 1~50개, 수량은 각각 1~1,000개로 선택해 주세요.');
  return result.data;
}
export type PracticeRequest = ReturnType<typeof parsePracticeRequest>;

@Injectable()
export class DemoPracticeService {
  constructor(
    private readonly inbound: InboundService,
    private readonly idempotency: InventoryIdempotencyService,
    private readonly profiles: DemandProfileRefresher,
    private readonly settings: ReplenishmentSettingsReader,
  ) {}

  async prepare(request: PracticeRequest, actorId: string) {
    const today = kstDateOf(new Date());
    const warehouseId = fixture.warehouses[0].id;
    const locationId = fixture.locations[2].id;
    const result = await this.idempotency.withIdempotency(
      'demo.practice.v1',
      request.requestId,
      { ...request, actorId },
      async (tx) => {
        const ids = sql.join(
          request.items.map((item) => sql`${item.skuId}::uuid`),
          sql`, `,
        );
        const selected = await tx.execute<{ id: string; name: string; code: string }>(sql`
          SELECT id, name, code FROM skus WHERE id IN (${ids}) AND NOT is_deleted AND stock_type = 'physical'
        `);
        if (selected.length !== request.items.length)
          throw new BadRequestException('삭제되지 않은 물리 SKU만 실습할 수 있습니다.');
        const receipt = await this.inbound.simpleInbound(
          {
            warehouseId,
            items: request.items.map((item) => ({ ...item, memo: 'Demo 자유 실습 보충' })),
            contractVersion: 2,
            idempotencyKey: `demo:${request.requestId}:receive`,
          },
          tx,
          actorId,
        );
        for (const line of receipt.lines) {
          await this.inbound.putawayFromOrigin(
            {
              lineId: line.id,
              toLocationId: locationId,
              quantity: line.quantity,
              contractVersion: 2,
              idempotencyKey: `demo:${request.requestId}:putaway:${line.skuId}`,
            },
            tx,
            actorId,
          );
        }
        if (request.prepareDemand) {
          // Only the selected training SKUs receive synthetic history; never erase existing demand.
          await tx.execute(sql`
            INSERT INTO sku_demand_daily (sku_id, demand_date, qty, amount, source)
            SELECT s.id, d::date, 2 + (extract(doy from d)::int % 3),
              (2 + (extract(doy from d)::int % 3)) * 10000, 'sellmate'
            FROM skus s CROSS JOIN generate_series(${today}::date - interval '365 days', ${today}::date - interval '1 day', interval '1 day') d
            WHERE s.id IN (${ids})
            ON CONFLICT (sku_id, demand_date) DO NOTHING
          `);
          await this.profiles.refreshSelected(
            { today, settings: await this.settings.read(tx), skuIds: request.items.map((item) => item.skuId) },
            tx,
          );
        }
        const barcodes = await tx.execute<{ skuId: string; barcode: string; packingUnit: number }>(sql`
          SELECT sku_id AS "skuId", barcode, packing_unit AS "packingUnit" FROM sku_barcodes
          WHERE sku_id IN (${ids}) ORDER BY sku_id, is_primary DESC, barcode
        `);
        return {
          requestId: request.requestId,
          receiptId: receipt.receipt.id,
          warehouseId,
          locationId,
          warehouseName: fixture.warehouses[0].name,
          locationCode: fixture.locations[2].code,
          lines: receipt.lines.map((line) => ({
            receiptLineId: line.id,
            skuId: line.skuId,
            quantity: line.quantity,
            name: selected.find((item) => item.id === line.skuId)?.name,
            sku: selected.find((item) => item.id === line.skuId)?.code,
          })),
          barcodes,
          demandPrepared: request.prepareDemand,
        };
      },
    );
    return result;
  }
}
