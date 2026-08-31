import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AnyTx, DbService, InjectTypedDb, TxFor } from '@app/db';
import { PaginatedResponseDto } from '@app/shared/dto';
import { MergedSchema } from '../../../../platform/database/merged-schema';
import {
  productMasters,
  productMasterVariants,
  productMasterVersions,
} from '../../../catalog/schema/catalog.schema';
import { wmsTables } from '../../schema/inventory.schema';
import { SOLD_OUT_REASONS } from '../../product-sellable-quantity/services/product-sellable-quantity.service';
import {
  GetStockValuationProductsQueryDto,
  SkuCostStatus,
  StockValuationProductDto,
  StockValuationSummaryDto,
} from '../dto/stock-valuation.dto';

type MergedTx = TxFor<MergedSchema>;

type StockState = 'ON_HAND' | 'DEFECTIVE' | 'IN_TRANSFER';

export interface SkuCost {
  status: SkuCostStatus;
  /** 단일 상품에 귀속 가능할 때만 (valued/costMissing/costConflict) */
  masterId?: string;
  masterName?: string | null;
  /** valued 일 때만. SKU 1단위 원가 (세트는 공급가 ÷ 구성수량) */
  unitCost?: number;
  /**
   * multiMaster 일 때만. 이 SKU 가 걸쳐 있는 상품들.
   * 금액은 어느 쪽에도 귀속할 수 없지만, 재고가 있다는 사실 자체는 상품별로 알려야 한다 —
   * 안 그러면 화면이 "재고 없음"으로 단정한다.
   */
  sharedMasters?: Array<{ masterId: string; name: string | null }>;
}

export interface SkuCostCandidate {
  masterId: string;
  name: string | null;
  supplyPrice: number | null;
  linkQuantity: number;
}

/** SKU 하나의 원가 판정 — 규칙은 파일 상단 doc 참조. 순수 함수라 유닛 테스트가 이걸 고정한다. */
export function classifySkuCost(candidates: SkuCostCandidate[]): SkuCost {
  const usable = candidates.filter((candidate) => candidate.linkQuantity > 0);
  if (usable.length === 0) {
    return { status: 'unmatched' };
  }

  const masterIds = new Set(usable.map((candidate) => candidate.masterId));
  if (masterIds.size > 1) {
    const byMaster = new Map(usable.map((candidate) => [candidate.masterId, candidate.name]));
    return {
      status: 'multiMaster',
      sharedMasters: [...byMaster].map(([masterId, name]) => ({ masterId, name })),
    };
  }

  const { masterId, name } = usable[0];
  const unitCosts = new Set(
    usable
      .filter((candidate) => candidate.supplyPrice !== null)
      // 부동소수 오차로 같은 값이 다르게 비교되지 않게 소수 4자리에서 자른다
      .map((candidate) => Math.round(((candidate.supplyPrice ?? 0) / candidate.linkQuantity) * 10000) / 10000),
  );
  if (unitCosts.size === 0) {
    return { status: 'costMissing', masterId, masterName: name };
  }
  if (unitCosts.size > 1) {
    return { status: 'costConflict', masterId, masterName: name };
  }
  return { status: 'valued', masterId, masterName: name, unitCost: [...unitCosts][0] };
}

/**
 * 재고 금액(묶인 돈) 읽기 전용 통계. 재고 grain(SKU)과 원가 grain(master active 버전의
 * supply_price)이 달라 링크 경로(sku ← link ← matching ← variant ← active version)로 잇는다.
 *
 * 원가 판정 규칙 — 판정 불가는 0으로 뭉개지 않고 사유별로 분리한다:
 * - valued: 단일 상품 귀속 + 단위 원가 하나로 결정 (세트는 공급가 ÷ 구성수량)
 * - costMissing: 연결은 되나 active 버전 supply_price 가 NULL
 * - costConflict: 같은 상품인데 링크 간 단위 원가가 상충
 * - multiMaster: SKU 가 서로 다른 상품 여럿에 연결 — 귀속 자체가 불가
 * - unmatched: active 버전까지 닿는 연결이 없음
 */
