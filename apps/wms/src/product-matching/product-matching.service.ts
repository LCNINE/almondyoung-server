// apps/wms/src/product-matching/product-matching.service.ts
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables } from '../../database/schemas/wms-schema';
import { TypedDatabase, DbService } from '@app/db';
import { and, eq, like } from 'drizzle-orm';
import { SkuService } from '../sku/sku.service';
import { StockService } from '../stock/stock.service';
import { WarehouseService } from '../warehouse/warehouse.service';
import { ResolveMatchingDto } from './dto/resolve-matching.dto';
import { SkuCreationSource } from '../sku/dto/create-sku.dto';
import { MatchingStrategy, MatchingContext, SkuQuantityMapping } from './strategies/matching-strategy.interface';
import { VoidMatchingStrategy } from './strategies/void-matching.strategy';
import { VariantMatchingStrategy } from './strategies/variant-matching.strategy';
import { OptionMatchingStrategy } from './strategies/option-matching.strategy';

// 일단 임시로
interface PimSkuComponent {
  skuName: string;
  // 여기에 바코드, 공급사 정보 등
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
    @InjectTypedDb<typeof wmsTables>() private readonly dbService: DbService<typeof wmsTables>,
    private readonly skuService: SkuService,
    private readonly stockService: StockService,
    private readonly warehouseService: WarehouseService,
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

  // PIM에서 판매상품 생성 이벤트 수신 시 
  // 매칭 대기(pending) 상태만 생성. SKU/Stock은 생성하지 않음
  async handleManualMatchingRequest(payload: PimProductPayload) {
    this.logger.log(`Creating manual matching request from PIM event for product ID: ${payload.productId}`);

    for (const variant of payload.variants) {
      const existingMatching = await this.db.query.productMatchings.findFirst({
        where: eq(wmsTables.productMatchings.variantId, variant.id),
      });

      if (existingMatching) {
        this.logger.warn(`Product matching already exists for variant ${variant.id}, skipping creation.`);
        continue;
      }

      const [newProductMatching] = await this.db.insert(wmsTables.productMatchings).values({
        variantId: variant.id,
        status: 'pending',
        priority: 'high',
        strategy: null, // 아직 전략 미결정
        isResolved: false,
      }).returning();

      if (!newProductMatching) {
        throw new Error('Product matching entry(pending) 생성에 실패했습니다.');
      }
      this.logger.log(`Product matching pending created for variant ${variant.id}, matchingId: ${newProductMatching.id}`);
      // TODO: 알림 서비스에 이벤트 발행 (priority: 'high'인 경우)
    }
  }

