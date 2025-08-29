import { Injectable, Logger } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables } from '../../../database/schemas/wms-schema';
import { DbService } from '@app/db';
import { eq, and } from 'drizzle-orm';

@Injectable()
export class StockAvailabilityService {
    private readonly logger = new Logger(StockAvailabilityService.name);

    constructor(
        @InjectTypedDb<typeof wmsTables>() private readonly dbService: DbService<typeof wmsTables>,
    ) { }

    private get db() {
        return this.dbService.db;
    }

    /**
     * Variant의 판매 가능 여부를 확인
     * 매칭 상태와 재고 정책 판단
     */
    async isVariantSellable(variantId: string): Promise<{
        sellable: boolean;
        reason?: string;
        requiresStock?: boolean;
    }> {
        // 1. 매칭 정보 조회
        const matching = await this.db.query.productMatchings.findFirst({
            where: eq(wmsTables.productMatchings.variantId, variantId)
        });

        // 매칭이 없으면 판매 불가
        if (!matching) {
            return {
                sellable: false,
                reason: 'No matching found for variant'
            };
        }

        // 2. 매칭 상태별 처리
        switch (matching.status) {
            case 'ignored':
                // 무시된 매칭은 디지털 상품 등으로 항상 판매 가능
                return {
                    sellable: true,
                    requiresStock: false
                };

            case 'pending':
                // 매칭 대기 중이어도 기본적으로 판매 가능 (선판매)
                return {
                    sellable: true,
                    requiresStock: false,
                    reason: 'Pending matching - pre-sale allowed'
                };

            case 'matched':
                // 매칭 완료된 경우 재고 정책 확인
                if (!matching.inventoryManagement) {
                    // 재고 관리하지 않는 상품은 항상 판매 가능
                    return {
                        sellable: true,
                        requiresStock: false
                    };
                }

                if (matching.alwaysSellableZeroStock) {
                    // 재고 0이어도 항상 판매 가능 (직배/신상품)
                    return {
                        sellable: true,
                        requiresStock: false,
                        reason: 'Always sellable (drop-ship or new product)'
                    };
                }

                // 실제 재고 확인이 필요한 경우
                const hasStock = await this.checkVariantStock(variantId, matching.id);

                if (hasStock) {
                    return {
                        sellable: true,
                        requiresStock: true
                    };
                }

                // 재고가 없는 경우 선판매 가능 여부 확인
                if (matching.preStockSellable) {
                    return {
                        sellable: true,
                        requiresStock: false,
                        reason: 'Pre-stock sale allowed'
                    };
                }

                return {
                    sellable: false,
                    reason: 'Out of stock',
                    requiresStock: true
                };

            default:
                return {
                    sellable: false,
                    reason: 'Unknown matching status'
                };
        }
    }

    /**
     * Variant의 실제 재고 존재 여부를 확인
     */
    private async checkVariantStock(variantId: string, matchingId: string): Promise<boolean> {
        // variant에 연결된 SKU들 조회
        const links = await this.db.query.productVariantSkuLinks.findMany({
            where: eq(wmsTables.productVariantSkuLinks.productMatchingId, matchingId)
        });

        if (links.length === 0) {
            return false;
        }

        // 각 SKU의 재고 확인
        for (const link of links) {
            const stockSummaries = await this.db.query.stockSummary.findMany({
                where: eq(wmsTables.stockSummary.skuId, link.skuId)
            });

            const totalAvailable = stockSummaries.reduce((sum, s) => sum + s.availableQuantity, 0);

            if (totalAvailable < link.quantity) {
                // 하나라도 부족하면 false
                return false;
            }
        }

        return true;
    }

    /**
     * 주문 가능한 수량을 계산
     */
    async getOrderableQuantity(variantId: string): Promise<{
        quantity: number;
        isInfinite: boolean;
        details?: {
            skuId: string;
            required: number;
            available: number;
        }[];
    }> {
        const matching = await this.db.query.productMatchings.findFirst({
            where: eq(wmsTables.productMatchings.variantId, variantId)
        });

        if (!matching) {
            return { quantity: 0, isInfinite: false };
        }

        // 재고 관리하지 않거나 항상 판매 가능한 경우
        if (!matching.inventoryManagement || matching.alwaysSellableZeroStock || matching.status !== 'matched') {
            return { quantity: 999999, isInfinite: true };
        }

        // 매칭된 SKU들의 재고 확인
        const links = await this.db.query.productVariantSkuLinks.findMany({
            where: eq(wmsTables.productVariantSkuLinks.productMatchingId, matching.id)
        });

        if (links.length === 0) {
            // 매칭된 SKU가 없어도 선판매 가능한 경우
            if (matching.preStockSellable) {
                return { quantity: 999999, isInfinite: true };
            }
            return { quantity: 0, isInfinite: false };
        }

        const details: any[] = [];
        let minOrderableQuantity = 999999;

        for (const link of links) {
            const stockSummaries = await this.db.query.stockSummary.findMany({
                where: eq(wmsTables.stockSummary.skuId, link.skuId)
            });

            const totalAvailable = stockSummaries.reduce((sum, s) => sum + s.availableQuantity, 0);
            const orderableForThisSku = Math.floor(totalAvailable / link.quantity);

            details.push({
                skuId: link.skuId,
                required: link.quantity,
                available: totalAvailable
            });

            minOrderableQuantity = Math.min(minOrderableQuantity, orderableForThisSku);
        }

        // 재고가 0이지만 선판매 가능한 경우
        if (minOrderableQuantity === 0 && matching.preStockSellable) {
            return {
                quantity: 999999,
                isInfinite: true,
                details
            };
        }

        return {
            quantity: minOrderableQuantity,
            isInfinite: false,
            details
        };
    }

    /**
     * 사은품 가능 여부를 확인
     */
    async isGiftAvailable(variantId: string): Promise<boolean> {
        const matching = await this.db.query.productMatchings.findFirst({
            where: and(
                eq(wmsTables.productMatchings.variantId, variantId),
                eq(wmsTables.productMatchings.isGift, true)
            )
        });

        if (!matching || matching.status !== 'matched') {
            return false;
        }

        // 사은품도 재고 확인이 필요함
        return this.checkVariantStock(variantId, matching.id);
    }
}