@Injectable()
export class StockValuationReader {
  constructor(
    @InjectTypedDb<MergedSchema>()
    private readonly dbService: DbService<MergedSchema>,
  ) {}

  async getSummary(tx?: AnyTx): Promise<StockValuationSummaryDto> {
    return this.dbService.run(async (trx) => {
      const { ledgerRows, skuCosts } = await this.loadValuation(trx);

      const stateAgg = new Map<StockState, { quantity: number; value: number; uncostedQuantity: number }>();
      for (const state of ['ON_HAND', 'DEFECTIVE', 'IN_TRANSFER'] as const) {
        stateAgg.set(state, { quantity: 0, value: 0, uncostedQuantity: 0 });
      }
      const warehouseAgg = new Map<string, { onHandQuantity: number; onHandValue: number; uncostedQuantity: number }>();
      const buckets: Record<Exclude<SkuCostStatus, 'valued'>, { skuIds: Set<string>; onHandQuantity: number }> = {
        costMissing: { skuIds: new Set(), onHandQuantity: 0 },
        costConflict: { skuIds: new Set(), onHandQuantity: 0 },
        multiMaster: { skuIds: new Set(), onHandQuantity: 0 },
        unmatched: { skuIds: new Set(), onHandQuantity: 0 },
      };

      for (const row of ledgerRows) {
        const cost = skuCosts.get(row.skuId);
        const valued = cost?.status === 'valued';
        const value = valued ? Math.round(row.qty * (cost.unitCost ?? 0)) : 0;

        const state = stateAgg.get(row.stockState);
        if (state) {
          state.quantity += row.qty;
          state.value += value;
          if (!valued) state.uncostedQuantity += row.qty;
        }

        if (row.stockState === 'ON_HAND') {
          const wh = warehouseAgg.get(row.warehouseId) ?? { onHandQuantity: 0, onHandValue: 0, uncostedQuantity: 0 };
          wh.onHandQuantity += row.qty;
          wh.onHandValue += value;
          if (!valued) wh.uncostedQuantity += row.qty;
          warehouseAgg.set(row.warehouseId, wh);

          if (cost && cost.status !== 'valued') {
            buckets[cost.status].skuIds.add(row.skuId);
            buckets[cost.status].onHandQuantity += row.qty;
          }
        }
      }
      // ON_HAND 재고가 없는 판정 불가 SKU(불량·이동중만 보유)도 SKU 수에는 잡는다
      for (const [skuId, cost] of skuCosts) {
        if (cost.status !== 'valued') buckets[cost.status].skuIds.add(skuId);
      }

      const proj = wmsTables.productSellableQuantityProjections;
      const [warehouseRows, [soldOut]] = await Promise.all([
        trx
          .select({
            id: wmsTables.warehouses.id,
            name: wmsTables.warehouses.name,
            isSellable: wmsTables.warehouses.isSellable,
          })
          .from(wmsTables.warehouses),
        trx
          .select({ count: sql<number>`count(distinct ${proj.masterId})::int` })
          .from(proj)
          .where(inArray(proj.reason, [...SOLD_OUT_REASONS])),
      ]);
      const warehouseById = new Map(warehouseRows.map((w) => [w.id, w]));

      const onHand = stateAgg.get('ON_HAND') ?? { quantity: 0, value: 0, uncostedQuantity: 0 };

      return {
        onHandValue: onHand.value,
        onHandQuantity: onHand.quantity,
        stockedSkuCount: new Set(ledgerRows.map((row) => row.skuId)).size,
        states: [...stateAgg.entries()].map(([state, agg]) => ({ state, ...agg })),
        warehouses: [...warehouseAgg.entries()]
          .map(([warehouseId, agg]) => ({
            warehouseId,
            warehouseName: warehouseById.get(warehouseId)?.name ?? '',
            isSellable: warehouseById.get(warehouseId)?.isSellable ?? false,
            ...agg,
          }))
          .sort((a, b) => b.onHandValue - a.onHandValue),
        costMissing: this.toBucket(buckets.costMissing),
        costConflict: this.toBucket(buckets.costConflict),
        multiMaster: this.toBucket(buckets.multiMaster),
        unmatched: this.toBucket(buckets.unmatched),
        soldOutMasterCount: Number(soldOut?.count ?? 0),
        generatedAt: new Date().toISOString(),
      };
    }, tx as MergedTx | undefined);
  }

