import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import { DbService } from '@app/db';
import { and, eq, desc, count, inArray, isNull, or, ne, gte, lte, ilike, SQL, sql } from 'drizzle-orm';
import { StockEventService } from '../../inventory/core/services/stock-event.service';
import { WarehouseService } from '../../inventory/warehouse/services/warehouse.service';
import { SkuCatalogService } from '../../inventory/sku-catalog/services/sku-catalog.service';
import { ResolveLegacyIgnoredMatchingDto, ResolveMatchingDto, StockPolicyDto } from '../dto/resolve-matching.dto';
import { SkuCreationSource } from '../../inventory/sku-catalog/dto/create-sku.dto';
import { MatchingStrategy, MatchingContext, SkuQuantityMapping } from '../strategies/matching-strategy.interface';
import { VoidMatchingStrategy } from '../strategies/void-matching.strategy';
import { VariantMatchingStrategy } from '../strategies/variant-matching.strategy';
import { ProductSellableQuantityService } from '../../inventory/product-sellable-quantity/services/product-sellable-quantity.service';
import { FulfillmentOrderCreationBacklogService } from '../../fulfillment/backlog/fulfillment-order-creation-backlog.service';
import { AuditContext, AuditService } from '../../inventory/shared/services/audit.service';
import { productMasterVersions, productVariants } from '../../catalog/schema/catalog.schema';

export interface PimSkuComponent {
  skuId: string;
  skuName?: string;
}

export interface PimVariantPayload {
  id: string;
  name: string;
  inventoryManagement: boolean;
  preStockSellable?: boolean;
  alwaysSellableZeroStock?: boolean;
  components: PimSkuComponent[];
}

export interface PimProductPayload {
  masterId: string;
  name: string;
  variants: PimVariantPayload[];
}

export interface ProductMatchingsQuery {
  status?: 'pending' | 'matched' | 'ignored';
  limit?: number;
  offset?: number;
}

