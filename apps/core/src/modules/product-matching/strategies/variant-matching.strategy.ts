import { Injectable } from '@nestjs/common';
import { MatchingStrategy, MatchingContext, SkuQuantityMapping } from './matching-strategy.interface';
import { eq, inArray } from 'drizzle-orm';
import { wmsTables, DbTx } from '../../inventory/schema/inventory.schema';

@Injectable()
export class VariantMatchingStrategy extends MatchingStrategy {
  async lookup(context: MatchingContext): Promise<SkuQuantityMapping[]> {
    const links = await this.db.query.productVariantSkuLinks.findMany({
      where: eq(wmsTables.productVariantSkuLinks.productMatchingId, context.productMatchingId),
      with: {
        sku: true,
      },
    });

    return links.map((link) => ({
      skuId: link.skuId,
      quantity: link.quantity,
    }));
  }

  async create(context: MatchingContext, mappings: SkuQuantityMapping[], tx?: DbTx): Promise<void> {
    const db = tx || this.db;

    for (const mapping of mappings) {
      await db
        .insert(wmsTables.productVariantSkuLinks)
        .values({
          productMatchingId: context.productMatchingId,
          skuId: mapping.skuId,
          quantity: mapping.quantity,
        })
        .onConflictDoNothing();
    }
  }

  async update(context: MatchingContext, mappings: SkuQuantityMapping[], tx?: DbTx): Promise<void> {
    await this.delete(context, tx);
    await this.create(context, mappings, tx);
  }

  async delete(context: MatchingContext, tx?: DbTx): Promise<void> {
    const db = tx || this.db;

    await db
      .delete(wmsTables.productVariantSkuLinks)
      .where(eq(wmsTables.productVariantSkuLinks.productMatchingId, context.productMatchingId));
  }

  async validate(context: MatchingContext, mappings: SkuQuantityMapping[], tx?: DbTx): Promise<boolean> {
    if (mappings.length === 0) {
      return false;
    }

    // tx 를 받으면 반드시 그것으로 읽는다 — 같은 트랜잭션에서 방금 만든 SKU 는
    // 커밋 전이라 트랜잭션 밖에서는 보이지 않는다 (#791).
    const db = tx ?? this.db;
    const skuIds = [...new Set(mappings.map((mapping) => mapping.skuId))];

    const rows = await db
      .select({ id: wmsTables.skus.id })
      .from(wmsTables.skus)
      .where(inArray(wmsTables.skus.id, skuIds));

    return rows.length === skuIds.length;
  }
}
