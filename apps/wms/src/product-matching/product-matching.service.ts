import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables } from '../../database/schemas/wms-schema';
import { TypedDatabase } from '@app/db';
// import { InjectEventPublisher, TypedEventPattern } from '@app/events/decorators';
// import { EventPublisherService } from '@app/events';
import { and, eq, isNull, like } from 'drizzle-orm';
import { SkuService } from '../sku/sku.service';
import { StockService } from '../stock/stock.service';

@Injectable()
export class ProductMatchingService {
  private readonly logger = new Logger(ProductMatchingService.name);

  constructor(
    @InjectTypedDb<typeof wmsTables>() private readonly db: TypedDatabase<typeof wmsTables>,
    private readonly skuService: SkuService,
    private readonly stockService: StockService,
  ) { }

  // PIM 이벤트 수신 핸들러

  // PIM에서 상품이 생성되었을 때 (판매등록)
  // @TypedEventPattern<typeof PIM_EVENTS, 'product.created'>('product.created')
  // async handlePimProductCreated(payload: ProductCreatedPayload, @Payload() message: KafkaMessage) {
  //   
  //   await this.createProductMatchingFromPimEvent(payload);
  // }

  // PIM 이벤트로부터 Product Matching 생성 (테스트용으로 사용)
  async createProductMatchingFromPimEvent(payload: any) {
    this.logger.log(`Creating product matching from PIM event for product ID: ${payload.productId}`);

    for (const variant of payload.variants) {
      // 1. product_matchings 테이블에 row 생성 (variant_id 단위)
      const existingMatching = await this.db.query.productMatchings.findFirst({
        where: eq(wmsTables.productMatchings.variantId, variant.id),
      });

      if (existingMatching) {
        this.logger.warn(`Product matching already exists for variant ${variant.id}, skipping creation.`);
        continue;
      }

      const [newProductMatching] = await this.db.insert(wmsTables.productMatchings).values({
        variantId: variant.id,
        status: 'pending', // 기본 상태는 'pending'
        priority: 'high', // 이미지 플로우에 따라 초기 priority는 high
        isResolved: false,
      }).returning();

      if (!newProductMatching) {
        throw new Error('Product matching entry 생성에 실패했습니다.');
      }
      this.logger.log(`Product matching pending created for variant ${variant.id}, matchingId: ${newProductMatching.id}`);

      // 3. [자동매칭 시나리오] inventoryManagement=true인 경우, 즉시 stock/sku 생성 (수량 0으로)
      if (variant.inventoryManagement) {
        try {
          // StockService의 createStockEntry 호출 (quantity 0으로)
          await this.stockService.createStockEntry({
            variantId: variant.id,
            skuName: variant.name || payload.name, // SKU 이름
            warehouseId: 'DEFAULT_WAREHOUSE_ID', // TODO: 적절한 기본 창고 ID 설정 필요
            quantity: 0, // 판매등록 시 재고는 0으로 생성
            stockType: 'physical', // 물리 재고로 가정
            reason: 'auto_matching_registration',
            orderId: undefined, // 판매등록이므로 주문과 직접 관련 없음
          });
          this.logger.log(`Auto-matched SKU and Stock (qty 0) created for variant ${variant.id}.`);

        } catch (error) {
          this.logger.error(`Failed to auto-create SKU/Stock for variant ${variant.id}: ${error.message}`, error.stack);
        }
      } else {
        // inventoryManagement=false인 경우, stock/sku 생성 안 함
        this.logger.log(`Variant ${variant.id} is not inventory managed. No SKU or Stock created.`);
      }
    }
  }

  // PIM에서 상품이 업데이트되었을 때
  // @TypedEventPattern<typeof PIM_EVENTS, 'product.updated'>('product.updated')
  // async handlePimProductUpdated(payload: ProductUpdatedPayload, @Payload() message: KafkaMessage) {
  //   await this.updateProductMatchingFromPimEvent(payload);
  // }