type ProductMatchingListRow = {
  id: string;
  variantId: string;
  masterId: string | null;
  status: 'pending' | 'matched' | 'ignored';
  priority: 'normal' | 'high';
  strategy: 'void' | 'variant' | null;
  preStockSellable: boolean;
  alwaysSellableZeroStock: boolean;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class ProductMatchingService {
  private readonly logger = new Logger(ProductMatchingService.name);
  private readonly strategies: Map<string, MatchingStrategy>;

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly skuCatalogService: SkuCatalogService,
    private readonly stockEventService: StockEventService,
    private readonly warehouseService: WarehouseService,
    private readonly productSellableQuantity: ProductSellableQuantityService,
    private readonly fulfillmentBacklog: FulfillmentOrderCreationBacklogService,
    private readonly auditService: AuditService,
  ) {
    this.strategies = new Map();
    this.strategies.set('void', new VoidMatchingStrategy(dbService));
    this.strategies.set('variant', new VariantMatchingStrategy(dbService));
  }

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  private getStrategy(strategyType: string): MatchingStrategy {
    const strategy = this.strategies.get(strategyType);
    if (!strategy) {
      throw new BadRequestException(`Unsupported strategy: ${strategyType}. Only 'void' and 'variant' are supported.`);
    }
    return strategy;
  }

  private async createVariantSkuMappingsFromComponents(
    variantId: string,
    productMatchingId: string,
    components: PimSkuComponent[],
    tx: DbTx,
  ): Promise<SkuQuantityMapping[]> {
    const strategy = this.getStrategy('variant');
    const mappings: SkuQuantityMapping[] = [];

    for (const component of components) {
      const sku = await tx.query.skus.findFirst({
        where: eq(wmsTables.skus.id, component.skuId),
      });

      if (!sku) {
        throw new BadRequestException(`SKU not found: ${component.skuId}`);
      }

      mappings.push({
        skuId: component.skuId,
        quantity: 1,
      });
    }

    const context: MatchingContext = {
      variantId,
      productMatchingId,
    };
    await strategy.create(context, mappings, tx);

    return mappings;
  }

  /**
   * variant 생성 이벤트 핸들러 — Catalog BC에서 직접 호출
   * (기존 ProductEventConsumer.onProductVariantCreated 로직)
   */
  async handleVariantCreated(payload: {
    masterId: string;
    productName: string;
    variantId: string;
    variantName?: string;
    inventoryManagement: boolean;
    preStockSellable?: boolean;
    alwaysSellableZeroStock?: boolean;
  }): Promise<void> {
    try {
      if (!payload.inventoryManagement) {
        const result = await this.handleAutomaticMatchingRequest({
          masterId: payload.masterId,
          name: payload.productName,
          variants: [
            {
              id: payload.variantId,
              name: payload.variantName ?? '',
              inventoryManagement: false,
              components: [],
            },
          ],
        });
        this.logger.log(
          `Created auto-void matching for ${payload.variantId}: ${result.created} created, ${result.skipped} skipped`,
        );
      } else {
        const result = await this.handleManualMatchingRequest({
          masterId: payload.masterId,
          name: payload.productName,
          variants: [
            {
              id: payload.variantId,
              name: payload.variantName ?? '',
              inventoryManagement: true,
              preStockSellable: payload.preStockSellable ?? false,
              alwaysSellableZeroStock: payload.alwaysSellableZeroStock ?? false,
              components: [],
            },
          ],
        });

        if (result.skipped > 0) {
          this.logger.log(`Matching already exists for ${payload.variantId} (likely created by orchestrator)`);
        } else {
          this.logger.log(`Created ${result.created} matching-pending record(s) for variant ${payload.variantId}`);
        }
      }
    } catch (error) {
      this.logger.error(`Failed to handle variant created: ${payload.variantId}`, error.stack);
      throw error;
    }
  }

  /**
   * 재고관리 설정 변경 핸들러 — Catalog BC에서 직접 호출
   */
  async handleInventoryManagementChanged(payload: {
    masterId: string;
    productName: string;
    inventoryManagement: boolean;
    affectedVariants: Array<{ variantId: string; variantName?: string }>;
  }): Promise<void> {
    try {
      const variants = payload.affectedVariants.map((v) => ({
        id: v.variantId,
        name: v.variantName ?? '',
        inventoryManagement: payload.inventoryManagement,
        components: [],
      }));

      if (payload.inventoryManagement) {
        const result = await this.handleManualMatchingRequest({
          masterId: payload.masterId,
          name: payload.productName,
          variants,
        });
        this.logger.log(
          `Updated matching for ${variants.length} variant(s): ${result.created} created, ${result.skipped} skipped`,
        );
      } else {
        const result = await this.handleAutomaticMatchingRequest({
          masterId: payload.masterId,
          name: payload.productName,
          variants,
        });
        this.logger.log(
          `Updated matching for ${variants.length} variant(s): ${result.created} created, ${result.skipped} skipped`,
        );
      }
    } catch (error) {
      this.logger.error(`Failed to handle inventory management changed: ${payload.masterId}`, error.stack);
      throw error;
    }
  }

  async handleManualMatchingRequest(
    payload: PimProductPayload,
    tx?: DbTx,
  ): Promise<{ created: number; skipped: number }> {
    if (!payload || !payload.masterId || !Array.isArray(payload.variants)) {
      throw new BadRequestException('Invalid payload: masterId and variants array are required');
    }

    this.logger.log(`Creating manual matching request for master ID: ${payload.masterId}`);

    return this.inTx(async (trx) => {
      let created = 0;
      let skipped = 0;

      for (const variant of payload.variants) {
        try {
          if (!variant.id) {
            this.logger.error(`Variant missing ID in product ${payload.masterId}`);
            skipped++;
            continue;
          }

          const [existingMatching] = await trx
            .select()
            .from(wmsTables.productMatchings)
            .where(eq(wmsTables.productMatchings.variantId, variant.id))
            .limit(1);

          if (existingMatching) {
            this.logger.warn(`Product matching already exists for variant ${variant.id}, skipping creation.`);
            skipped++;
            continue;
          }

          const [newProductMatching] = await trx
            .insert(wmsTables.productMatchings)
            .values({
              variantId: variant.id,
              masterId: payload.masterId,
              status: 'pending',
              priority: 'high',
              strategy: null,
              isResolved: false,
            })
            .returning();

          if (!newProductMatching) {
            throw new Error(`Product matching entry creation failed for variant ${variant.id}`);
          }

          this.logger.log(
            `Product matching pending created for variant ${variant.id}, matchingId: ${newProductMatching.id}`,
          );
          await this.productSellableQuantity.recalculateAndPublishForVariant(variant.id, trx);
          created++;
        } catch (error) {
          this.logger.error(`Failed to create manual matching for variant ${variant.id}:`, error);
          skipped++;
        }
      }

      this.logger.log(`Manual matching request completed: ${created} created, ${skipped} skipped`);
      return { created, skipped };
    }, tx);
  }

  async handleAutomaticMatchingRequest(
    payload: PimProductPayload,
    tx?: DbTx,
  ): Promise<{ created: number; skipped: number }> {
    this.logger.log(`Handling automatic matching for master ID: ${payload.masterId}`);
    return this.inTx(async (trx) => {
      let created = 0;
      let skipped = 0;

      for (const variant of payload.variants) {
        try {
          if (!variant.inventoryManagement) {
            const [existing] = await trx
              .select()
              .from(wmsTables.productMatchings)
              .where(eq(wmsTables.productMatchings.variantId, variant.id))
              .limit(1);

            if (existing) {
              await trx
                .delete(wmsTables.productVariantSkuLinks)
                .where(eq(wmsTables.productVariantSkuLinks.productMatchingId, existing.id));

              await trx
                .update(wmsTables.productMatchings)
                .set({
                  masterId: payload.masterId,
                  status: 'matched',
                  strategy: 'void',
                  isResolved: true,
                  preStockSellable: true,
                  alwaysSellableZeroStock: false,
                  updatedAt: new Date(),
                })
                .where(eq(wmsTables.productMatchings.id, existing.id));

              await this.productSellableQuantity.recalculateAndPublishForVariant(variant.id, trx);
              await this.fulfillmentBacklog.wakeBacklogsWaitingForVariant(variant.id, trx);
              this.logger.log(`Variant ${variant.id} existing matching resolved with void strategy.`);
              created++;
              continue;
            }

            await trx.insert(wmsTables.productMatchings).values({
              variantId: variant.id,
              masterId: payload.masterId,
              status: 'matched',
              priority: 'normal',
              strategy: 'void',
              isResolved: true,
              preStockSellable: true,
              alwaysSellableZeroStock: false,
            });
            await this.productSellableQuantity.recalculateAndPublishForVariant(variant.id, trx);
            await this.fulfillmentBacklog.wakeBacklogsWaitingForVariant(variant.id, trx);
            this.logger.log(`Variant ${variant.id} is not inventory managed. Resolved with void strategy.`);
            created++;
            continue;
          }

          const [existing] = await trx
            .select()
            .from(wmsTables.productMatchings)
            .where(eq(wmsTables.productMatchings.variantId, variant.id))
            .limit(1);

          if (existing) {
            if (!Array.isArray(variant.components) || variant.components.length === 0 || existing.isResolved) {
              this.logger.log(`Variant ${variant.id} matching already exists, skipping.`);
              skipped++;
              continue;
            }

            await trx
              .delete(wmsTables.productVariantSkuLinks)
              .where(eq(wmsTables.productVariantSkuLinks.productMatchingId, existing.id));

            const mappings = await this.createVariantSkuMappingsFromComponents(
              variant.id,
              existing.id,
              variant.components,
              trx,
            );

            await trx
              .update(wmsTables.productMatchings)
              .set({
                masterId: payload.masterId,
                status: 'matched',
                priority: 'normal',
                strategy: 'variant',
                isResolved: true,
                preStockSellable: true,
                alwaysSellableZeroStock: false,
                updatedAt: new Date(),
              })
              .where(eq(wmsTables.productMatchings.id, existing.id));

            await this.productSellableQuantity.recalculateAndPublishForVariant(variant.id, trx);
            await this.fulfillmentBacklog.wakeBacklogsWaitingForVariant(variant.id, trx);
            this.logger.log(
              `Resolved existing matching for variant ${variant.id} with ${mappings.length} SKUs using variant strategy.`,
            );
            created++;
            continue;
          }

          if (!Array.isArray(variant.components) || variant.components.length === 0) {
            const [newProductMatching] = await trx
              .insert(wmsTables.productMatchings)
              .values({
                variantId: variant.id,
                masterId: payload.masterId,
                status: 'pending',
                priority: 'high',
                strategy: null,
                isResolved: false,
              })
              .returning();

            if (!newProductMatching) {
              throw new Error(`Product matching entry(pending) 생성에 실패했습니다. (variantId: ${variant.id})`);
            }

            await this.productSellableQuantity.recalculateAndPublishForVariant(variant.id, trx);
            this.logger.log(`Variant ${variant.id} requires manual SKU matching; created pending matching record.`);
            created++;
            continue;
          }

          const [newProductMatching] = await trx
            .insert(wmsTables.productMatchings)
            .values({
              variantId: variant.id,
              masterId: payload.masterId,
              status: 'matched',
              priority: 'normal',
              strategy: 'variant',
              isResolved: true,
              preStockSellable: true,
              alwaysSellableZeroStock: false,
            })
            .returning();

          if (!newProductMatching) {
            throw new Error(`Product matching entry(matched) 생성에 실패했습니다. (variantId: ${variant.id})`);
          }

          const mappings = await this.createVariantSkuMappingsFromComponents(
            variant.id,
            newProductMatching.id,
            variant.components,
            trx,
          );
          await this.productSellableQuantity.recalculateAndPublishForVariant(variant.id, trx);
          await this.fulfillmentBacklog.wakeBacklogsWaitingForVariant(variant.id, trx);

          this.logger.log(`Auto-matched variant ${variant.id} with ${mappings.length} SKUs using variant strategy.`);
          created++;
        } catch (error) {
          this.logger.error(`Failed to auto-match variant ${variant.id}:`, error);
          skipped++;
        }
      }

      this.logger.log(`Automatic matching request completed: ${created} created, ${skipped} skipped`);
      return { created, skipped };
    }, tx);
  }

  async getMatchings(params: ProductMatchingsQuery = {}, tx?: DbTx) {
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    return this.inTx(async (trx) => {
      const conditions: SQL<unknown>[] = [];
      if (params.status) {
        conditions.push(eq(wmsTables.productMatchings.status, params.status));
      }
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [{ total }] = await trx.select({ total: count() }).from(wmsTables.productMatchings).where(where);

      const rows = (await trx
        .select({
          id: wmsTables.productMatchings.id,
          variantId: wmsTables.productMatchings.variantId,
          masterId: wmsTables.productMatchings.masterId,
          status: wmsTables.productMatchings.status,
          priority: wmsTables.productMatchings.priority,
          strategy: wmsTables.productMatchings.strategy,
          preStockSellable: wmsTables.productMatchings.preStockSellable,
          alwaysSellableZeroStock: wmsTables.productMatchings.alwaysSellableZeroStock,
          createdAt: wmsTables.productMatchings.createdAt,
          updatedAt: wmsTables.productMatchings.updatedAt,
        })
        .from(wmsTables.productMatchings)
        .where(where)
        .orderBy(desc(wmsTables.productMatchings.updatedAt))
        .limit(limit)
        .offset(offset)) as ProductMatchingListRow[];

      const data = await this.hydrateMatchingRows(rows, trx);
      const totalPages = Math.ceil(total / limit);
      const page = Math.floor(offset / limit) + 1;

      return {
        data,
        total,
        page,
        limit,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      };
    }, tx);
  }

  async getLegacyIgnoredMatchings(params: Omit<ProductMatchingsQuery, 'status'> = {}, tx?: DbTx) {
    return this.getMatchings({ ...params, status: 'ignored' }, tx);
  }

  private async hydrateMatchingRows(rows: ProductMatchingListRow[], trx: DbTx) {
    if (rows.length === 0) {
      return [];
    }

    const matchingIds = rows.map((row) => row.id);
    const variantIds = [...new Set(rows.map((row) => row.variantId))];
    const masterIds = [...new Set(rows.map((row) => row.masterId).filter((id): id is string => Boolean(id)))];

    const skuLinks =
      matchingIds.length > 0
        ? await trx
            .select({
              productMatchingId: wmsTables.productVariantSkuLinks.productMatchingId,
              skuId: wmsTables.productVariantSkuLinks.skuId,
              quantity: wmsTables.productVariantSkuLinks.quantity,
              skuName: wmsTables.skus.name,
              skuCode: wmsTables.skus.code,
            })
            .from(wmsTables.productVariantSkuLinks)
            .leftJoin(wmsTables.skus, eq(wmsTables.productVariantSkuLinks.skuId, wmsTables.skus.id))
            .where(inArray(wmsTables.productVariantSkuLinks.productMatchingId, matchingIds))
        : [];

    const variants =
      variantIds.length > 0
        ? await (trx as any)
            .select({
              id: productVariants.id,
              variantName: productVariants.variantName,
              variantCode: productVariants.variantCode,
            })
            .from(productVariants)
            .where(inArray(productVariants.id, variantIds))
        : [];

    const masterVersions =
      masterIds.length > 0
        ? await (trx as any)
            .select({
              masterId: productMasterVersions.masterId,
              versionId: productMasterVersions.id,
              name: productMasterVersions.name,
              status: productMasterVersions.status,
              updatedAt: productMasterVersions.updatedAt,
              createdAt: productMasterVersions.createdAt,
            })
            .from(productMasterVersions)
            .where(and(inArray(productMasterVersions.masterId, masterIds), isNull(productMasterVersions.deletedAt)))
            .orderBy(desc(productMasterVersions.updatedAt), desc(productMasterVersions.createdAt))
        : [];

    const skuLinksByMatchingId = new Map<string, (typeof skuLinks)[number][]>();
    for (const link of skuLinks) {
      const links = skuLinksByMatchingId.get(link.productMatchingId) ?? [];
      links.push(link);
      skuLinksByMatchingId.set(link.productMatchingId, links);
    }

    const variantsById = new Map<string, (typeof variants)[number]>();
    for (const variant of variants) {
      variantsById.set(variant.id, variant);
    }

    const masterVersionByMasterId = new Map<string, (typeof masterVersions)[number]>();
    for (const version of masterVersions) {
      const current = masterVersionByMasterId.get(version.masterId);
      if (!current || (version.status === 'active' && current.status !== 'active')) {
        masterVersionByMasterId.set(version.masterId, version);
      }
    }

    return rows.map((row) => {
      const links = skuLinksByMatchingId.get(row.id) ?? [];
      const variant = variantsById.get(row.variantId);
      const masterVersion = row.masterId ? masterVersionByMasterId.get(row.masterId) : undefined;
      const variantName = variant?.variantName ?? variant?.variantCode ?? row.variantId;

      return {
        id: row.id,
        variantId: row.variantId,
        status: row.status,
        priority: row.priority,
        strategy: row.strategy ?? undefined,
        stockPolicy: {
          preStockSellable: row.preStockSellable,
          alwaysSellableZeroStock: row.alwaysSellableZeroStock,
        },
        isGift: false,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        skuLinkCount: links.length,
        hasSkuLinks: links.length > 0,
        matchedSkus: links.map((link) => ({
          skuId: link.skuId,
          skuName: link.skuName ?? undefined,
          skuCode: link.skuCode ?? undefined,
          quantity: link.quantity,
        })),
        links: links.map((link) => ({
          skuId: link.skuId,
          skuName: link.skuName ?? undefined,
          skuCode: link.skuCode ?? undefined,
          quantity: link.quantity,
        })),
        variant: {
          id: row.variantId,
          name: variantName,
          masterId: row.masterId ?? '',
        },
        master: row.masterId
          ? {
              id: row.masterId,
              name: masterVersion?.name ?? row.masterId,
            }
          : undefined,
      };
    });
  }

  async getOrderLines(
    params: {
      matchingStatus?: 'pending' | 'matched' | 'ignored' | 'unregistered';
      excludeMatched?: boolean;
      salesChannel?: string;
      startDate?: string;
      endDate?: string;
      keyword?: string;
      keywordType?: 'productName' | 'orderNumber' | 'customerName';
      limit?: number;
      offset?: number;
    },
    tx?: DbTx,
  ) {
    const { matchingStatus, excludeMatched, salesChannel, startDate, endDate, keyword, keywordType } = params;
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    return this.inTx(async (trx) => {
      const { salesOrderLines, salesOrders, productMatchings, productVariantSkuLinks, skus } = wmsTables;

      const conditions: SQL<unknown>[] = [];

      if (matchingStatus === 'unregistered') {
        conditions.push(isNull(productMatchings.id));
      } else if (matchingStatus) {
        conditions.push(eq(productMatchings.status, matchingStatus));
      } else if (excludeMatched) {
        const cond = or(
          isNull(productMatchings.id),
          ne(productMatchings.status, 'matched'),
          and(eq(productMatchings.status, 'matched'), isNull(productMatchings.strategy)),
          and(
            eq(productMatchings.status, 'matched'),
            eq(productMatchings.strategy, 'variant'),
            sql`NOT EXISTS (
              SELECT 1
              FROM ${productVariantSkuLinks}
              WHERE ${productVariantSkuLinks.productMatchingId} = ${productMatchings.id}
            )`,
          ),
        );
        if (cond) conditions.push(cond);
      }

      if (salesChannel) {
        conditions.push(eq(salesOrders.salesChannel, salesChannel as (typeof salesOrders.salesChannel)['_']['data']));
      }

      if (startDate) {
        conditions.push(gte(salesOrders.orderDate, new Date(startDate)));
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        conditions.push(lte(salesOrders.orderDate, end));
      }

      if (keyword) {
        if (keywordType === 'orderNumber') {
          conditions.push(ilike(salesOrders.channelOrderId, `%${keyword}%`));
        } else if (keywordType === 'customerName') {
          conditions.push(ilike(salesOrders.customerName, `%${keyword}%`));
        } else {
          conditions.push(ilike(salesOrderLines.productName, `%${keyword}%`));
        }
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [{ total }] = await trx
        .select({ total: count() })
        .from(salesOrderLines)
        .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
        .leftJoin(productMatchings, eq(salesOrderLines.variantId, productMatchings.variantId))
        .where(where);

      const rows = await trx
        .select({
          lineId: salesOrderLines.id,
          variantId: salesOrderLines.variantId,
          productName: salesOrderLines.productName,
          quantity: salesOrderLines.quantity,
          unitPrice: salesOrderLines.unitPrice,
          totalPrice: salesOrderLines.totalPrice,
          lineStatus: salesOrderLines.status,
          lineCreatedAt: salesOrderLines.createdAt,
          salesOrderId: salesOrders.id,
          channelOrderId: salesOrders.channelOrderId,
          salesChannel: salesOrders.salesChannel,
          customerName: salesOrders.customerName,
          customerPhone: salesOrders.customerPhone,
          orderDate: salesOrders.orderDate,
          matchingId: productMatchings.id,
          matchingStatus: productMatchings.status,
          matchingStrategy: productMatchings.strategy,
        })
        .from(salesOrderLines)
        .innerJoin(salesOrders, eq(salesOrderLines.salesOrderId, salesOrders.id))
        .leftJoin(productMatchings, eq(salesOrderLines.variantId, productMatchings.variantId))
        .where(where)
        .orderBy(desc(salesOrderLines.createdAt))
        .limit(limit)
        .offset(offset);

      if (rows.length === 0) {
        return { data: [], total, page: Math.floor(offset / limit) + 1, limit };
      }

      const matchingIds = rows.map((r) => r.matchingId).filter((id): id is string => id !== null);
      const skuLinks =
        matchingIds.length > 0
          ? await trx
              .select({
                productMatchingId: productVariantSkuLinks.productMatchingId,
                skuId: productVariantSkuLinks.skuId,
                quantity: productVariantSkuLinks.quantity,
                skuName: skus.name,
                skuCode: skus.code,
              })
              .from(productVariantSkuLinks)
              .innerJoin(skus, eq(productVariantSkuLinks.skuId, skus.id))
              .where(inArray(productVariantSkuLinks.productMatchingId, matchingIds))
          : [];

      const skusByMatchingId = new Map<string, (typeof skuLinks)[0][]>();
      for (const link of skuLinks) {
        if (!skusByMatchingId.has(link.productMatchingId)) {
          skusByMatchingId.set(link.productMatchingId, []);
        }
        skusByMatchingId.get(link.productMatchingId)!.push(link);
      }

      const data = rows.map((row) => ({
        id: row.lineId,
        variantId: row.variantId,
        productName: row.productName,
        quantity: row.quantity,
        unitPrice: row.unitPrice ?? undefined,
        totalPrice: row.totalPrice ?? undefined,
        salesOrderId: row.salesOrderId,
        channelOrderId: row.channelOrderId,
        salesChannel: row.salesChannel,
        customerName: row.customerName ?? undefined,
        customerPhone: row.customerPhone ?? undefined,
        orderDate: row.orderDate.toISOString(),
        matchingId: row.matchingId ?? undefined,
        matchingStatus: row.matchingStatus ?? undefined,
        matchingStrategy: row.matchingStrategy ?? undefined,
        matchedSkus: row.matchingId
          ? (skusByMatchingId.get(row.matchingId) ?? []).map((s) => ({
              skuId: s.skuId,
              skuName: s.skuName,
              skuCode: s.skuCode ?? undefined,
              quantity: s.quantity,
            }))
          : [],
      }));

      return { data, total, page: Math.floor(offset / limit) + 1, limit };
    }, tx);
  }

  async resolveMatchingPending(matchingId: string, resolveDto: ResolveMatchingDto, tx?: DbTx) {
    const {
      skuIds,
      skuMappings,
      ignore,
      resolveAsVoid,
      strategy = 'variant',
      stockPolicy,
      isGift = false,
    } = resolveDto;
    const hasSkuMappings = Boolean((skuIds && skuIds.length > 0) || (skuMappings && skuMappings.length > 0));

    const productMatching = await this.inTx(async (trx) => {
      const [row] = await trx
        .select()
        .from(wmsTables.productMatchings)
        .where(and(eq(wmsTables.productMatchings.id, matchingId), eq(wmsTables.productMatchings.isResolved, false)))
        .limit(1);
      return row;
    }, tx);

    if (!productMatching) {
      throw new NotFoundException(`Product matching with ID ${matchingId} not found or already resolved.`);
    }

    if (!ignore && (resolveAsVoid || strategy === 'void') && hasSkuMappings) {
      throw new BadRequestException('void strategy does not accept SKU mappings.');
    }

    if (ignore || resolveAsVoid || strategy === 'void') {
      return this.resolveMatchingAsVoid(matchingId, productMatching.variantId, stockPolicy, tx);
    } else if (hasSkuMappings) {
      return this.inTx(async (trx) => {
        let mappings: SkuQuantityMapping[];

        if (skuMappings && skuMappings.length > 0) {
          mappings = skuMappings.map((mapping) => ({
            skuId: mapping.skuId,
            quantity: mapping.quantity || 1,
          }));
        } else if (skuIds && skuIds.length > 0) {
          mappings = skuIds.map((skuId) => ({
            skuId,
            quantity: 1,
          }));
        } else {
          throw new BadRequestException('SKU 매핑 정보가 없습니다.');
        }

        const matchingStrategy = this.getStrategy(strategy);
        const context: MatchingContext = {
          variantId: productMatching.variantId,
          productMatchingId: productMatching.id,
        };

        const isValid = await matchingStrategy.validate(context, mappings);
        if (!isValid) {
          throw new BadRequestException('Invalid SKU mappings for the selected strategy');
        }

        await matchingStrategy.create(context, mappings, trx);

        const finalStockPolicy = {
          preStockSellable: stockPolicy?.preStockSellable ?? true,
          alwaysSellableZeroStock: stockPolicy?.alwaysSellableZeroStock ?? false,
        };

        const [updatedMatching] = await trx
          .update(wmsTables.productMatchings)
          .set({
            status: 'matched',
            strategy: strategy,
            isResolved: true,
            ...finalStockPolicy,
            updatedAt: new Date(),
          })
          .where(eq(wmsTables.productMatchings.id, matchingId))
          .returning();

        this.logger.log(
          `Product matching ${matchingId} resolved as 'matched' with ${strategy} strategy. ` +
            `SKUs: ${mappings.length}, Stock Policy: ${JSON.stringify(finalStockPolicy)}`,
        );
        await this.productSellableQuantity.recalculateAndPublishForVariant(productMatching.variantId, trx);
        await this.fulfillmentBacklog.wakeBacklogsWaitingForVariant(productMatching.variantId, trx);
        return updatedMatching;
      }, tx);
    } else {
      throw new BadRequestException('매칭할 SKU 정보를 제공하거나, void 전략으로 해소해야 합니다.');
    }
  }

  private async resolveMatchingAsVoid(matchingId: string, variantId: string, stockPolicy?: StockPolicyDto, tx?: DbTx) {
    const finalStockPolicy = {
      preStockSellable: stockPolicy?.preStockSellable ?? true,
      alwaysSellableZeroStock: stockPolicy?.alwaysSellableZeroStock ?? false,
    };

    return this.inTx(async (trx) => {
      const [updatedMatching] = await trx
        .update(wmsTables.productMatchings)
        .set({
          status: 'matched',
          strategy: 'void',
          isResolved: true,
          ...finalStockPolicy,
          updatedAt: new Date(),
        })
        .where(eq(wmsTables.productMatchings.id, matchingId))
        .returning();

      this.logger.log(
        `Product matching ${matchingId} resolved as 'matched' with void strategy. ` +
          `Stock Policy: ${JSON.stringify(finalStockPolicy)}`,
      );
      await this.productSellableQuantity.recalculateAndPublishForVariant(variantId, trx);
      await this.fulfillmentBacklog.wakeBacklogsWaitingForVariant(variantId, trx);
      return updatedMatching;
    }, tx);
  }

  async resolveLegacyIgnoredMatching(
    matchingId: string,
    dto: ResolveLegacyIgnoredMatchingDto,
    auditContext?: AuditContext,
    tx?: DbTx,
  ) {
    return this.inTx(async (trx) => {
      const [productMatching] = await trx
        .select()
        .from(wmsTables.productMatchings)
        .where(eq(wmsTables.productMatchings.id, matchingId))
        .limit(1);

      if (!productMatching) {
        throw new NotFoundException(`Product matching with ID ${matchingId} not found.`);
      }

      if (productMatching.status !== 'ignored') {
        throw new BadRequestException(`Product matching ${matchingId} is not a legacy ignored matching.`);
      }

      const existingLinks = await trx
        .select({
          skuId: wmsTables.productVariantSkuLinks.skuId,
          quantity: wmsTables.productVariantSkuLinks.quantity,
        })
        .from(wmsTables.productVariantSkuLinks)
        .where(eq(wmsTables.productVariantSkuLinks.productMatchingId, matchingId));

      if (existingLinks.length > 0) {
        await trx
          .delete(wmsTables.productVariantSkuLinks)
          .where(eq(wmsTables.productVariantSkuLinks.productMatchingId, matchingId));
      }

      const now = new Date();
      const nextState =
        dto.target === 'pending'
          ? {
              status: 'pending' as const,
              strategy: null,
              isResolved: false,
              updatedAt: now,
            }
          : {
              status: 'matched' as const,
              strategy: 'void' as const,
              isResolved: true,
              preStockSellable: dto.stockPolicy?.preStockSellable ?? productMatching.preStockSellable,
              alwaysSellableZeroStock:
                dto.stockPolicy?.alwaysSellableZeroStock ?? productMatching.alwaysSellableZeroStock,
              updatedAt: now,
            };

      const [updatedMatching] = await trx
        .update(wmsTables.productMatchings)
        .set(nextState)
        .where(eq(wmsTables.productMatchings.id, matchingId))
        .returning();

      await this.auditService.log(
        {
          eventType: 'USER_ACTION',
          severity: 'INFO',
          action: `legacy_ignored_to_${dto.target}`,
          module: 'product-matching',
          resourceType: 'product_matching',
          resourceId: matchingId,
          resourceName: productMatching.variantId,
          description: `Legacy ignored product matching ${matchingId} resolved to ${dto.target}`,
          changesBefore: {
            status: productMatching.status,
            strategy: productMatching.strategy,
            isResolved: productMatching.isResolved,
            preStockSellable: productMatching.preStockSellable,
            alwaysSellableZeroStock: productMatching.alwaysSellableZeroStock,
            skuLinks: existingLinks,
          },
          changesAfter: {
            status: updatedMatching.status,
            strategy: updatedMatching.strategy,
            isResolved: updatedMatching.isResolved,
            preStockSellable: updatedMatching.preStockSellable,
            alwaysSellableZeroStock: updatedMatching.alwaysSellableZeroStock,
            skuLinks: [],
          },
          metadata: {
            target: dto.target,
            variantId: productMatching.variantId,
            masterId: productMatching.masterId,
            removedSkuLinkCount: existingLinks.length,
          },
        },
        auditContext,
        trx,
      );

      await this.productSellableQuantity.recalculateAndPublishForVariant(productMatching.variantId, trx);
      if (dto.target === 'void') {
        await this.fulfillmentBacklog.wakeBacklogsWaitingForVariant(productMatching.variantId, trx);
      }

      this.logger.log(`Legacy ignored product matching ${matchingId} resolved to ${dto.target}.`);
      return updatedMatching;
    }, tx);
  }

  async setMatchingPriority(matchingId: string, priority: 'normal' | 'high', tx?: DbTx) {
    const [updatedMatching] = await this.inTx(
      async (trx) =>
        trx
          .update(wmsTables.productMatchings)
          .set({ priority, updatedAt: new Date() })
          .where(and(eq(wmsTables.productMatchings.id, matchingId), eq(wmsTables.productMatchings.isResolved, false)))
          .returning(),
      tx,
    ).then((r) => r);

    if (!updatedMatching) {
      throw new NotFoundException(`Product matching with ID ${matchingId} not found or already resolved.`);
    }

    this.logger.log(`Product matching ${matchingId} 우선순위 설정됨: ${priority}.`);
    return updatedMatching;
  }

  async handleVariantDeletion(variantId: string, tx?: DbTx) {
    this.logger.log(`Handling variant deletion for variantId: ${variantId}`);

    const productMatching = await this.inTx(async (trx) => {
      const [row] = await trx
        .select()
        .from(wmsTables.productMatchings)
        .where(eq(wmsTables.productMatchings.variantId, variantId))
        .limit(1);
      return row;
    }, tx);

    if (!productMatching) {
      this.logger.warn(`No product matching found for variantId: ${variantId}, nothing to delete.`);
      return;
    }

    if (productMatching.status === 'matched' && productMatching.strategy) {
      await this.inTx(async (trx) => {
        if (!productMatching.strategy) {
          throw new BadRequestException('strategy 값이 null입니다.');
        }
        const strategy = this.getStrategy(productMatching.strategy);
        const context: MatchingContext = {
          variantId: productMatching.variantId,
          productMatchingId: productMatching.id,
        };
        await strategy.delete(context, trx);
        await trx.delete(wmsTables.productMatchings).where(eq(wmsTables.productMatchings.id, productMatching.id));
        await this.productSellableQuantity.recalculateAndPublishForVariant(variantId, trx);
        this.logger.log(
          `Deleted product matching and links for variantId: ${variantId} using ${productMatching.strategy} strategy`,
        );
      }, tx);
    } else {
      await this.inTx(async (trx) => {
        await trx.delete(wmsTables.productMatchings).where(eq(wmsTables.productMatchings.id, productMatching.id));
        await this.productSellableQuantity.recalculateAndPublishForVariant(variantId, trx);
      }, tx);
      this.logger.log(`Deleted ${productMatching.status} product matching for variantId: ${variantId}`);
    }
  }

  async createNewSkuForMatching(
    variantId: string,
    skuData: {
      name: string;
      inventoryManagement: boolean;
      alwaysSellableZeroStock?: boolean;
      skuGroupId?: string;
    },
    tx?: DbTx,
  ) {
    return this.inTx(async (trx) => {
      const productMatching = await trx.query.productMatchings.findFirst({
        where: eq(wmsTables.productMatchings.variantId, variantId),
      });

      if (!productMatching) {
        throw new NotFoundException(`No product matching found for variant: ${variantId}`);
      }

      const newSku = await this.skuCatalogService.create(
        {
          name: skuData.name,
          source: SkuCreationSource.MANUAL_MATCHING,
          ...(skuData.skuGroupId && { skuGroupId: skuData.skuGroupId }),
          ...(productMatching.skuGroupId && !skuData.skuGroupId && { skuGroupId: productMatching.skuGroupId }),
        },
        trx,
      );

      if (skuData.inventoryManagement) {
        const warehouseId = this.warehouseService.getDefaultId();
        await this.stockEventService.createStockEntryBySkuId(
          {
            skuId: newSku.id,
            variantId,
            warehouseId,
            quantity: 0,
            stockType: 'physical',
            reason: `manual_matching_for_variant_${variantId}`,
          },
          trx,
        );
      }

      return newSku;
    }, tx);
  }

  async changeMatchingStrategy(matchingId: string, newStrategy: 'void' | 'variant', tx?: DbTx) {
    const productMatching = await this.inTx(async (trx) => {
      const [row] = await trx
        .select()
        .from(wmsTables.productMatchings)
        .where(eq(wmsTables.productMatchings.id, matchingId))
        .limit(1);
      return row;
    }, tx);

    if (!productMatching) {
      throw new NotFoundException(`Product matching with ID ${matchingId} not found.`);
    }

    if (productMatching.status !== 'matched') {
      throw new BadRequestException('Can only change strategy for matched products');
    }

    await this.inTx(async (trx) => {
      if (productMatching.strategy) {
        const oldStrategy = this.getStrategy(productMatching.strategy);
        const context: MatchingContext = {
          variantId: productMatching.variantId,
          productMatchingId: productMatching.id,
        };
        await oldStrategy.delete(context, trx);
      }

      await trx
        .update(wmsTables.productMatchings)
        .set({ strategy: newStrategy, updatedAt: new Date() })
        .where(eq(wmsTables.productMatchings.id, matchingId));

      await this.productSellableQuantity.recalculateAndPublishForVariant(productMatching.variantId, trx);

      this.logger.log(`Changed matching strategy for ${matchingId} from ${productMatching.strategy} to ${newStrategy}`);
    }, tx);
  }

  async getSkusForVariant(
    variantId: string,
    selectedOptions?: Array<{ optionName: string; optionValue: string }>,
    tx?: DbTx,
  ): Promise<SkuQuantityMapping[]> {
    const productMatching = await this.inTx(async (trx) => {
      const [row] = await trx
        .select()
        .from(wmsTables.productMatchings)
        .where(
          and(eq(wmsTables.productMatchings.variantId, variantId), eq(wmsTables.productMatchings.status, 'matched')),
        )
        .limit(1);
      return row;
    }, tx);

    if (!productMatching || !productMatching.strategy) {
      throw new NotFoundException(`No matched product found for variant ${variantId}`);
    }

    const strategy = this.getStrategy(productMatching.strategy);
    const context: MatchingContext = {
      variantId: productMatching.variantId,
      productMatchingId: productMatching.id,
      optionData: selectedOptions,
    };

    return strategy.lookup(context);
  }

  async getStockPolicyForVariant(
    variantId: string,
    tx?: DbTx,
  ): Promise<{
    preStockSellable: boolean;
    alwaysSellableZeroStock: boolean;
    availabilityOverride: 'manual_out_of_stock' | null;
  } | null> {
    const { matching, policy } = await this.inTx(async (trx) => {
      const [row] = await trx
        .select()
        .from(wmsTables.productMatchings)
        .where(eq(wmsTables.productMatchings.variantId, variantId))
        .limit(1);
      const [policyRow] = await trx
        .select({
          variantId: wmsTables.salesVariantPolicies.variantId,
          preStockSellable: wmsTables.salesVariantPolicies.preStockSellable,
          alwaysSellableZeroStock: wmsTables.salesVariantPolicies.alwaysSellableZeroStock,
          availabilityOverride: wmsTables.salesVariantPolicies.availabilityOverride,
        })
        .from(wmsTables.salesVariantPolicies)
        .where(eq(wmsTables.salesVariantPolicies.variantId, variantId))
        .limit(1);
      return { matching: row, policy: policyRow };
    }, tx);

    if (!matching && !policy) {
      return null;
    }

    return {
      preStockSellable: matching?.preStockSellable ?? policy?.preStockSellable ?? false,
      alwaysSellableZeroStock: matching?.alwaysSellableZeroStock ?? policy?.alwaysSellableZeroStock ?? false,
      availabilityOverride: policy?.availabilityOverride ?? null,
    };
  }

  async updateStockPolicy(matchingId: string, stockPolicy: StockPolicyDto, tx?: DbTx) {
    const [updated] = await this.inTx(async (trx) => {
      const matchingPolicyPatch = {
        ...(stockPolicy.preStockSellable !== undefined ? { preStockSellable: stockPolicy.preStockSellable } : {}),
        ...(stockPolicy.alwaysSellableZeroStock !== undefined
          ? { alwaysSellableZeroStock: stockPolicy.alwaysSellableZeroStock }
          : {}),
        updatedAt: new Date(),
      };

      const [updatedMatching] = await trx
        .update(wmsTables.productMatchings)
        .set(matchingPolicyPatch)
        .where(eq(wmsTables.productMatchings.id, matchingId))
        .returning();

      if (!updatedMatching) {
        return [updatedMatching];
      }

      const now = new Date();
      const variantPolicyValues = {
        variantId: updatedMatching.variantId,
        inventoryManagement: true,
        preStockSellable: stockPolicy.preStockSellable ?? updatedMatching.preStockSellable,
        alwaysSellableZeroStock: stockPolicy.alwaysSellableZeroStock ?? updatedMatching.alwaysSellableZeroStock,
        availabilityOverride: stockPolicy.availabilityOverride ?? null,
        updatedAt: now,
      };

      await trx
        .insert(wmsTables.salesVariantPolicies)
        .values(variantPolicyValues)
        .onConflictDoUpdate({
          target: wmsTables.salesVariantPolicies.variantId,
          set: {
            inventoryManagement: true,
            preStockSellable: variantPolicyValues.preStockSellable,
            alwaysSellableZeroStock: variantPolicyValues.alwaysSellableZeroStock,
            availabilityOverride: variantPolicyValues.availabilityOverride,
            updatedAt: now,
          },
        });

      return [updatedMatching];
    }, tx);

    if (!updated) {
      throw new NotFoundException(`Product matching with ID ${matchingId} not found.`);
    }

    this.logger.log(`Updated stock policy for matching ${matchingId}: ${JSON.stringify(stockPolicy)}`);
    await this.productSellableQuantity.recalculateAndPublishForVariant(updated.variantId, tx);
    return updated;
  }
}
