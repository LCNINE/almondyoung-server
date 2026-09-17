import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { sql } from 'drizzle-orm';
import { BadRequestError } from '@app/shared';
import { isSafeDemoEnvironment } from '../../config/demo-stage.config';
import { InventoryIdempotencyService } from '../inventory/core/services/inventory-idempotency.service';
import { DemandProfileRefresher } from '../inventory/replenishment/demand/demand-profile.refresher';
import { ReplenishmentSettingsReader } from '../inventory/replenishment/demand/replenishment-settings.reader';
import { ReplenishmentSuggestionService } from '../inventory/replenishment/suggestion/replenishment-suggestion.service';
import { addDays, kstDateOf } from '../inventory/replenishment/demand/calendar';
import { wmsTables } from '../inventory/schema/inventory.schema';
import { DemoReplenishmentRequest } from './demo-replenishment.input';

class UnsuitableCandidate extends Error {}

@Injectable()
export class DemoReplenishmentManager {
  constructor(
    private readonly idempotency: InventoryIdempotencyService,
    private readonly profiles: DemandProfileRefresher,
    private readonly settings: ReplenishmentSettingsReader,
    private readonly suggestions: ReplenishmentSuggestionService,
  ) {}

  async prepare(request: DemoReplenishmentRequest, actorId: string) {
    if (!isSafeDemoEnvironment()) throw new BadRequestError('시연 환경에서만 사용할 수 있습니다.');
    return this.idempotency.withIdempotency(
      'demo.replenishment.v1',
      request.requestId,
      { ...request, actorId },
      async (tx) => {
        // Serialize new selections; replay is resolved by the existing idempotency boundary first.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('demo.replenishment.selection.v1'))`);
        const count = request.mode === 'random' ? request.count : request.skuIds.length;
        const candidateIds = request.mode === 'specified' ? request.skuIds : undefined;
        const limit = request.mode === 'random' ? count * 3 : count;
        const locked = await tx.execute<{ id: string }>(candidateQuery(request.requestId, limit, candidateIds, true));
        // A fresh statement after taking FK-conflicting row locks observes work that committed
        // during selection. New dependent inserts must wait until this transaction completes.
        const candidates = locked.length
          ? await tx.execute<{ id: string }>(
              candidateQuery(
                request.requestId,
                limit,
                locked.map((row) => row.id),
                false,
              ),
            )
          : [];
        if (candidates.length < count)
          throw new BadRequestError(
            '사용 가능한 새 상품이 부족합니다. 기존 수요·재고·거래 이력이 없는 실제 상품을 선택하거나 상품 수를 줄여 주세요.',
          );
        const today = kstDateOf(new Date());
        const settings = await this.settings.read(tx);
        const items: Array<{
          skuId: string;
          skuCode: string;
          skuName: string;
          pattern: string;
          dailyMean: number;
          onHand: number;
          onOrder: number;
          reorderPoint: number;
          purchaseQuantity: number;
          supplierName: string;
        }> = [];
        for (const candidate of candidates) {
          if (items.length === count) break;
          try {
            const item = await tx.transaction(async (child) => {
              const seed = createHash('sha256').update(`${request.requestId}:${candidate.id}`).digest();
              const scale = 1 + (seed[0] % 4);
              const pattern = items.length % 3;
              const points = Array.from({ length: 365 }, (_, i) => {
                const noise = createHash('sha256').update(`${request.requestId}:${candidate.id}:${i}`).digest()[0];
                const qty =
                  pattern === 0
                    ? scale + (noise % 3)
                    : pattern === 1
                      ? noise % 5 === 0
                        ? scale * 10
                        : 1
                      : i % (3 + (seed[1] % 4)) === 0
                        ? scale + (noise % 3)
                        : 0;
                // The legacy source enum has only sellmate/core. Imported history survives the core
                // rebuild; provenance is explicitly recorded below instead of claiming live sales.
                return {
                  skuId: candidate.id,
                  demandDate: addDays(today, i - 365),
                  qty,
                  amount: qty * 10000,
                  source: 'sellmate' as const,
                };
              });
              await child.insert(wmsTables.skuDemandDaily).values(points);
              await child.insert(wmsTables.replenishmentSkuOverrides).values({
                skuId: candidate.id,
                mode: 'auto',
                memo: `시연용 합성 수요 · ${request.requestId} · 실제 판매 이력 아님`,
                updatedBy: actorId,
              });
              await this.profiles.refreshSelected({ today, settings, skuIds: [candidate.id] }, child);
              const detail = await this.suggestions.getSku(candidate.id, child);
              const purchase = detail.actions.find((a) => a.type === 'purchase');
              if (
                detail.parameters.excluded ||
                !purchase?.supplierId ||
                !purchase.sourceWarehouseId ||
                purchase.qty < 1 ||
                purchase.qty > 1000
              )
                throw new UnsuitableCandidate();
              return {
                skuId: candidate.id,
                skuCode: detail.skuCode,
                skuName: detail.skuName,
                pattern: detail.pattern,
                dailyMean: detail.demand.dailyMean,
                onHand: detail.company.onHand,
                onOrder: detail.company.onOrder,
                reorderPoint: detail.company.reorderPoint,
                purchaseQuantity: purchase.qty,
                supplierName: detail.supplier?.name ?? '',
              };
            });
            items.push(item);
          } catch (error) {
            if (!(error instanceof UnsuitableCandidate)) throw error;
          }
        }
        if (items.length !== count)
          throw new BadRequestError(
            '선택한 상품으로 1~1,000개 범위의 발주 제안을 만들 수 없습니다. 다른 상품을 선택하거나 상품 수를 줄여 주세요. 데이터는 변경되지 않았습니다.',
          );
        return {
          requestId: request.requestId,
          synthetic: true,
          createdAt: new Date().toISOString(),
          historyDays: 365,
          items,
        };
      },
    );
  }
}

