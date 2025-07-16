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

  constructor(
    @InjectTypedDb<typeof wmsTables>() private readonly dbService: DbService<typeof wmsTables>,
    private readonly skuService: SkuService,
    private readonly stockService: StockService,
    private readonly warehouseService: WarehouseService,
  ) { }

  private get db() {
    return this.dbService.db;
  }

  //  PIM에서 판매상품 생성 이벤트 수신 시 (수동 매칭)
  //  단순히 매칭 대기(pending) 상태만 생성. SKU/Stock은 생성하지 않음
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
        priority: 'high', // 수동 처리 필요하므로 우선순위 'high'
        isResolved: false,
      }).returning();

      if (!newProductMatching) {
        throw new Error('Product matching entry(pending) 생성에 실패했습니다.');
      }
      this.logger.log(`Product matching pending created for variant ${variant.id}, matchingId: ${newProductMatching.id}`);
      // TODO: 알림 서비스에 이벤트 발행 (priority: 'high'인 경우)
    }
  }

  //  PIM에서 상품 "자동 매칭" 이벤트 수신 시
  //  inventoryManagement=true 이면 SKU/Stock(qty 0)을 자동 생성하고, 즉시 'matched' 상태로 처리
  async handleAutomaticMatchingRequest(payload: PimProductPayload) {
    this.logger.log(`Handling automatic matching from PIM event for product ID: ${payload.productId}`);

    for (const variant of payload.variants) {
      // 1. 재고 관리 대상이 아니면 무시(ignored) 상태로 처리하고 넘어갑니다.
      if (!variant.inventoryManagement) {
        await this.db.insert(wmsTables.productMatchings).values({
          variantId: variant.id,
          status: 'ignored',
          priority: 'normal',
          isResolved: true, // 즉시 해결됨으로 처리
        }).onConflictDoNothing();
        this.logger.log(`Variant ${variant.id} is not inventory managed. Marked as ignored.`);
        continue;
      }

      // 트랜잭션 시작: variant 하나에 대한 매칭/SKU/Stock/Link 생성을
      await this.db.transaction(async (tx) => {
        // 2. product_matchings 테이블에 row 생성 (variant 단위, 'matched' 상태)
        const [newProductMatching] = await tx.insert(wmsTables.productMatchings).values({
          variantId: variant.id,
          status: 'matched',
          priority: 'normal',
          isResolved: true, // 자동 매칭이므로 즉시 해결
        }).returning();

        if (!newProductMatching) {
          throw new Error(`Product matching entry(matched) 생성에 실패했습니다. (variantId: ${variant.id})`);
        }

        // 3. Variant를 구성하는 각 SKU Component에 대해 SKU, Stock, Link 생성 (M:N 처리)
        const warehouseId = this.warehouseService.getDefaultWarehouseId(); // 기본 국내 창고

        for (const component of variant.components) {
          // 3-1. StockService를 통해 SKU 및 Stock(수량 0) 생성
          const newStock = await this.stockService.createStockEntry({
            variantId: variant.id,
            skuName: component.skuName,
            inventoryManagement: true,
            warehouseId,
            quantity: 0,
            stockType: 'physical',
            reason: `auto_matching_for_variant_${variant.id}`,
          }, tx);

          // 3-2. productVariantSkuLinks에 매핑 추가
          await tx.insert(wmsTables.productVariantSkuLinks).values({
            productMatchingId: newProductMatching.id,
            skuId: newStock.skuId,
          });
        }
        this.logger.log(`Auto-matched variant ${variant.id} with ${variant.components.length} SKUs.`);
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
    return matchings;
  }

  //  매칭 대기 해소 (SKU와 매칭 또는 무시)
  async resolveMatchingPending(matchingId: string, resolveDto: ResolveMatchingDto) {
    const { skuIds, ignore } = resolveDto;

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
      // 무시 처리
      const [updatedMatching] = await this.db.update(wmsTables.productMatchings).set({
        status: 'ignored',
        isResolved: true,
        updatedAt: new Date(),
      }).where(eq(wmsTables.productMatchings.id, matchingId)).returning();
      this.logger.log(`Product matching ${matchingId} resolved as 'ignored'.`);
      return updatedMatching;

    } else if (skuIds && skuIds.length > 0) {
      // SKU 연결 처리 (트랜잭션)
      return this.db.transaction(async (tx) => {
        for (const skuId of skuIds) {
          // 1. 연결할 SKU 유효성 검증
          const skuToLink = await this.skuService.findSkuById(skuId);
          if (!skuToLink) {
            throw new NotFoundException(`SKU with ID ${skuId} not found in WMS.`);
          }
          if (!skuToLink.inventoryManagement) {
            throw new BadRequestException(`SKU ${skuToLink.id} is not inventory managed.`);
          }

          // 2. productVariantSkuLinks에 매핑 추가 (ON CONFLICT DO NOTHING으로 중복 방지)
          await tx.insert(wmsTables.productVariantSkuLinks).values({
            productMatchingId: productMatching.id,
            skuId: skuId,
          }).onConflictDoNothing();

          this.logger.log(`Linked SKU ${skuId} to productMatching ${productMatching.id}.`);
        }

        // 3. product_matchings 테이블 업데이트
        const [updatedMatching] = await tx.update(wmsTables.productMatchings).set({
          status: 'matched',
          isResolved: true,
          updatedAt: new Date(),
        }).where(eq(wmsTables.productMatchings.id, matchingId)).returning();

        this.logger.log(`Product matching ${matchingId} resolved as 'matched' with ${skuIds.length} SKUs.`);
        return updatedMatching;
      });
    } else {
      throw new BadRequestException('매칭할 SKU ID 목록을 제공하거나, 무시 옵션을 선택해야 합니다.');
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
    if (productMatching.status === 'matched') {
      await this.db.transaction(async (tx) => {
        // 1. productVariantSkuLinks 삭제
        await tx.delete(wmsTables.productVariantSkuLinks)
          .where(eq(wmsTables.productVariantSkuLinks.productMatchingId, productMatching.id));

        // 2. productMatchings 삭제
        await tx.delete(wmsTables.productMatchings)
          .where(eq(wmsTables.productMatchings.id, productMatching.id));

        this.logger.log(`Deleted product matching and links for variantId: ${variantId}`);
      });
    } else {
      // pending이나 ignored 상태인 경우도 삭제
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
      // SKU 생성
      const newSku = await this.skuService._createSkuInternal({
        name: skuData.name,
        inventoryManagement: skuData.inventoryManagement,
        alwaysSellableZeroStock: skuData.alwaysSellableZeroStock,
        source: SkuCreationSource.MANUAL_MATCHING,
      }, tx);

      // Stock 생성 (재고 0으로)
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
}