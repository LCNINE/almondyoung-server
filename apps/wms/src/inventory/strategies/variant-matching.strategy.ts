import { Injectable } from '@nestjs/common';
import { MatchingStrategy, MatchingContext, SkuQuantityMapping } from './matching-strategy.interface';
import { eq } from 'drizzle-orm';
import { wmsTables, wmsSchema, DbTx } from '../../../database/schemas/wms-schema';

@Injectable()
export class VariantMatchingStrategy extends MatchingStrategy {
    async lookup(context: MatchingContext): Promise<SkuQuantityMapping[]> {
        const links = await this.db.query.productVariantSkuLinks.findMany({
            where: eq(wmsTables.productVariantSkuLinks.productMatchingId, context.productMatchingId),
            with: {
                sku: true
            }
        });

        return links.map(link => ({
            skuId: link.skuId,
            quantity: link.quantity
        }));
    }

    async create(context: MatchingContext, mappings: SkuQuantityMapping[], tx?: DbTx): Promise<void> {
        const db = tx || this.db;

        for (const mapping of mappings) {
            await db.insert(wmsTables.productVariantSkuLinks).values({
                productMatchingId: context.productMatchingId,
                skuId: mapping.skuId,
                quantity: mapping.quantity
            }).onConflictDoNothing();
        }
    }

    async update(context: MatchingContext, mappings: SkuQuantityMapping[], tx?: DbTx): Promise<void> {
        const db = tx || this.db;

        await this.delete(context, tx);

        await this.create(context, mappings, tx);
    }

    async delete(context: MatchingContext, tx?: DbTx): Promise<void> {
        const db = tx || this.db;

        await db.delete(wmsTables.productVariantSkuLinks)
            .where(eq(wmsTables.productVariantSkuLinks.productMatchingId, context.productMatchingId));
    }

    async validate(context: MatchingContext, mappings: SkuQuantityMapping[]): Promise<boolean> {
        if (mappings.length === 0) {
            return false;
        }

        for (const mapping of mappings) {
            const sku = await this.db.query.skus.findFirst({
                where: eq(wmsTables.skus.id, mapping.skuId)
            });

            if (!sku) {
                return false;
            }
        }

        return true;
    }
}