/** Materialize used SKU IDs once. Correlated anti-joins can rescan the complete demand
 * history per SKU when the planner underestimates catalog cardinality (40k demo catalog).
 */
function candidateQuery(seed: string, limit: number, ids: string[] | undefined, lock: boolean) {
  const selection = ids
    ? sql`AND s.id IN (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`
    : sql``;
  return sql`
    WITH used_skus AS MATERIALIZED (
      SELECT sku_id FROM sku_demand_daily
      UNION SELECT sku_id FROM sku_demand_profiles WHERE daily_mean>0
      UNION SELECT sku_id FROM replenishment_sku_overrides
      UNION SELECT sku_id FROM stock_ledgers WHERE qty<>0
      UNION SELECT sku_id FROM stock_events
      UNION SELECT sku_id FROM stock_reservations
      UNION SELECT sku_id FROM purchase_order_lines
      UNION SELECT sku_id FROM transfer_order_lines
      UNION SELECT sku_id FROM purchase_order_cart
      UNION SELECT k.sku_id FROM product_variant_sku_links k
        JOIN product_matchings m ON m.id=k.product_matching_id
        JOIN sales_order_lines l ON l.variant_id=m.variant_id
    )
    SELECT s.id FROM skus s
    WHERE NOT s.is_deleted AND s.stock_type='physical'
      AND s.code NOT LIKE 'DEMO-SKU-%' AND s.id::text NOT LIKE '019f1004-%'
      AND COALESCE(s.moq,1) BETWEEN 1 AND 500
      AND (SELECT count(*) FROM sku_suppliers p WHERE p.sku_id=s.id)=1
      AND EXISTS (SELECT 1 FROM sku_suppliers p JOIN suppliers v ON v.id=p.supplier_id WHERE p.sku_id=s.id AND v.default_warehouse_id IS NOT NULL)
      AND EXISTS (SELECT 1 FROM sku_barcodes b WHERE b.sku_id=s.id)
      AND NOT EXISTS (SELECT 1 FROM sku_barcodes b WHERE b.sku_id=s.id AND b.is_primary AND COALESCE(b.packing_unit,1) NOT BETWEEN 1 AND 500)
      AND s.id NOT IN (SELECT sku_id FROM used_skus WHERE sku_id IS NOT NULL)
      ${selection}
    ORDER BY md5(s.id::text || ${seed}) LIMIT ${limit}
    ${lock ? sql`FOR UPDATE OF s SKIP LOCKED` : sql``}
  `;
}
