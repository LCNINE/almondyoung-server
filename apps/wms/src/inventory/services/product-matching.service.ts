import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables, wmsSchema } from '../../../database/schemas/wms-schema';
import { TypedDatabase, DbService } from '@app/db';
import { and, eq } from 'drizzle-orm';
import { InventoryService } from './inventory.service';
import { StockEventService } from './stock-event.service';
import { ResolveMatchingDto } from '../dto/product-matching/resolve-matching.dto';
import { SkuCreationSource } from '../dto/sku/create-sku.dto';
import { MatchingStrategy, MatchingContext, SkuQuantityMapping } from '../strategies/matching-strategy.interface';
import { VoidMatchingStrategy } from '../strategies/void-matching.strategy';
import { VariantMatchingStrategy } from '../strategies/variant-matching.strategy';
import { OptionMatchingStrategy } from '../strategies/option-matching.strategy';

// 임시 인터페이스 (실제로는 PIM 모듈에서 가져와야 함)
interface PimSkuComponent {
    skuName: string;
}

interface PimVariantPayload {
    id: string;
    name: string;
    inventoryManagement: boolean;
    components: PimSkuComponent[];
}

interface PimProductPayload {
    productId: string;
    name: string;
    variants: PimVariantPayload[];
}

@Injectable()
export class ProductMatchingService {
    private readonly logger = new Logger(ProductMatchingService.name);
    private readonly strategies: Map<string, MatchingStrategy>;

    constructor(
        @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
        private readonly inventoryService: InventoryService,
        private readonly stockEventService: StockEventService,
    ) {
        this.strategies = new Map();
        this.strategies.set('void', new VoidMatchingStrategy(dbService));
        this.strategies.set('variant', new VariantMatchingStrategy(dbService));
        this.strategies.set('option', new OptionMatchingStrategy(dbService));
    }

    private get db() {
        return this.dbService.db;
    }

    private getStrategy(strategyType: string): MatchingStrategy {
        const strategy = this.strategies.get(strategyType);
        if (!strategy) {
            throw new BadRequestException(`Unknown matching strategy: ${strategyType}`);
        }
        return strategy;
    }