  async getProducts(
    query: GetStockValuationProductsQueryDto,
    tx?: AnyTx,
  ): Promise<PaginatedResponseDto<StockValuationProductDto>> {
    const { page = 1, limit = 50, sort = 'value', order = 'desc' } = query;
    const masterIdFilter = query.masterIds
      ?.split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    return this.dbService.run(async (trx) => {
      const { ledgerRows, skuCosts } = await this.loadValuation(trx);

      const byMaster = new Map<string, StockValuationProductDto>();
      const ensureItem = (masterId: string, name: string | null): StockValuationProductDto => {
        const existing = byMaster.get(masterId);
        if (existing) {
          existing.name ??= name;
          return existing;
        }
        const created: StockValuationProductDto = {
          masterId,
          name,
          skuCount: 0,
          onHandQuantity: 0,
          onHandValue: 0,
          hasUncostedSku: false,
          unattributedSkuCount: 0,
          unattributedQuantity: 0,
        };
        byMaster.set(masterId, created);
        return created;
      };
      const countedSkus = new Set<string>();
      const countedSharedSkus = new Set<string>();
      for (const row of ledgerRows) {
        if (row.stockState !== 'ON_HAND') continue;
        const cost = skuCosts.get(row.skuId);
        if (!cost) continue;

        if (!cost.masterId) {
          // 귀속 불가. multiMaster 는 걸쳐 있는 상품마다 '재고는 있으나 귀속 불가'로 남긴다 —
          // 금액에 더하지 않고 별도 필드로만 센다(상품 간 중복 계상이라 합산 금지).
          // unmatched 는 상품을 특정할 수 없어 summary 버킷에서만 보인다.
          for (const shared of cost.sharedMasters ?? []) {
            const item = ensureItem(shared.masterId, shared.name);
            const key = `${shared.masterId}:${row.skuId}`;
            if (!countedSharedSkus.has(key)) {
              countedSharedSkus.add(key);
              item.unattributedSkuCount += 1;
            }
            item.unattributedQuantity += row.qty;
          }
          continue;
        }

        const item = ensureItem(cost.masterId, cost.masterName ?? null);
        if (!countedSkus.has(row.skuId)) {
          countedSkus.add(row.skuId);
          item.skuCount += 1;
        }
        item.onHandQuantity += row.qty;
        if (cost.status === 'valued') {
          item.onHandValue += Math.round(row.qty * (cost.unitCost ?? 0));
        } else {
          item.hasUncostedSku = true;
        }
      }

      let items = [...byMaster.values()];
      if (masterIdFilter && masterIdFilter.length > 0) {
        const wanted = new Set(masterIdFilter);
        items = items.filter((item) => wanted.has(item.masterId));
      }

      const dir = order === 'asc' ? 1 : -1;
      items.sort((a, b) => {
        const key = sort === 'quantity' ? a.onHandQuantity - b.onHandQuantity : a.onHandValue - b.onHandValue;
        return key !== 0 ? key * dir : a.masterId.localeCompare(b.masterId);
      });

      return {
        data: items.slice((page - 1) * limit, page * limit),
        total: items.length,
        page,
        limit,
      };
    }, tx as MergedTx | undefined);
  }

  private toBucket(bucket: { skuIds: Set<string>; onHandQuantity: number }) {
    return { skuCount: bucket.skuIds.size, onHandQuantity: bucket.onHandQuantity };
  }