  // PIM 이벤트로부터 Product Matching 업데이트 (테스트용으로 사용)
  async updateProductMatchingFromPimEvent(payload: any) {
    this.logger.log(`Updating product matching from PIM event for product ID: ${payload.productId}`);

    for (const variant of payload.variants) {
      const productMatching = await this.db.query.productMatchings.findFirst({
        where: eq(wmsTables.productMatchings.variantId, variant.id),
      });

      if (!productMatching) {
        this.logger.warn(`No product matching found for variant ${variant.id}. Skipping update.`);
        continue;
      }

      // product_matchings 업데이트
      const updateData: Partial<typeof wmsTables.productMatchings.$inferInsert> = {
        updatedAt: new Date(),
      };

      const [updatedMatching] = await this.db.update(wmsTables.productMatchings)
        .set(updateData)
        .where(eq(wmsTables.productMatchings.id, productMatching.id))
        .returning();

      if (updatedMatching) {
        this.logger.log(`Product matching ${updatedMatching.id} updated for variant ${variant.id}.`);
      }
    }
  }

  // PIM에서 상품이 삭제되었을 때
  // @TypedEventPattern<typeof PIM_EVENTS, 'product.deleted'>('product.deleted')
  // async handlePimProductDeleted(payload: ProductDeletedPayload, @Payload() message: KafkaMessage) {
  //   this.logger.log(`Received PIM product.deleted event for product ID: ${payload.productId}`, { correlationId: payload.correlationId });

  //   const [deletedMatching] = await this.db.update(wmsTables.productMatchings)
  //     .set({
  //       isResolved: true, // 소프트 삭제
  //       status: 'ignored', // 삭제된 상품은 'ignored' 상태로 간주
  //       updatedAt: new Date(),
  //     })
  //     .where(eq(wmsTables.productMatchings.productId, payload.productId))
  //     .returning();

  //   if (deletedMatching) {
  //     this.logger.log(`Product matching ${deletedMatching.id} (soft deleted) for product ${payload.productId}.`);
  //     // await this.eventPublisher.publishEvent('product.matching_removed', {
  //     //   matchingId: deletedMatching.id,
  //     //   productId: deletedMatching.productId,
  //     //   variantId: deletedMatching.variantId,
  //     // });
  //     // productVariantSkuLinks의 연결도 cascading delete되거나, 여기서 명시적으로 삭제 로직 필요
  //   }
  // }

  // StockService에서 `stock.updated` 이벤트가 발행될 때 (WMS 내부 발행) - 주석처리됨
  // @TypedEventPattern<typeof WMS_EVENTS, 'stock.updated'>('stock.updated')
  // async handleStockUpdated(payload: StockUpdatedPayload, @Payload() message: KafkaMessage) {
  //   this.logger.log(`Received stock.updated event for SKU ${payload.skuId} in warehouse ${payload.warehouseId}`, { correlationId: payload.correlationId });

  //   // `createStockEntry`가 호출되어 실제 재고가 생성되었을 때 (quantity가 0이든 0보다 크든)
  //   // `product_matchings`의 `isResolved`와 `preStockSellable`을 업데이트하는 역할을 수행
  //   // 이는 `StockService.createStockEntry`에서 `product_matchings`를 직접 업데이트하지 않고
  //   // 이벤트를 통해 상태 동기화

  //   // 1. 해당 SKU에 연결된 product_matchings 엔트리 찾기
  //   const skuLinks = await this.db.query.productVariantSkuLinks.findMany({
  //     where: eq(wmsTables.productVariantSkuLinks.skuId, payload.skuId),
  //     // where: eq(wmsTables.productVariantSkuLinks.skuId, payload.skuId),
  //   });

  //   for (const link of skuLinks) {
  //     const productMatching = await this.db.query.productMatchings.findFirst({
  //       where: eq(wmsTables.productMatchings.id, link.productMatchingId),
  //     });

  //     if (productMatching && (!productMatching.isResolved || productMatching.preStockSellable)) {
  //       // `isResolved`가 false이거나 `preStockSellable`이 true인 경우에만 업데이트
  //       await this.db.update(wmsTables.productMatchings)
  //         .set({
  //           isResolved: true, // 매칭 완료
  //           preStockSellable: false, // 첫 입고 완료
  //           status: 'matched', // 상태를 'matched'로 변경
  //           updatedAt: new Date(),
  //         })
  //         .where(eq(wmsTables.productMatchings.id, productMatching.id));
  //       this.logger.log(`ProductMatching ${productMatching.id} updated (isResolved=true, preStockSellable=false) due to stock update for SKU ${payload.skuId}.`);