    async handleManualMatchingRequest(payload: PimProductPayload) {
        if (!payload || !payload.productId || !Array.isArray(payload.variants)) {
            throw new BadRequestException('Invalid payload: productId and variants array are required');
        }

        this.logger.log(`Creating manual matching request from PIM event for product ID: ${payload.productId}`);

        const results: Array<{ variantId: string; status: 'created' | 'exists' | 'error'; error?: string }> = [];

        for (const variant of payload.variants) {
            try {
                if (!variant.id) {
                    this.logger.error(`Variant missing ID in product ${payload.productId}`);
                    results.push({ variantId: 'unknown', status: 'error', error: 'Variant ID is required' });
                    continue;
                }

                const existingMatching = await this.db.query.productMatchings.findFirst({
                    where: eq(wmsTables.productMatchings.variantId, variant.id),
                });

                if (existingMatching) {
                    this.logger.warn(`Product matching already exists for variant ${variant.id}, skipping creation.`);
                    results.push({ variantId: variant.id, status: 'exists' });
                    continue;
                }

                const [newProductMatching] = await this.db.insert(wmsTables.productMatchings).values({
                    variantId: variant.id,
                    status: 'pending',
                    priority: 'high',
                    strategy: null,
                    isResolved: false,
                }).returning();

                if (!newProductMatching) {
                    throw new Error(`Product matching entry creation failed for variant ${variant.id}`);
                }

                this.logger.log(`Product matching pending created for variant ${variant.id}, matchingId: ${newProductMatching.id}`);
                results.push({ variantId: variant.id, status: 'created' });

            } catch (error) {
                this.logger.error(`Failed to create manual matching for variant ${variant.id}:`, error);
                results.push({
                    variantId: variant.id,
                    status: 'error',
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        }

        const successCount = results.filter(r => r.status === 'created').length;
        const errorCount = results.filter(r => r.status === 'error').length;

        if (errorCount > 0) {
            this.logger.warn(`Manual matching request completed with ${errorCount} errors out of ${payload.variants.length} variants`);
        }

        this.logger.log(`Manual matching request completed: ${successCount} created, ${errorCount} errors`);
        return results;
    }

    async handleAutomaticMatchingRequest(payload: PimProductPayload) {
        this.logger.log(`Handling automatic matching from PIM event for product ID: ${payload.productId}`);

        for (const variant of payload.variants) {
            if (!variant.inventoryManagement) {
                await this.db.insert(wmsTables.productMatchings).values({
                    variantId: variant.id,
                    status: 'ignored',
                    priority: 'normal',
                    strategy: 'void',
                    isResolved: true,
                    // 디지털 상품의 재고 정책
                    inventoryManagement: false,
                    preStockSellable: true,
                    alwaysSellableZeroStock: false,
                }).onConflictDoNothing();
                this.logger.log(`Variant ${variant.id} is not inventory managed. Marked as ignored with void strategy.`);
                continue;
            }

            await this.db.transaction(async (tx) => {
                const [newProductMatching] = await tx.insert(wmsTables.productMatchings).values({
                    variantId: variant.id,
                    status: 'matched',
                    priority: 'normal',
                    strategy: 'variant',
                    isResolved: true,
                    // 물리적 상품의 기본 재고 정책
                    inventoryManagement: true,
                    preStockSellable: true,
                    alwaysSellableZeroStock: false,
                }).returning();

                if (!newProductMatching) {
                    throw new Error(`Product matching entry(matched) 생성에 실패했습니다. (variantId: ${variant.id})`);
                }

                const warehouseId = this.inventoryService.getDefaultWarehouseId();
                const strategy = this.getStrategy('variant');
                const mappings: SkuQuantityMapping[] = [];

                for (const component of variant.components) {
                    const newStock = await this.stockEventService.createStockEntry({
                        variantId: variant.id,
                        skuName: component.skuName,
                        inventoryManagement: true,
                        warehouseId,
                        quantity: 0,
                        stockType: 'physical',
                        reason: `auto_matching_for_variant_${variant.id}`,
                    }, tx);

                    mappings.push({
                        skuId: newStock.skuId,
                        quantity: 1
                    });
                }

                const context: MatchingContext = {
                    variantId: variant.id,
                    productMatchingId: newProductMatching.id
                };
                await strategy.create(context, mappings, tx);

                this.logger.log(`Auto-matched variant ${variant.id} with ${variant.components.length} SKUs using variant strategy.`);
            });
        }
    }

    async getMatchingPendings(status?: 'pending' | 'matched' | 'ignored') {
        const matchings = await this.db.query.productMatchings.findMany({
            where: status ? eq(wmsTables.productMatchings.status, status) : undefined,
            orderBy: (matchings, { asc }) => [asc(matchings.createdAt)],
            with: {
                links: {
                    with: {
                        sku: true
                    }
                }
            }
        });

        const matchingsWithDetails = await Promise.all(matchings.map(async (matching) => {
            if (matching.strategy && matching.status === 'matched') {
                try {
                    const strategy = this.getStrategy(matching.strategy);
                    const context: MatchingContext = {
                        variantId: matching.variantId,
                        productMatchingId: matching.id
                    };
                    const skuMappings = await strategy.lookup(context);

                    return {
                        ...matching,
                        skuMappings
                    };
                } catch (error) {
                    this.logger.error(`Failed to lookup mappings for matching ${matching.id}:`, error);
                    return matching;
                }
            }
            return matching;
        }));

        return matchingsWithDetails;
    }

    async resolveMatchingPending(matchingId: string, resolveDto: ResolveMatchingDto) {
        const { skuIds, skuMappings, ignore, strategy = 'variant', stockPolicy, isGift = false } = resolveDto;

        const productMatching = await this.db.query.productMatchings.findFirst({
            where: and(
                eq(wmsTables.productMatchings.id, matchingId),
                eq(wmsTables.productMatchings.isResolved, false)
            ),
        });

        if (!productMatching) {
            throw new NotFoundException(`Product matching with ID ${matchingId} not found or already resolved.`);
        }

        if (ignore) {
            const [updatedMatching] = await this.db.update(wmsTables.productMatchings).set({
                status: 'ignored',
                strategy: 'void',
                isResolved: true,
                // 무시된 매칭의 기본 재고 정책
                inventoryManagement: false,
                preStockSellable: true,
                alwaysSellableZeroStock: false,
                updatedAt: new Date(),
            }).where(eq(wmsTables.productMatchings.id, matchingId)).returning();
            this.logger.log(`Product matching ${matchingId} resolved as 'ignored' with void strategy.`);
            return updatedMatching;

        } else if ((skuIds && skuIds.length > 0) || (skuMappings && skuMappings.length > 0)) {

            return this.db.transaction(async (tx) => {
                let mappings: SkuQuantityMapping[];

                if (skuMappings && skuMappings.length > 0) {
                    mappings = skuMappings.map(mapping => ({
                        skuId: mapping.skuId,
                        quantity: mapping.quantity || 1
                    }));
                } else if (skuIds && skuIds.length > 0) {
                    mappings = skuIds.map(skuId => ({
                        skuId,
                        quantity: 1
                    }));
                } else {
                    throw new BadRequestException('SKU 매핑 정보가 없습니다.');
                }

                const matchingStrategy = this.getStrategy(strategy);
                const context: MatchingContext = {
                    variantId: productMatching.variantId,
                    productMatchingId: productMatching.id
                };

                const isValid = await matchingStrategy.validate(context, mappings);
                if (!isValid) {
                    throw new BadRequestException('Invalid SKU mappings for the selected strategy');
                }

                await matchingStrategy.create(context, mappings, tx);

                // 재고 정책 설정 (기본값 또는 제공된 값)
                const finalStockPolicy = {
                    inventoryManagement: stockPolicy?.inventoryManagement ?? true,
                    preStockSellable: stockPolicy?.preStockSellable ?? true,
                    alwaysSellableZeroStock: stockPolicy?.alwaysSellableZeroStock ?? false,
                };

                const [updatedMatching] = await tx.update(wmsTables.productMatchings).set({
                    status: 'matched',
                    strategy: strategy,
                    isResolved: true,
                    ...finalStockPolicy,
                    updatedAt: new Date(),
                }).where(eq(wmsTables.productMatchings.id, matchingId)).returning();

                const totalSkus = mappings.length;
                const totalQuantity = mappings.reduce((sum, m) => sum + m.quantity, 0);
                this.logger.log(
                    `Product matching ${matchingId} resolved as 'matched' with ${strategy} strategy. ` +
                    `SKUs: ${totalSkus}, Total Quantity: ${totalQuantity}, ` +
                    `Stock Policy: ${JSON.stringify(finalStockPolicy)}`
                );
                return updatedMatching;
            });
        } else {
            throw new BadRequestException('매칭할 SKU 정보를 제공하거나, 무시 옵션을 선택해야 합니다.');
        }
    }

    async setMatchingPriority(matchingId: string, priority: 'normal' | 'high') {
        const [updatedMatching] = await this.db.update(wmsTables.productMatchings)
            .set({
                priority: priority,
                updatedAt: new Date(),
            })
            .where(and(
                eq(wmsTables.productMatchings.id, matchingId),
                eq(wmsTables.productMatchings.isResolved, false)
            ))
            .returning();

        if (!updatedMatching) {
            throw new NotFoundException(`Product matching with ID ${matchingId} not found or already resolved.`);
        }

        this.logger.log(`Product matching ${matchingId} 우선순위 설정됨: ${priority}.`);
        return updatedMatching;
    }

    async handleVariantDeletion(variantId: string) {
        this.logger.log(`Handling variant deletion for variantId: ${variantId}`);

        const productMatching = await this.db.query.productMatchings.findFirst({
            where: eq(wmsTables.productMatchings.variantId, variantId),
        });

        if (!productMatching) {
            this.logger.warn(`No product matching found for variantId: ${variantId}, nothing to delete.`);
            return;
        }

        if (productMatching.status === 'matched' && productMatching.strategy) {
            await this.db.transaction(async (tx) => {
                if (!productMatching.strategy) {
                    throw new BadRequestException('strategy 값이 null입니다.');
                }
                const strategy = this.getStrategy(productMatching.strategy as string);
                const context: MatchingContext = {
                    variantId: productMatching.variantId,
                    productMatchingId: productMatching.id
                };
                await strategy.delete(context, tx);

                await tx.delete(wmsTables.productMatchings)
                    .where(eq(wmsTables.productMatchings.id, productMatching.id));

                this.logger.log(`Deleted product matching and links for variantId: ${variantId} using ${productMatching.strategy} strategy`);
            });
        } else {
            await this.db.delete(wmsTables.productMatchings)
                .where(eq(wmsTables.productMatchings.id, productMatching.id));

            this.logger.log(`Deleted ${productMatching.status} product matching for variantId: ${variantId}`);
        }
    }

    async createNewSkuForMatching(variantId: string, skuData: {
        name: string;
        inventoryManagement: boolean;
        alwaysSellableZeroStock?: boolean;
    }) {
        return this.db.transaction(async (tx) => {
            const newSku = await this.inventoryService._createSkuInternal({
                name: skuData.name,
                source: SkuCreationSource.MANUAL_MATCHING,
            }, tx);

            if (skuData.inventoryManagement) {
                const warehouseId = this.inventoryService.getDefaultWarehouseId();
                await this.stockEventService.createStockEntry({
                    variantId,
                    skuName: newSku.name,
                    inventoryManagement: true,
                    warehouseId,
                    quantity: 0,
                    stockType: 'physical',
                    reason: `manual_matching_for_variant_${variantId}`,
                }, tx);
            }

            return newSku;
        });
    }

    async changeMatchingStrategy(matchingId: string, newStrategy: 'void' | 'variant' | 'option') {
        const productMatching = await this.db.query.productMatchings.findFirst({
            where: eq(wmsTables.productMatchings.id, matchingId)
        });

        if (!productMatching) {
            throw new NotFoundException(`Product matching with ID ${matchingId} not found.`);
        }

        if (productMatching.status !== 'matched') {
            throw new BadRequestException('Can only change strategy for matched products');
        }

        await this.db.transaction(async (tx) => {
            if (productMatching.strategy) {
                const oldStrategy = this.getStrategy(productMatching.strategy);
                const context: MatchingContext = {
                    variantId: productMatching.variantId,
                    productMatchingId: productMatching.id
                };
                await oldStrategy.delete(context, tx);
            }

            await tx.update(wmsTables.productMatchings)
                .set({
                    strategy: newStrategy,
                    updatedAt: new Date()
                })
                .where(eq(wmsTables.productMatchings.id, matchingId));

            this.logger.log(`Changed matching strategy for ${matchingId} from ${productMatching.strategy} to ${newStrategy}`);
        });
    }

    async resolveOptionMatching(
        matchingId: string,
        optionMappings: Array<{
            optionName: string;
            optionValue: string;
            skuId: string;
        }>
    ) {
        const productMatching = await this.db.query.productMatchings.findFirst({
            where: eq(wmsTables.productMatchings.id, matchingId)
        });

        if (!productMatching) {
            throw new NotFoundException(`Product matching with ID ${matchingId} not found.`);
        }

        return this.db.transaction(async (tx) => {
            const strategy = this.getStrategy('option') as OptionMatchingStrategy;

            for (const optionMapping of optionMappings) {
                const context: MatchingContext = {
                    variantId: productMatching.variantId,
                    productMatchingId: productMatching.id,
                    optionData: [{
                        optionName: optionMapping.optionName,
                        optionValue: optionMapping.optionValue
                    }]
                };

                const mappings: SkuQuantityMapping[] = [{
                    skuId: optionMapping.skuId,
                    quantity: 1
                }];

                await strategy.update(context, mappings, tx);
            }

            const [updatedMatching] = await tx.update(wmsTables.productMatchings)
                .set({
                    status: 'matched',
                    strategy: 'option',
                    isResolved: true,
                    updatedAt: new Date()
                })
                .where(eq(wmsTables.productMatchings.id, matchingId))
                .returning();

            this.logger.log(`Option matching resolved for ${matchingId} with ${optionMappings.length} option mappings`);
            return updatedMatching;
        });
    }

    async getSkusForVariant(
        variantId: string,
        selectedOptions?: Array<{ optionName: string; optionValue: string }>
    ): Promise<SkuQuantityMapping[]> {
        const productMatching = await this.db.query.productMatchings.findFirst({
            where: and(
                eq(wmsTables.productMatchings.variantId, variantId),
                eq(wmsTables.productMatchings.status, 'matched')
            )
        });

        if (!productMatching || !productMatching.strategy) {
            throw new NotFoundException(`No matched product found for variant ${variantId}`);
        }

        const strategy = this.getStrategy(productMatching.strategy);
        const context: MatchingContext = {
            variantId: productMatching.variantId,
            productMatchingId: productMatching.id,
            optionData: selectedOptions
        };

        return strategy.lookup(context);
    }

    async getStockPolicyForVariant(variantId: string): Promise<{
        inventoryManagement: boolean;
        preStockSellable: boolean;
        alwaysSellableZeroStock: boolean;
    } | null> {
        const matching = await this.db.query.productMatchings.findFirst({
            where: eq(wmsTables.productMatchings.variantId, variantId)
        });

        if (!matching) {
            return null;
        }

        return {
            inventoryManagement: matching.inventoryManagement,
            preStockSellable: matching.preStockSellable,
            alwaysSellableZeroStock: matching.alwaysSellableZeroStock,
        };
    }

    async updateStockPolicy(
        matchingId: string,
        stockPolicy: {
            inventoryManagement?: boolean;
            preStockSellable?: boolean;
            alwaysSellableZeroStock?: boolean;
        }
    ) {
        const [updated] = await this.db.update(wmsTables.productMatchings)
            .set({
                ...stockPolicy,
                updatedAt: new Date(),
            })
            .where(eq(wmsTables.productMatchings.id, matchingId))
            .returning();

        if (!updated) {
            throw new NotFoundException(`Product matching with ID ${matchingId} not found.`);
        }

        this.logger.log(`Updated stock policy for matching ${matchingId}: ${JSON.stringify(stockPolicy)}`);
        return updated;
    }
}