  private async loadValuation(trx: MergedTx): Promise<{
    ledgerRows: Array<{ skuId: string; warehouseId: string; stockState: StockState; qty: number }>;
    skuCosts: Map<string, SkuCost>;
  }> {
    const ledger = wmsTables.stockLedgers;
    const ledgerRows = await trx
      .select({
        skuId: ledger.skuId,
        warehouseId: ledger.warehouseId,
        stockState: ledger.stockState,
        qty: sql<number>`SUM(${ledger.qty})::int`,
      })
      .from(ledger)
      .groupBy(ledger.skuId, ledger.warehouseId, ledger.stockState)
      .having(sql`SUM(${ledger.qty}) > 0`);

    const skuIds = [...new Set(ledgerRows.map((row) => row.skuId))];
    const skuCosts = new Map<string, SkuCost>();
    if (skuIds.length === 0) {
      return { ledgerRows, skuCosts };
    }

    // 재고가 있는 SKU 집합. id 를 JS 로 꺼내 `inArray` 로 되묻지 않고 서브쿼리로 남긴다 —
    // 왕복이 줄고, 바인드 파라미터 상한(65,535)에 SKU 수가 부딪히는 절벽도 사라진다.
    const stockedGroups = trx
      .select({ skuId: ledger.skuId })
      .from(ledger)
      .groupBy(ledger.skuId, ledger.warehouseId, ledger.stockState)
      .having(sql`SUM(${ledger.qty}) > 0`)
      .as('stocked_groups');
    const stocked = trx.selectDistinct({ skuId: stockedGroups.skuId }).from(stockedGroups).as('stocked');

    // variant 당 최신 active 버전 하나 — product-sellable-quantity 와 같은 판정.
    // 옛 구현이 (updatedAt desc, createdAt desc) 로 받아 variant 별 첫 행만 남긴 것과 같다.
    const activeVersions = trx
      .selectDistinctOn([productMasterVariants.variantId], {
        variantId: productMasterVariants.variantId,
        masterId: productMasterVariants.masterId,
        name: productMasterVersions.name,
        supplyPrice: productMasterVersions.supplyPrice,
      })
      .from(productMasterVariants)
      .innerJoin(productMasterVersions, eq(productMasterVariants.versionId, productMasterVersions.id))
      .innerJoin(productMasters, eq(productMasterVariants.masterId, productMasters.id))
      .where(
        and(
          eq(productMasterVersions.status, 'active'),
          isNull(productMasterVersions.deletedAt),
          isNull(productMasters.deletedAt),
        ),
      )
      .orderBy(
        productMasterVariants.variantId,
        desc(productMasterVersions.updatedAt),
        desc(productMasterVersions.createdAt),
      )
      .as('active_versions');

    // 링크 경로(sku ← link ← matching ← variant ← active version)를 한 번의 조인으로 잇는다.
    // 옛 구현이 중간 id 를 왕복시키며 걸러내던 것(매칭 없음·active 버전 없음)은 innerJoin 이 한다.
    const candidateRows = await trx
      .select({
        skuId: wmsTables.productVariantSkuLinks.skuId,
        masterId: activeVersions.masterId,
        name: activeVersions.name,
        supplyPrice: activeVersions.supplyPrice,
        linkQuantity: wmsTables.productVariantSkuLinks.quantity,
      })
      .from(wmsTables.productVariantSkuLinks)
      .innerJoin(stocked, eq(stocked.skuId, wmsTables.productVariantSkuLinks.skuId))
      .innerJoin(
        wmsTables.productMatchings,
        eq(wmsTables.productMatchings.id, wmsTables.productVariantSkuLinks.productMatchingId),
      )
      .innerJoin(activeVersions, eq(activeVersions.variantId, wmsTables.productMatchings.variantId));

    const candidatesBySku = new Map<string, SkuCostCandidate[]>();
    for (const row of candidateRows) {
      const candidates = candidatesBySku.get(row.skuId) ?? [];
      candidates.push({
        masterId: row.masterId,
        name: row.name,
        supplyPrice: row.supplyPrice,
        linkQuantity: row.linkQuantity,
      });
      candidatesBySku.set(row.skuId, candidates);
    }

    // 후보가 하나도 없는 SKU 도 'unmatched' 로 남아야 하므로 원장의 SKU 전부를 돈다.
    for (const skuId of skuIds) {
      skuCosts.set(skuId, classifySkuCost(candidatesBySku.get(skuId) ?? []));
    }

    return { ledgerRows, skuCosts };
  }
}
