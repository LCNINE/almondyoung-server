import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../../database/schemas/wms-schema';
import { eq, and, lte, gte, or, isNull } from 'drizzle-orm';
import { CreateSkuPricingDto } from '../dto/sku-pricing/create-sku-pricing.dto';
import { UpdateSkuPricingDto } from '../dto/sku-pricing/update-sku-pricing.dto';
import { SkuPricingResponseDto } from '../dto/sku-pricing/sku-pricing-response.dto';

@Injectable()
export class SkuPricingService {
    constructor(
        @InjectTypedDb<typeof wmsSchema>()
        private readonly dbService: DbService<typeof wmsSchema>,
    ) {}

    private get db() {
        return this.dbService.db;
    }

    /**
     * Create or update SKU pricing (upsert pattern)
     * Since skuId has unique constraint, this handles both create and update
     */
    async createOrUpdatePricing(
        dto: CreateSkuPricingDto,
        tx?: DbTx
    ): Promise<SkuPricingResponseDto> {
        return this.inTx(async (tx) => {
            const { skuVariantPricing, skus } = wmsTables;

            // Validate SKU exists
            const sku = await tx
                .select()
                .from(skus)
                .where(eq(skus.id, dto.skuId))
                .limit(1);

            if (!sku[0]) {
                throw new NotFoundException(`SKU with ID ${dto.skuId} not found`);
            }

            // Validate dates if provided
            if (dto.priceEffectiveDate && dto.priceExpiryDate) {
                if (dto.priceEffectiveDate >= dto.priceExpiryDate) {
                    throw new BadRequestException(
                        'priceEffectiveDate must be before priceExpiryDate'
                    );
                }
            }

            // Check if pricing already exists
            const existing = await tx
                .select()
                .from(skuVariantPricing)
                .where(eq(skuVariantPricing.skuId, dto.skuId))
                .limit(1);

            if (existing[0]) {
                // Update existing pricing
                const updated = await tx
                    .update(skuVariantPricing)
                    .set({
                        retailPrice: dto.retailPrice,
                        specialSalePrice: dto.specialSalePrice,
                        wholesalePrice: dto.wholesalePrice,
                        sellingPrice: dto.sellingPrice,
                        priceEffectiveDate: dto.priceEffectiveDate,
                        priceExpiryDate: dto.priceExpiryDate,
                        updatedAt: new Date(),
                    })
                    .where(eq(skuVariantPricing.skuId, dto.skuId))
                    .returning();

                return this.mapToResponseDto(updated[0]);
            } else {
                // Create new pricing
                const created = await tx
                    .insert(skuVariantPricing)
                    .values({
                        skuId: dto.skuId,
                        retailPrice: dto.retailPrice,
                        specialSalePrice: dto.specialSalePrice,
                        wholesalePrice: dto.wholesalePrice,
                        sellingPrice: dto.sellingPrice,
                        priceEffectiveDate: dto.priceEffectiveDate,
                        priceExpiryDate: dto.priceExpiryDate,
                    })
                    .returning();

                return this.mapToResponseDto(created[0]);
            }
        }, tx);
    }

    /**
     * Update existing pricing
     */
    async updatePricing(
        skuId: string,
        dto: UpdateSkuPricingDto,
        tx?: DbTx
    ): Promise<SkuPricingResponseDto> {
        return this.inTx(async (tx) => {
            const { skuVariantPricing } = wmsTables;

            // Check if pricing exists
            const existing = await tx
                .select()
                .from(skuVariantPricing)
                .where(eq(skuVariantPricing.skuId, skuId))
                .limit(1);

            if (!existing[0]) {
                throw new NotFoundException(`Pricing for SKU ${skuId} not found`);
            }

            // Validate dates if both provided
            if (dto.priceEffectiveDate && dto.priceExpiryDate) {
                if (dto.priceEffectiveDate >= dto.priceExpiryDate) {
                    throw new BadRequestException(
                        'priceEffectiveDate must be before priceExpiryDate'
                    );
                }
            }

            // Update pricing
            const updated = await tx
                .update(skuVariantPricing)
                .set({
                    ...dto,
                    updatedAt: new Date(),
                })
                .where(eq(skuVariantPricing.skuId, skuId))
                .returning();

            return this.mapToResponseDto(updated[0]);
        }, tx);
    }