  //       // product.matching_updated 이벤트 발행 (다른 서비스에 알림)
  //       // await this.eventPublisher.publishEvent('product.matching_updated', {
  //       //   matchingId: productMatching.id,
  //       //   productId: productMatching.productId,
  //       //   variantId: productMatching.variantId,
  //       //   skuId: payload.skuId, // 업데이트된 SKU ID
  //       //   status: 'matched',
  //       //   preStockSellable: false,
  //       // });
  //     }
  //   }
  // }


  // StockService에서 재고가 업데이트될 때 호출되는 메소드
  async handleStockUpdatedInternal(skuId: string) {
    this.logger.log(`Stock updated for SKU ${skuId}, updating product matching status.`);

    // 1. 해당 SKU에 연결된 product_matchings 엔트리 찾기
    const skuLinks = await this.db.query.productVariantSkuLinks.findMany({
      where: eq(wmsTables.productVariantSkuLinks.skuId, skuId),
    });

    for (const link of skuLinks) {
      const productMatching = await this.db.query.productMatchings.findFirst({
        where: eq(wmsTables.productMatchings.id, link.productMatchingId),
      });

      if (productMatching && !productMatching.isResolved) {
        // `isResolved`가 false인 경우에만 업데이트
        await this.db.update(wmsTables.productMatchings)
          .set({
            isResolved: true, // 매칭 완료
            status: 'matched', // 상태를 'matched'로 변경
            updatedAt: new Date(),
          })
          .where(eq(wmsTables.productMatchings.id, productMatching.id));
        this.logger.log(`ProductMatching ${productMatching.id} updated (isResolved=true) due to stock update for SKU ${skuId}.`);
      }
    }
  }


  // 테스트용
  // 테스트용 Product Matching 생성
  async createTestProductMatching() {
    const testPayload = {
      productId: 'test-product-001',
      variants: [
        {
          id: 'test-variant-001',
          name: '테스트 상품 변형 1',
          sku: 'TEST-SKU-001',
          inventoryManagement: true,
        },
        {
          id: 'test-variant-002',
          name: '테스트 상품 변형 2',
          sku: 'TEST-SKU-002',
          inventoryManagement: false,
        }
      ]
    };

    await this.createProductMatchingFromPimEvent(testPayload);
    this.logger.log('Test product matching created successfully');
  }

  // 테스트용 Product Matching 데이터 조회
  async getTestProductMatchings() {
    const matchings = await this.db.query.productMatchings.findMany({
      where: (matchings, { like }) => like(matchings.variantId, 'test-%'),
      orderBy: (matchings, { asc }) => [asc(matchings.createdAt)],
    });
    return matchings;
  }

  // 테스트용 Product Matching 데이터 삭제
  async deleteTestProductMatchings() {
    const deleted = await this.db.delete(wmsTables.productMatchings)
      .where(like(wmsTables.productMatchings.variantId, 'test-%'))
      .returning();

    this.logger.log(`Deleted ${deleted.length} test product matchings`);
    return deleted;
  }

  // 관리자 수동 매칭

  // 매칭 대기 목록 조회
  async getMatchingPendings(status?: 'pending' | 'matched' | 'ignored') {
    const matchings = await this.db.query.productMatchings.findMany({
      where: (matchings, { and, eq }) => and(
        status ? eq(matchings.status, status) : undefined,
        eq(matchings.isResolved, false), // 해결되지 않은 매칭만
      ),
      orderBy: (matchings, { asc }) => [asc(matchings.createdAt)],
    });
    return matchings;
  }