  // PIM에서 상품 "자동 매칭" 이벤트 수신 시
  // inventoryManagement=true 이면 SKU/Stock(qty 0)을 자동 생성하고, 즉시 'matched' 상태로 처리
  async handleAutomaticMatchingRequest(payload: PimProductPayload) {
    this.logger.log(`Handling automatic matching from PIM event for product ID: ${payload.productId}`);

    for (const variant of payload.variants) {
      // 1. 재고 관리 대상이 아니면 무시(ignored) 상태로 처리
      if (!variant.inventoryManagement) {
        await this.db.insert(wmsTables.productMatchings).values({
          variantId: variant.id,
          status: 'ignored',
          priority: 'normal',
          strategy: 'void',
          isResolved: true,
        }).onConflictDoNothing();
        this.logger.log(`Variant ${variant.id} is not inventory managed. Marked as ignored with void strategy.`);
        continue;
      }

      // 트랜잭션 시작: variant 하나에 대한 매칭/SKU/Stock/Link 생성
      await this.db.transaction(async (tx) => {
        // 2. product_matchings 테이블에 row 생성 (variant 단위, 'matched' 상태)
        const [newProductMatching] = await tx.insert(wmsTables.productMatchings).values({
          variantId: variant.id,
          status: 'matched',
          priority: 'normal',
          strategy: 'variant', // 기본적 variant 사용
          isResolved: true,
        }).returning();

        if (!newProductMatching) {
          throw new Error(`Product matching entry(matched) 생성에 실패했습니다. (variantId: ${variant.id})`);
        }

        // 3. Variant를 구성하는 각 SKU Component에 대해 SKU, Stock, Link 생성 
        const warehouseId = this.warehouseService.getDefaultWarehouseId();
        const strategy = this.getStrategy('variant');
        const mappings: SkuQuantityMapping[] = [];

        for (const component of variant.components) {
          const newStock = await this.stockService.createStockEntry({
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

  // 매칭 대기 목록 조회
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

  // 매칭 대기 해소
  async resolveMatchingPending(matchingId: string, resolveDto: ResolveMatchingDto) {
    const { skuIds, skuMappings, ignore, strategy = 'variant' } = resolveDto;

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
        updatedAt: new Date(),
      }).where(eq(wmsTables.productMatchings.id, matchingId)).returning();
      this.logger.log(`Product matching ${matchingId} resolved as 'ignored' with void strategy.`);
      return updatedMatching;

    } else if ((skuIds && skuIds.length > 0) || (skuMappings && skuMappings.length > 0)) {

      return this.db.transaction(async (tx) => {
        let mappings: SkuQuantityMapping[];

        // skuMappings가 제공된 경우 (수량 지정)
        if (skuMappings && skuMappings.length > 0) {
          mappings = skuMappings.map(mapping => ({
            skuId: mapping.skuId,
            quantity: mapping.quantity || 1
          }));
          this.logger.log(`Using provided SKU mappings with quantities: ${JSON.stringify(mappings)}`);
        }
        // skuIds만 제공된 경우 (기본 수량 1)
        else if (skuIds && skuIds.length > 0) {
          mappings = skuIds.map(skuId => ({
            skuId,
            quantity: 1
          }));
          this.logger.log(`Using SKU IDs with default quantity 1: ${JSON.stringify(mappings)}`);
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

        const [updatedMatching] = await tx.update(wmsTables.productMatchings).set({
          status: 'matched',
          strategy: strategy,
          isResolved: true,
          updatedAt: new Date(),
        }).where(eq(wmsTables.productMatchings.id, matchingId)).returning();

        const totalSkus = mappings.length;
        const totalQuantity = mappings.reduce((sum, m) => sum + m.quantity, 0);
        this.logger.log(`Product matching ${matchingId} resolved as 'matched' with ${strategy} strategy. SKUs: ${totalSkus}, Total Quantity: ${totalQuantity}`);
        return updatedMatching;
      });
    } else {
      throw new BadRequestException('매칭할 SKU 정보를 제공하거나, 무시 옵션을 선택해야 합니다.');
    }
  }

  // 매칭 우선순위 설정
  async setMatchingPriority(matchingId: string, priority: 'normal' | 'high') {
    const [updatedMatching] = await this.db.update(wmsTables.productMatchings)
      .set({
        priority: priority,
        updatedAt: new Date(),
      })
      .where(and(
        eq(wmsTables.productMatchings.id, matchingId),
        eq(wmsTables.productMatchings.isResolved, false) // 아직 해결되지 않은 매칭만
      ))
      .returning();

    if (!updatedMatching) {
      throw new NotFoundException(`Product matching with ID ${matchingId} not found or already resolved.`);
    }

    this.logger.log(`Product matching ${matchingId} 우선순위 설정됨: ${priority}.`);
    return updatedMatching;
  }

  // Variant 삭제 처리
  async handleVariantDeletion(variantId: string) {
    this.logger.log(`Handling variant deletion for variantId: ${variantId}`);

    const productMatching = await this.db.query.productMatchings.findFirst({
      where: eq(wmsTables.productMatchings.variantId, variantId),
    });

    if (!productMatching) {
      this.logger.warn(`No product matching found for variantId: ${variantId}, nothing to delete.`);
      return;
    }

    // 매칭된 상태인 경우에만 매칭 데이터 삭제
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

  // 수동 매칭 시 새 SKU 생성
  async createNewSkuForMatching(variantId: string, skuData: {
    name: string;
    inventoryManagement: boolean;
    alwaysSellableZeroStock?: boolean;
  }) {
    return this.db.transaction(async (tx) => {
      const newSku = await this.skuService._createSkuInternal({
        name: skuData.name,
        inventoryManagement: skuData.inventoryManagement,
        alwaysSellableZeroStock: skuData.alwaysSellableZeroStock,
        source: SkuCreationSource.MANUAL_MATCHING,
      }, tx);

      if (skuData.inventoryManagement) {
        const warehouseId = this.warehouseService.getDefaultWarehouseId();
        await this.stockService.createStockEntry({
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

  // 옵션별 매칭

  // 매칭 전략 변경
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

  // 옵션별 매칭 생성/업데이트
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

  // 특정 variant의 SKU 조합 조회 (주문 처리 시 사용)
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
}