    /**
     * Get pricing by SKU ID (regardless of validity period)
     */
    async getPricingBySkuId(skuId: string, tx?: DbTx): Promise<SkuPricingResponseDto | null> {
        return this.inTx(async (tx) => {
            const { skuVariantPricing } = wmsTables;

            const result = await tx
                .select()
                .from(skuVariantPricing)
                .where(eq(skuVariantPricing.skuId, skuId))
                .limit(1);

            if (!result[0]) {
                return null;
            }

            return this.mapToResponseDto(result[0]);
        }, tx);
    }

    /**
     * Get effective pricing (considering validity period)
     * Returns pricing only if it's currently valid based on dates
     */
    async getEffectivePricing(
        skuId: string,
        referenceDate: Date = new Date(),
        tx?: DbTx
    ): Promise<SkuPricingResponseDto | null> {
        return this.inTx(async (tx) => {
            const { skuVariantPricing } = wmsTables;

            const result = await tx
                .select()
                .from(skuVariantPricing)
                .where(
                    and(
                        eq(skuVariantPricing.skuId, skuId),
                        // Either no effective date or effective date is in the past
                        or(
                            isNull(skuVariantPricing.priceEffectiveDate),
                            lte(skuVariantPricing.priceEffectiveDate, referenceDate)
                        ),
                        // Either no expiry date or expiry date is in the future
                        or(
                            isNull(skuVariantPricing.priceExpiryDate),
                            gte(skuVariantPricing.priceExpiryDate, referenceDate)
                        )
                    )
                )
                .limit(1);

            if (!result[0]) {
                return null;
            }

            return this.mapToResponseDto(result[0]);
        }, tx);
    }

    /**
     * Delete pricing for a SKU
     */
    async deletePricing(skuId: string, tx?: DbTx): Promise<{ success: boolean; message: string }> {
        return this.inTx(async (tx) => {
            const { skuVariantPricing } = wmsTables;

            // Check if exists
            const existing = await tx
                .select()
                .from(skuVariantPricing)
                .where(eq(skuVariantPricing.skuId, skuId))
                .limit(1);

            if (!existing[0]) {
                throw new NotFoundException(`Pricing for SKU ${skuId} not found`);
            }

            await tx
                .delete(skuVariantPricing)
                .where(eq(skuVariantPricing.skuId, skuId));

            return {
                success: true,
                message: `Pricing for SKU ${skuId} deleted successfully`,
            };
        }, tx);
    }

    /**
     * Get all SKUs with pricing information
     */
    async getAllPricing(tx?: DbTx): Promise<SkuPricingResponseDto[]> {
        return this.inTx(async (tx) => {
            const { skuVariantPricing } = wmsTables;

            const results = await tx
                .select()
                .from(skuVariantPricing)
                .orderBy(skuVariantPricing.createdAt);

            return results.map(row => this.mapToResponseDto(row));
        }, tx);
    }

    /**
     * Check if pricing is currently valid
     */
    async isPricingValid(
        skuId: string,
        referenceDate: Date = new Date(),
        tx?: DbTx
    ): Promise<boolean> {
        const pricing = await this.getEffectivePricing(skuId, referenceDate, tx);
        return pricing !== null;
    }

    /**
     * Map database row to response DTO
     */
    private mapToResponseDto(row: any): SkuPricingResponseDto {
        return {
            id: row.id,
            skuId: row.skuId,
            retailPrice: row.retailPrice,
            specialSalePrice: row.specialSalePrice,
            wholesalePrice: row.wholesalePrice,
            sellingPrice: row.sellingPrice,
            priceEffectiveDate: row.priceEffectiveDate,
            priceExpiryDate: row.priceExpiryDate,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        };
    }

    private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx): Promise<T> {
        return tx ? fn(tx) : this.db.transaction(fn);
    }
}