  // 매칭 대기 해소 (SKU와 매칭 또는 무시)
  // 이 메서드는 `관리자 수동 매칭` 중 `기존 stock(variant_id=NULL) 선택` 시나리오에 해당
  // 이미 WMS에 SKU/Stock이 존재하는 경우를 매칭하는 API
  async resolveMatchingPending(matchingId: string, skuIdToLink?: string, ignore?: boolean) {
    const productMatching = await this.db.query.productMatchings.findFirst({
      where: and(
        eq(wmsTables.productMatchings.id, matchingId),
        eq(wmsTables.productMatchings.isResolved, false) // 아직 해결되지 않은 매칭
      ),
    });

    if (!productMatching) {
      throw new NotFoundException(`Product matching with ID ${matchingId} not found or already resolved.`);
    }

    let newStatus: 'pending' | 'matched' | 'ignored';
    let linkedSkuId: string | null = null;

    if (ignore) {
      newStatus = 'ignored';
      linkedSkuId = null;
    } else if (skuIdToLink) {
      // 1. 연결할 SKU가 실제로 WMS에 존재하는지 확인
      const skuToLink = await this.skuService.findSkuById(skuIdToLink);
      if (!skuToLink) {
        throw new NotFoundException(`SKU with ID ${skuIdToLink} not found in WMS.`);
      }
      if (!skuToLink.inventoryManagement) {
        throw new BadRequestException(`SKU ${skuToLink.id} is not inventory managed. Cannot link to a variant for sales.`);
      }

      newStatus = 'matched';
      linkedSkuId = skuToLink.id;

      // 2. productVariantSkuLinks에 매핑 추가 (중복 방지)
      const existingLink = await this.db.query.productVariantSkuLinks.findFirst({
        where: and(
          eq(wmsTables.productVariantSkuLinks.productMatchingId, productMatching.id),
          eq(wmsTables.productVariantSkuLinks.skuId, linkedSkuId)
        )
      });
      if (!existingLink) {
        await this.db.insert(wmsTables.productVariantSkuLinks).values({
          productMatchingId: productMatching.id,
          skuId: linkedSkuId
        });
        this.logger.log(`Linked existing SKU ${linkedSkuId} to productMatching ${productMatching.id}.`);
      }
      // 3. `preStockSellable` 플래그 업데이트
      // 연결되는 SKU의 `preStockSellable`이 `true`라면 `false`로 변경 (첫 입고 완료 의미)
      if (skuToLink.inventoryManagement && skuToLink.preStockSellable) {
        await this.skuService._updatePreStockSellableInternal(skuToLink.id, false);
      }

    } else {
      throw new BadRequestException('SKU ID를 제공하거나 무시 옵션을 선택해야 합니다.');
    }

    // product_matchings 테이블 업데이트
    const [updatedMatching] = await this.db.update(wmsTables.productMatchings)
      .set({
        status: newStatus,
        isResolved: true,
        // preStockSellable: (newStatus === 'matched' ? false : productMatching.preStockSellable), // 매칭되면 false, 아니면 기존값 유지
        updatedAt: new Date(),
      })
      .where(eq(wmsTables.productMatchings.id, matchingId))
      .returning();

    if (!updatedMatching) {
      throw new Error(`Product matching ${matchingId} 해소에 실패했습니다.`);
    }

    this.logger.log(`Product matching ${matchingId} 해소됨. 상태: ${newStatus}, SKU ID: ${linkedSkuId}.`);
    // product.matching_updated 이벤트 발행 - 주석처리됨
    // await this.eventPublisher.publishEvent('product.matching_updated', {
    //   matchingId: updatedMatching.id,
    //   productId: updatedMatching.productId,
    //   variantId: updatedMatching.variantId,
    //   skuId: linkedSkuId,
    //   status: updatedMatching.status,
    //   preStockSellable: updatedMatching.preStockSellable,
    // });

    return updatedMatching;
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
    // product.matching_updated 이벤트 발행
    // await this.eventPublisher.publishEvent('product.matching_updated', {
    //   matchingId: updatedMatching.id,
    //   productId: updatedMatching.productId,
    //   variantId: updatedMatching.variantId,
    //   skuId: null, // 우선순위 변경은 SKU 연결과 직접 관련 없음
    //   status: updatedMatching.status,
    //   preStockSellable: updatedMatching.preStockSellable,
    // });

    return updatedMatching;
  }
}