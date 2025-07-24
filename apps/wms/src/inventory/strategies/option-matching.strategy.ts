// apps/wms/src/inventory/strategies/option-matching.strategy.ts
import { Injectable } from '@nestjs/common';
import { MatchingStrategy, MatchingContext, SkuQuantityMapping } from './matching-strategy.interface';
import { eq, and, inArray } from 'drizzle-orm';
import { wmsTables } from '../../../database/schemas/wms-schema';

@Injectable()
export class OptionMatchingStrategy extends MatchingStrategy {
    async lookup(context: MatchingContext): Promise<SkuQuantityMapping[]> {
        if (!context.optionData || context.optionData.length === 0) {
            throw new Error('Option data is required for option matching strategy');
        }

        const optionMatchings = await this.db.query.productOptionMatchings.findMany({
            where: and(
                eq(wmsTables.productOptionMatchings.productMatchingId, context.productMatchingId),
                inArray(
                    wmsTables.productOptionMatchings.optionValue,
                    context.optionData.map(opt => opt.optionValue)
                )
            )
        });

        // 각 옵션의 SKU를 수집 (옵션별 매칭이므로 quantity는 항상 1)
        return optionMatchings.map(matching => ({
            skuId: matching.skuId,
            quantity: 1
        }));
    }

    async create(context: MatchingContext, mappings: SkuQuantityMapping[], tx?: any): Promise<void> {
        const db = tx || this.db;

        if (!context.optionData || context.optionData.length !== mappings.length) {
            throw new Error('Option data count must match mappings count');
        }

        for (let i = 0; i < context.optionData.length; i++) {
            const option = context.optionData[i];
            const mapping = mappings[i];

            await db.insert(wmsTables.productOptionMatchings).values({
                productMatchingId: context.productMatchingId,
                optionName: option.optionName,
                optionValue: option.optionValue,
                skuId: mapping.skuId
            }).onConflictDoNothing();
        }
    }

    async update(context: MatchingContext, mappings: SkuQuantityMapping[], tx?: any): Promise<void> {
        const db = tx || this.db;

        if (context.optionData) {
            for (let i = 0; i < context.optionData.length; i++) {
                const option = context.optionData[i];
                const mapping = mappings[i];

                await db.delete(wmsTables.productOptionMatchings)
                    .where(and(
                        eq(wmsTables.productOptionMatchings.productMatchingId, context.productMatchingId),
                        eq(wmsTables.productOptionMatchings.optionName, option.optionName),
                        eq(wmsTables.productOptionMatchings.optionValue, option.optionValue)
                    ));

                await db.insert(wmsTables.productOptionMatchings).values({
                    productMatchingId: context.productMatchingId,
                    optionName: option.optionName,
                    optionValue: option.optionValue,
                    skuId: mapping.skuId
                });
            }
        }
    }

    async delete(context: MatchingContext, tx?: any): Promise<void> {
        const db = tx || this.db;

        if (context.optionData && context.optionData.length > 0) {
            for (const option of context.optionData) {
                await db.delete(wmsTables.productOptionMatchings)
                    .where(and(
                        eq(wmsTables.productOptionMatchings.productMatchingId, context.productMatchingId),
                        eq(wmsTables.productOptionMatchings.optionName, option.optionName),
                        eq(wmsTables.productOptionMatchings.optionValue, option.optionValue)
                    ));
            }
        } else {
            await db.delete(wmsTables.productOptionMatchings)
                .where(eq(wmsTables.productOptionMatchings.productMatchingId, context.productMatchingId));
        }
    }

    async validate(context: MatchingContext, mappings: SkuQuantityMapping[]): Promise<boolean> {
        if (!context.optionData || context.optionData.length === 0) {
            return false;
        }

        if (context.optionData.length !== mappings.length) {
            return false;
        }

        for (const mapping of mappings) {
            const sku = await this.db.query.skus.findFirst({
                where: eq(wmsTables.skus.id, mapping.skuId)
            });

            if (!sku || !sku.inventoryManagement) {
                return false;
            }
        }

        return true;
    }

    async areAllOptionsMapped(productMatchingId: string, expectedOptions: Array<{ name: string, values: string[] }>): Promise<boolean> {
        const existingMappings = await this.db.query.productOptionMatchings.findMany({
            where: eq(wmsTables.productOptionMatchings.productMatchingId, productMatchingId)
        });

        for (const option of expectedOptions) {
            for (const value of option.values) {
                const found = existingMappings.find(m =>
                    m.optionName === option.name && m.optionValue === value
                );
                if (!found) {
                    return false;
                }
            }
        }

        return true;
    }
}