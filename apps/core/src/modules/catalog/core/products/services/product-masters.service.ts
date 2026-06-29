import {
  Injectable,
  Logger,
  forwardRef,
  Inject,
  Optional,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { InjectStreamPublisher, OutboxPublisher, StreamPublisher } from '@app/events';
import { PRODUCT_STREAM, ProductEvents } from '@packages/event-contracts';
import {
  ProductMaster,
  ProductMasterVersion,
  UpdateProductMasterVersion,
  DbTransaction,
  OptionDiff,
  ProductMasterWithVersion,
  ProductImage,
  ProductDetailDto,
  PriceSummary,
} from '../../../catalog.types';
import { ProductMasterMapper } from '../mappers';
import {
  type PimSchema,
  productMasters,
  productMasterVersions,
  productMasterCategories,
  productCategories,
  productOptionGroups,
  productOptionValues,
  productOptionGroupDisplays,
  productOptionValueDisplays,
  productVariants,
  variantOptionValues,
  productImages,
  productAuditLog,
  productMasterOptionGroups,
  productMasterVariants,
  productMasterPricingRules,
  productMasterPurchaseConstraints,
  productPurchaseConstraints,
  productTagValues,
  tagValues,
  tagGroups,
} from '../../../schema/catalog.schema';
import { eq, and, ilike, count, asc, desc, inArray, isNull, isNotNull, sql } from 'drizzle-orm';
import { ProductVersionsService } from './product-versions.service';
import { PricingCalculatorService } from '../../pricing/pricing-calculator.service';
import { VariantPriceCacheService } from '../../pricing/variant-price-cache.service';
import { v7 as uuidv7 } from 'uuid';
import { deleteEntitiesIfUnmapped } from '../../version-isolation/delete-if-unmapped';
import { ProductVersionDto } from '../dto/entities/master-version.entity';
import { MasterProductWithPrimaryVersionDto } from '../dto/products/product-response.dto';
import { ProductMasterVersionEntity } from '../../../schema/catalog.schema.types';
import { ProductReadAssembler } from '../assemblers/product-read.assembler';
import { ProductMatchingService } from '../../../../product-matching/services/product-matching.service';
import { ProductSellableQuantityService } from '../../../../inventory/product-sellable-quantity/services/product-sellable-quantity.service';

type VersionOptionValueDisplay = {
  optionValueId: string;
  displayName: string;
  colorCode: string | null;
  imageUrl: string | null;
  sortOrder: number | null;
};

type VersionOptionGroupWithDisplays = {
  optionGroupId: string;
  displayName: string;
  description: string | null;
  sortOrder: number | null;
  values: VersionOptionValueDisplay[];
};

// generateOptionCombinations 결과에서 사용하는 항목 타입
type VariantCombinationItem = {
  id: string;
  displayName: string;
  groupName?: string | null;
  name?: string | null;
};

type VariantCombination = VariantCombinationItem[];

// Master 목록 조회 모드
type MasterListMode =
  | 'active' // active 버전만
  | 'active-or-inactive' // active 우선, 없으면 최신 inactive
  | 'all'; // active 우선 → 최신 inactive → 최신 draft (draft만 있는 신규 상품 포함)

@Injectable()
export class ProductMastersService {
  private readonly logger = new Logger(ProductMastersService.name);

  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,

    @InjectStreamPublisher(PRODUCT_STREAM.topic.topic)
    private readonly productPublisher: StreamPublisher<ProductEvents>,
    private readonly outboxPublisher: OutboxPublisher,

    @Inject(forwardRef(() => ProductVersionsService))
    private readonly productVersionsService: ProductVersionsService,

    private readonly productReadAssembler: ProductReadAssembler,
    private readonly pricingCalculatorService: PricingCalculatorService,
    private readonly priceCacheService: VariantPriceCacheService,
    private readonly productSellableQuantity: ProductSellableQuantityService,

    @Optional()
    private readonly productMatchingService: ProductMatchingService | null,
  ) {}

  /**
   * ProductVariantCreated 이벤트 발행
   *
   * variant 생성 시 WMS에 매칭 생성을 위한 이벤트를 발행합니다.
   * 이벤트 발행 실패해도 트랜잭션은 커밋됩니다 (Orchestrator가 WMS에 직접 요청하므로 복원력 보장).
   */
  private async publishVariantCreatedEvent(
    version: ProductMasterVersion,
    variant: any,
    optionCombination: Array<{ name: string; value: string }> | null,
  ): Promise<void> {
    try {
      await this.productPublisher.publishEvent({
        eventType: 'ProductVariantCreated',
        aggregateId: version.masterId,
        payload: {
          masterId: version.masterId,
          versionId: version.id,
          productName: version.name,
          variantId: variant.id,
          variantName: variant.variantName,
          isDefault: variant.isDefault ?? false,
          status: variant.status ?? 'active',

          // 재고 관리 설정 (현재는 기본값, 추후 master 테이블에 필드 추가)
          inventoryManagement: true,
          preStockSellable: false,
          alwaysSellableZeroStock: false,

          optionCombination: optionCombination ?? undefined,
          createdAt: new Date().toISOString(),
        },
      });

      this.logger.log(`📤 Published ProductVariantCreated: ${variant.id} (${version.name})`);
    } catch (error) {
      this.logger.error(`❌ Failed to publish ProductVariantCreated: ${variant.id}`, error.stack);
      // 이벤트 발행 실패해도 트랜잭션은 커밋
    }

    // Product Matching BC 직접 호출 (Phase 4)
    if (this.productMatchingService) {
      try {
        await this.productMatchingService.handleVariantCreated({
          masterId: version.masterId,
          productName: version.name,
          variantId: variant.id,
          variantName: variant.variantName ?? undefined,
          inventoryManagement: true,
          preStockSellable: false,
          alwaysSellableZeroStock: false,
        });
      } catch (error) {
        this.logger.error(`❌ Failed to create product matching for variant: ${variant.id}`, error.stack);
        // 매칭 생성 실패해도 트랜잭션은 커밋 (복원력 보장)
      }
    }
  }

  async createMaster(tx?: DbTransaction): Promise<ProductMasterVersion> {
    return this.db.run(async (tx) => {
      const masterId = uuidv7();
      const versionId = uuidv7();

      // 1. 마스터 메타데이터 생성
      const [master] = await tx
        .insert(productMasters)
        .values({
          id: masterId,
        })
        .returning();

      // 2. 첫 번째 버전 생성
      const versionData = {
        id: versionId,
        masterId: masterId,
        createdBy: '00000000-0000-0000-0000-000000000000',
        status: 'draft' as const,
      };

      const [version] = await tx.insert(productMasterVersions).values(versionData).returning();

      // 3. 항상 기본 variant 1개 생성 (옵션 없음)
      const [variant] = await tx
        .insert(productVariants)
        .values({
          variantName: null,
          isDefault: true,
          status: 'active',
        })
        .returning();

      // 4. 매핑 테이블에 연결
      await tx.insert(productMasterVariants).values({
        id: uuidv7(),
        masterId: masterId,
        variantId: variant.id,
        versionId: version.id,
        createdAt: new Date(),
      });

      // 5. WMS 이벤트 발행
      await this.publishVariantCreatedEvent(version, variant, null);

      return version;
    }, tx);
  }

  private async _linkCategories(
    masterId: string,
    versionId: string,
    categoryIds: string[],
    primaryCategoryId: string | undefined,
    tx: DbTransaction,
  ): Promise<void> {
    if (!categoryIds || categoryIds.length === 0) {
      return;
    }

    // Validate categories exist
    const existingCategories = await tx
      .select({ id: productCategories.id })
      .from(productCategories)
      .where(inArray(productCategories.id, categoryIds));

    const existingCategoryIds = existingCategories.map((c) => c.id);
    const missingCategoryIds = categoryIds.filter((id) => !existingCategoryIds.includes(id));

    if (missingCategoryIds.length > 0) {
      throw new NotFoundException(`Categories not found: ${missingCategoryIds.join(', ')}`);
    }

    // Validate primaryCategoryId if provided
    if (primaryCategoryId && !categoryIds.includes(primaryCategoryId)) {
      throw new BadRequestException('primaryCategoryId must be one of the categoryIds');
    }

    // Create category relations
    const categoryRelations = categoryIds.map((categoryId) => ({
      masterId: masterId,
      versionId: versionId,
      categoryId: categoryId,
      isPrimary: categoryId === primaryCategoryId,
      createdAt: new Date(),
    }));

    await tx.insert(productMasterCategories).values(categoryRelations);
  }

  private async _generateVariants(
    masterId: string,
    versionId: string,
    optionGroups: VersionOptionGroupWithDisplays[],
    tx: DbTransaction,
  ): Promise<void> {
    const version = await this.getVersionById(versionId, {}, tx);

    if (!optionGroups || optionGroups.length === 0) {
      const [variant] = await tx
        .insert(productVariants)
        .values({
          variantName: null,
          isDefault: true,
          status: 'active',
        })
        .returning();

      await tx.insert(productMasterVariants).values({
        id: uuidv7(),
        masterId,
        variantId: variant.id,
        versionId,
      });

      await this.publishVariantCreatedEvent(version, variant, null);
      return;
    }

    const combinations: VariantCombination[] = this.generateOptionCombinations(optionGroups);

    for (const combination of combinations) {
      const [variant] = await tx
        .insert(productVariants)
        .values({
          variantName: combination.map((v) => v.displayName).join(' × '),
          isDefault: false,
          status: 'active',
        })
        .returning();

      await tx.insert(productMasterVariants).values({
        id: uuidv7(),
        masterId,
        variantId: variant.id,
        versionId,
      });

      for (const optionValue of combination) {
        await tx.insert(variantOptionValues).values({
          variantId: variant.id,
          optionValueId: optionValue.id,
        });
      }

      await this.publishVariantCreatedEvent(
        version,
        variant,
        combination.map((opt) => ({
          name: opt.groupName ?? opt.name ?? opt.displayName,
          value: opt.displayName,
        })),
      );
    }
  }

  async getVersionById(
    versionId: string,
    options?: { includeDeleted?: boolean },
    tx?: DbTransaction,
  ): Promise<ProductMasterVersion> {
    if (!versionId) {
      throw new BadRequestException('Version ID is required');
    }

    const conditions = [eq(productMasterVersions.id, versionId)];
    if (!options?.includeDeleted) {
      conditions.push(isNull(productMasterVersions.deletedAt));
    }

    const version = await this.db.run(async (tx) => {
      const result = await tx
        .select()
        .from(productMasterVersions)
        .where(and(...conditions));

      return result.length > 0 ? result[0] : null;
    }, tx);

    if (!version) {
      throw new NotFoundException(`Version ${versionId} not found`);
    }

    return version;
  }

  async tryGetVersionById(
    versionId: string,
    options?: { includeDeleted?: boolean },
    tx?: DbTransaction,
  ): Promise<ProductMasterVersion | null> {
    if (!versionId) {
      throw new BadRequestException('Version ID is required');
    }

    const conditions = [eq(productMasterVersions.id, versionId)];
    if (!options?.includeDeleted) {
      conditions.push(isNull(productMasterVersions.deletedAt));
    }

    const version = await this.db.run(async (tx) => {
      const result = await tx
        .select()
        .from(productMasterVersions)
        .where(and(...conditions));

      return result.length > 0 ? result[0] : null;
    }, tx);

    return version;
  }

  async getMasterById(masterId: string, tx?: DbTransaction): Promise<ProductMasterWithVersion> {
    if (!masterId) {
      throw new BadRequestException('Master ID is required');
    }

    const masterWithVersion = await this.db.run(async (tx) => {
      const [result] = await tx
        .select()
        .from(productMasterVersions)
        .innerJoin(productMasters, eq(productMasterVersions.masterId, productMasters.id))
        .where(
          and(
            eq(productMasterVersions.masterId, masterId),
            eq(productMasterVersions.status, 'active'),
            isNull(productMasterVersions.deletedAt),
            isNull(productMasters.deletedAt),
          ),
        )
        .limit(1);

      return result
        ? {
            ...result.product_masters,
            version: result.product_master_versions,
          }
        : null;
    }, tx);

    if (!masterWithVersion) {
      throw new NotFoundException(`Master ${masterId} not found`);
    }

    return masterWithVersion;
  }

  async tryGetMasterById(masterId: string, tx?: DbTransaction): Promise<ProductMasterWithVersion | null> {
    if (!masterId) {
      throw new BadRequestException('Master ID is required');
    }

    const masterWithVersion = await this.db.run(async (tx) => {
      const [result] = await tx
        .select()
        .from(productMasterVersions)
        .innerJoin(productMasters, eq(productMasterVersions.masterId, productMasters.id))
        .where(
          and(
            eq(productMasterVersions.masterId, masterId),
            isNull(productMasterVersions.deletedAt),
            isNull(productMasters.deletedAt),
          ),
        )
        .limit(1);

      return result
        ? {
            ...result.product_masters,
            version: result.product_master_versions,
          }
        : null;
    }, tx);

    return masterWithVersion;
  }

  async getVersionWithImages(
    versionId: string,
    tx?: DbTransaction,
  ): Promise<ProductMasterVersion & { images: ProductImage[] }> {
    if (!versionId) {
      throw new BadRequestException('Version ID is required');
    }

    const versionWithImages = await this.db.run(async (tx) => {
      const [version] = await tx.select().from(productMasterVersions).where(eq(productMasterVersions.id, versionId));

      if (!version) {
        throw new NotFoundException(`Version ${versionId} not found`);
      }

      const images = await tx
        .select()
        .from(productImages)
        .where(eq(productImages.versionId, versionId))
        .orderBy(desc(productImages.isPrimary), asc(productImages.sortOrder));

      return {
        ...version,
        images,
      };
    }, tx);

    return versionWithImages;
  }

  async getMasterDetail(masterId: string, tx?: DbTransaction): Promise<ProductDetailDto> {
    return this.productReadAssembler.getMasterDetail(masterId, undefined, tx);
  }

  async getMasters(
    filters?: {
      mode?: MasterListMode;
      categoryId?: string;
      brand?: string;
      name?: string;
      page?: number;
      limit?: number;
      deleted?: boolean;
      ids?: string[];
    },
    tx?: DbTransaction,
  ): Promise<{
    data: {
      product: ProductMasterWithVersion;
      aggregate: {
        optionGroupNames: string[];
        variantCount: number;
        thumbnail: string | null;
        priceSummary: PriceSummary | null;
      };
    }[];
    total: number;
    page: number;
    limit: number;
  }> {
    return this.db.run(async (trx) => {
      // ===== 페이징 기초 계산 =====
      const returnAll = filters?.page === undefined;
      const page = filters?.page ?? 1;
      const limit = returnAll ? 99999 : Math.min(filters?.limit ?? 15, 100);
      const offset = (page - 1) * limit;

      const mode = filters?.mode ?? 'active';
      const deleted = filters?.deleted ?? false;

      // ===== 모드별 버전 선택 서브쿼리 =====
      // - active: 서브쿼리 불필요 — productMasterVersions에 직접 status/deletedAt 조건을 건다.
      // - active-or-inactive: master당 active 우선 → 최신 inactive 1개를 ROW_NUMBER로 선택.
      // - all: active 우선 → 최신 inactive → 최신 draft. draft만 있는 신규 상품도 목록에 나온다.
      const rankedVersionStatuses: ('active' | 'inactive' | 'draft')[] =
        mode === 'all' ? ['active', 'inactive', 'draft'] : ['active', 'inactive'];
      const rankedVersionsSubquery =
        mode === 'active'
          ? null
          : trx
              .select({
                masterId: productMasterVersions.masterId,
                versionId: productMasterVersions.id,
                status: productMasterVersions.status,
                createdAt: productMasterVersions.createdAt,
                rn: sql<number>`
                  ROW_NUMBER() OVER (
                    PARTITION BY ${productMasterVersions.masterId}
                    ORDER BY
                      CASE
                        WHEN ${productMasterVersions.status} = 'active' THEN 0
                        WHEN ${productMasterVersions.status} = 'inactive' THEN 1
                        ELSE 2
                      END,
                      ${productMasterVersions.createdAt} DESC
                  )
                `.as('rn'),
              })
              .from(productMasterVersions)
              .where(
                and(
                  inArray(productMasterVersions.status, rankedVersionStatuses),
                  isNull(productMasterVersions.deletedAt),
                ),
              )
              .as('ranked_versions');

      // ===== 카테고리 필터: 하위 카테고리 포함 ID 목록 (Recursive CTE) =====
      let categoryIds: string[] | undefined;

      if (filters?.categoryId) {
        // Recursive CTE로 카테고리 트리 조회
        const categoryTreeResult = await trx.execute<{ id: string }>(sql`
          WITH RECURSIVE category_tree AS (
            -- Base: 선택된 카테고리
            SELECT id
            FROM ${productCategories}
            WHERE id = ${filters.categoryId}

            UNION ALL

            -- Recursive: 자식 카테고리들
            SELECT pc.id
            FROM ${productCategories} pc
            INNER JOIN category_tree ct ON pc.parent_id = ct.id
          )
          SELECT id FROM category_tree
        `);

        categoryIds = categoryTreeResult.map((row) => row.id);
      }

      // ===== 공통 where 조건 빌드 =====
      const whereConditions: any[] = [];

      // soft delete 필터
      if (!deleted) {
        whereConditions.push(isNull(productMasters.deletedAt));
      }

      // brand 필터
      if (filters?.brand) {
        whereConditions.push(ilike(productMasterVersions.brand, `%${filters.brand}%`));
      }

      // name 검색 필터
      if (filters?.name) {
        whereConditions.push(ilike(productMasterVersions.name, `%${filters.name}%`));
      }

      // ids 필터 (배치 조회용)
      if (filters?.ids && filters.ids.length > 0) {
        whereConditions.push(inArray(productMasters.id, filters.ids));
      }

      // 모드별 버전 필터: active는 productMasterVersions 컬럼으로, 다른 모드는 ranked subquery의 rn=1로.
      if (mode === 'active') {
        whereConditions.push(eq(productMasterVersions.status, 'active'));
        whereConditions.push(isNull(productMasterVersions.deletedAt));
      } else {
        whereConditions.push(eq(rankedVersionsSubquery!.rn, 1));
      }

      // ===== 최종 where 절 빌드 =====
      const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;

      // ===== COUNT 쿼리 =====
      // Drizzle 빌더는 mutable이므로 count/data를 별개 인스턴스로 만든다.
      // 사내 컨벤션: sales-channels.service.ts:126-148 참고.
      const countBaseQuery =
        mode === 'active'
          ? trx
              .select({ c: count() })
              .from(productMasters)
              .innerJoin(productMasterVersions, eq(productMasters.id, productMasterVersions.masterId))
          : trx
              .select({ c: count() })
              .from(productMasters)
              .innerJoin(rankedVersionsSubquery!, eq(productMasters.id, rankedVersionsSubquery!.masterId))
              .innerJoin(productMasterVersions, eq(rankedVersionsSubquery!.versionId, productMasterVersions.id));

      const countQuery =
        categoryIds && categoryIds.length > 0
          ? countBaseQuery.innerJoin(
              productMasterCategories,
              and(
                eq(productMasterCategories.masterId, productMasters.id),
                eq(productMasterCategories.versionId, productMasterVersions.id),
                inArray(productMasterCategories.categoryId, categoryIds),
              ),
            )
          : countBaseQuery;

      const [{ c: total }] = await (whereClause ? countQuery.where(whereClause) : countQuery);

      // ===== DATA 쿼리 (정렬 및 페이지네이션) =====
      const dataBaseQuery =
        mode === 'active'
          ? trx
              .select()
              .from(productMasters)
              .innerJoin(productMasterVersions, eq(productMasters.id, productMasterVersions.masterId))
          : trx
              .select()
              .from(productMasters)
              .innerJoin(rankedVersionsSubquery!, eq(productMasters.id, rankedVersionsSubquery!.masterId))
              .innerJoin(productMasterVersions, eq(rankedVersionsSubquery!.versionId, productMasterVersions.id));

      const dataQueryWithCategory =
        categoryIds && categoryIds.length > 0
          ? dataBaseQuery.innerJoin(
              productMasterCategories,
              and(
                eq(productMasterCategories.masterId, productMasters.id),
                eq(productMasterCategories.versionId, productMasterVersions.id),
                inArray(productMasterCategories.categoryId, categoryIds),
              ),
            )
          : dataBaseQuery;

      const filteredDataQuery = whereClause ? dataQueryWithCategory.where(whereClause) : dataQueryWithCategory;
      const orderedQuery = filteredDataQuery.orderBy(desc(productMasterVersions.createdAt));

      const rawData = await (returnAll ? orderedQuery : orderedQuery.limit(limit).offset(offset));

      // ===== 결과 가공: ProductMasterWithVersion + aggregate 데이터 =====

      // ===== 배치 쿼리로 N+1 문제 해결 =====
      const versionIds = rawData.map((item) => item.product_master_versions.id);

      if (versionIds.length === 0) {
        return { data: [], total, page, limit };
      }

      // 한 번에 모든 optionGroup names 조회 (displayName 기준)
      const optionGroupNamesResult = await trx
        .select({
          versionId: productMasterOptionGroups.versionId,
          names: sql<
            string[]
          >`array_agg(DISTINCT ${productOptionGroupDisplays.displayName} ORDER BY ${productOptionGroupDisplays.displayName})`,
        })
        .from(productMasterOptionGroups)
        .innerJoin(
          productOptionGroupDisplays,
          and(
            eq(productMasterOptionGroups.optionGroupId, productOptionGroupDisplays.optionGroupId),
            eq(productMasterOptionGroups.versionId, productOptionGroupDisplays.versionId),
            eq(productOptionGroupDisplays.locale, 'ko-KR'),
          ),
        )
        .where(inArray(productMasterOptionGroups.versionId, versionIds))
        .groupBy(productMasterOptionGroups.versionId);

      // 한 번에 모든 variant count 조회
      const variantCounts = await trx
        .select({
          versionId: productMasterVariants.versionId,
          count: count(),
        })
        .from(productMasterVariants)
        .where(inArray(productMasterVariants.versionId, versionIds))
        .groupBy(productMasterVariants.versionId);

      // 한 번에 모든 primary 이미지 조회 (thumbnail용)
      const thumbnailMap = await this.productReadAssembler.getPrimaryImagesByVersionIds(versionIds, trx);

      const priceSummaryMap = await this.priceCacheService.getPriceSummariesByVersionIds(versionIds, trx);

      // Map으로 변환 (O(1) 조회)
      const optionGroupNamesMap = new Map(optionGroupNamesResult.map((item) => [item.versionId, item.names]));
      const variantCountMap = new Map(variantCounts.map((item) => [item.versionId, item.count]));

      // 결과 조합 (더 이상 비동기 쿼리 없음)
      const data = rawData.map((item) => {
        const master = item.product_masters;
        const version = item.product_master_versions;

        const product: ProductMasterWithVersion = {
          ...master,
          version,
        };

        return {
          product,
          aggregate: {
            optionGroupNames: optionGroupNamesMap.get(version.id) ?? [],
            variantCount: variantCountMap.get(version.id) ?? 0,
            thumbnail: thumbnailMap.get(version.id) ?? null,
            priceSummary: priceSummaryMap.get(version.id) ?? null,
          },
        };
      });

      return {
        data,
        total,
        page,
        limit,
      };
    }, tx);
  }

  /**
   * Draft 버전 수정
   * @param versionId - Version ID (product_master_versions.id)
   * @param data - 수정할 데이터
   * @param tx - 트랜잭션 객체 (선택)
   * @returns 수정된 버전
   */
  async updateVersion(
    versionId: string,
    data: UpdateProductMasterVersion,
    tx?: DbTransaction,
  ): Promise<ProductMasterVersion> {
    if (!versionId) {
      throw new BadRequestException('Version ID is required');
    }

    return this.db.run(async (tx) => {
      const existingVersion = await this.getVersionById(versionId, {}, tx);

      if (existingVersion.status !== 'draft') {
        throw new BadRequestException('Only draft versions can be modified');
      }

      // 기본 필드 수정
      const {
        categoryIds,
        primaryCategoryId,
        migrationData,
        optionDiff,
        tagValueIds,
        thumbnailFileId,
        additionalImageFileIds,
        ...masterUpdateData
      } = data;

      if (
        masterUpdateData.hideMembershipPriceForNonMembers !== undefined &&
        masterUpdateData.isMembershipOnly === undefined
      ) {
        masterUpdateData.isMembershipOnly = masterUpdateData.hideMembershipPriceForNonMembers;
      } else if (
        masterUpdateData.isMembershipOnly !== undefined &&
        masterUpdateData.hideMembershipPriceForNonMembers === undefined
      ) {
        masterUpdateData.hideMembershipPriceForNonMembers = masterUpdateData.isMembershipOnly;
      }

      const [updated] = await tx
        .update(productMasterVersions)
        .set({
          ...masterUpdateData,
          updatedAt: new Date(),
        })
        .where(eq(productMasterVersions.id, versionId))
        .returning();

      if (!updated) {
        throw new NotFoundException(`Failed to update version: ${versionId}`);
      }

      //이미지 처리 (product_images 테이블)

      // 1. 대표 이미지 (thumbnailFileId → product_images with isPrimary=true)
      if (thumbnailFileId !== undefined) {
        // 기존 대표 이미지 삭제
        await tx
          .delete(productImages)
          .where(and(eq(productImages.versionId, versionId), eq(productImages.isPrimary, true)));

        if (thumbnailFileId) {
          // 새 대표 이미지 추가
          await tx.insert(productImages).values({
            id: uuidv7(),
            versionId: versionId,
            fileId: thumbnailFileId,
            isPrimary: true,
            sortOrder: 0,
            createdAt: new Date(),
          });
        }
      }

      // 2. 부가 이미지 (additionalImageFileIds → product_images with isPrimary=false)
      if (additionalImageFileIds !== undefined) {
        // 기존 부가 이미지 삭제 (대표 이미지 제외)
        await tx
          .delete(productImages)
          .where(and(eq(productImages.versionId, versionId), eq(productImages.isPrimary, false)));

        // 새 부가 이미지 추가 (최대 5개)
        if (additionalImageFileIds.length > 0) {
          if (additionalImageFileIds.length > 5) {
            throw new BadRequestException('부가 이미지는 최대 5개까지 가능합니다');
          }

          const imageRecords = additionalImageFileIds.map((fileId, index) => ({
            id: uuidv7(),
            versionId: versionId,
            fileId: fileId,
            isPrimary: false,
            sortOrder: index + 1,
            createdAt: new Date(),
          }));

          await tx.insert(productImages).values(imageRecords);
        }
      }

      // 카테고리 업데이트
      if (categoryIds !== undefined) {
        await tx
          .delete(productMasterCategories)
          .where(
            and(
              eq(productMasterCategories.masterId, updated.masterId),
              eq(productMasterCategories.versionId, updated.id),
            ),
          );

        if (categoryIds.length > 0) {
          await this._linkCategories(updated.masterId, updated.id, categoryIds, primaryCategoryId, tx);
        }
      }

      // 옵션 diff 처리
      if (optionDiff) {
        const structureChanged = await this._applyOptionDiff(versionId, updated.masterId, optionDiff, tx);

        // 옵션 구조 변경 시 variants 재생성
        if (structureChanged) {
          const changeType = optionDiff.add || optionDiff.remove ? 'option_group_changed' : 'option_value_changed';

          this.logger.log(
            `Option structure changed for version ${versionId}. Regenerating variants (${changeType})...`,
          );

          await this._regenerateVariantsForVersion(updated.masterId, updated.id, changeType, tx);
        }
      }

      // 태그 값 업데이트
      if (data.tagValueIds !== undefined) {
        await tx
          .delete(productTagValues)
          .where(and(eq(productTagValues.masterId, updated.masterId), eq(productTagValues.versionId, updated.id)));

        if (data.tagValueIds.length > 0) {
          const uniqueTagValueIds = [...new Set(data.tagValueIds)];

          if (uniqueTagValueIds.length !== data.tagValueIds.length) {
            throw new BadRequestException('Duplicate tag value IDs are not allowed');
          }

          const validTagValues = await tx
            .select({ id: tagValues.id })
            .from(tagValues)
            .where(and(inArray(tagValues.id, data.tagValueIds), eq(tagValues.isActive, true)));

          if (validTagValues.length !== data.tagValueIds.length) {
            const validIds = validTagValues.map((v) => v.id);
            const invalidIds = data.tagValueIds.filter((id) => !validIds.includes(id));
            throw new NotFoundException(`Tag values not found or inactive: ${invalidIds.join(', ')}`);
          }

          await tx.insert(productTagValues).values(
            data.tagValueIds.map((tagValueId) => ({
              masterId: updated.masterId,
              versionId: updated.id,
              tagValueId,
              createdAt: new Date(),
            })),
          );
        }
      }

      return updated;
    }, tx);
  }

  async generateVariants(versionId: string, tx?: DbTransaction): Promise<void> {
    if (!versionId) {
      throw new BadRequestException('Master ID is required');
    }

    await this.db.run(async (tx) => {
      const version = await this.getVersionById(versionId, {}, tx);
      if (!version) {
        throw new NotFoundException(`Version not found: ${versionId}`);
      }

      // 매핑 테이블을 통해 기존 variants 확인
      const existingMappings = await tx
        .select({ count: count() })
        .from(productMasterVariants)
        .where(
          and(eq(productMasterVariants.masterId, version.masterId), eq(productMasterVariants.versionId, version.id)),
        );

      if (existingMappings[0].count > 0) {
        throw new BadRequestException('Master already has variants. Use regenerateVariants to recreate them.');
      }

      // Display 테이블을 통해 optionGroups 조회
      const optionGroups = await this._getVersionOptionGroupsWithDisplays(version.masterId, version.id, 'ko-KR', tx);

      await this._generateVariants(version.masterId, version.id, optionGroups, tx);
    }, tx);
  }

  async generateDefaultVariant(versionId: string, tx?: DbTransaction): Promise<void> {
    await this.db.run(async (tx) => {
      const version = await this.getVersionById(versionId, {}, tx);
      if (!version) {
        throw new NotFoundException(`Version not found: ${versionId}`);
      }

      // 매핑 테이블을 통해 optionGroups 확인
      const existingOptionGroups = await tx
        .select({ count: count() })
        .from(productMasterOptionGroups)
        .where(
          and(
            eq(productMasterOptionGroups.masterId, version.masterId),
            eq(productMasterOptionGroups.versionId, version.id),
          ),
        );

      if (existingOptionGroups[0].count > 0) {
        throw new BadRequestException(
          'Cannot generate default variant for master with option groups. Use generateVariants instead.',
        );
      }

      // 매핑 테이블을 통해 기존 variants 확인
      const existingVariants = await tx
        .select({ count: count() })
        .from(productMasterVariants)
        .where(
          and(eq(productMasterVariants.masterId, version.masterId), eq(productMasterVariants.versionId, version.id)),
        );

      if (existingVariants[0].count > 0) {
        throw new BadRequestException('Master already has variants. Cannot generate default variant.');
      }

      // variant 생성 후 매핑
      const [variant] = await tx
        .insert(productVariants)
        .values({
          variantName: null,
          isDefault: true,
          status: 'active',
          displayOrder: 0,
        })
        .returning();

      await tx.insert(productMasterVariants).values({
        id: uuidv7(),
        masterId: version.masterId,
        variantId: variant.id,
        versionId: version.id,
        createdAt: new Date(),
      });
    }, tx);
  }

  async regenerateVariants(versionId: string, tx?: DbTransaction): Promise<void> {
    if (!versionId) {
      throw new BadRequestException('Version ID is required');
    }

    await this.db.run(async (tx) => {
      const version = await this.getVersionById(versionId, {}, tx);
      if (!version) {
        throw new NotFoundException(`Version not found: ${versionId}`);
      }

      // 매핑 테이블을 통해 기존 variants 삭제
      const existingMappings = await tx
        .select({ variantId: productMasterVariants.variantId })
        .from(productMasterVariants)
        .where(
          and(eq(productMasterVariants.masterId, version.masterId), eq(productMasterVariants.versionId, version.id)),
        );

      // 매핑 삭제
      await tx
        .delete(productMasterVariants)
        .where(
          and(eq(productMasterVariants.masterId, version.masterId), eq(productMasterVariants.versionId, version.id)),
        );

      // 실제 variant 레코드 삭제 (다른 버전에서 사용되지 않는 경우)
      await deleteEntitiesIfUnmapped(
        tx,
        {
          entityTable: productVariants,
          entityIdColumn: productVariants.id,
          junctionTable: productMasterVariants,
          junctionFkColumn: productMasterVariants.variantId,
        },
        existingMappings.map((m) => m.variantId),
      );

      // 매핑 테이블과 Display 테이블을 통해 optionGroups 조회
      const optionGroups = await this._getVersionOptionGroupsWithDisplays(version.masterId, version.id, 'ko-KR', tx);

      await this._generateVariants(version.masterId, version.id, optionGroups, tx);
    }, tx);
  }

  async existsMaster(masterId: string, tx?: DbTransaction): Promise<boolean> {
    if (!masterId) {
      return false;
    }

    const result = await this.db.run(async (tx) => {
      return await tx
        .select({ count: count() })
        .from(productMasters)
        .where(and(eq(productMasters.id, masterId), isNull(productMasters.deletedAt)));
    }, tx);

    return result[0].count > 0;
  }

  private generateOptionCombinations(optionGroups: any[]): any[][] {
    if (!optionGroups || optionGroups.length === 0) {
      return [];
    }

    if (optionGroups.length === 1) {
      return optionGroups[0].values.map((value: any) => [value]);
    }
    const [firstGroup, ...restGroups] = optionGroups;
    const restCombinations = this.generateOptionCombinations(restGroups);

    const combinations: any[][] = [];

    for (const value of firstGroup.values) {
      if (restCombinations.length === 0) {
        combinations.push([value]);
      } else {
        for (const restCombination of restCombinations) {
          combinations.push([value, ...restCombination]);
        }
      }
    }

    return combinations;
  }

  public generateOptionCombinationsForTest(optionGroups: any[]): string[][] {
    const combinations = this.generateOptionCombinations(optionGroups);
    return combinations.map((combination) => combination.map((option) => option.value || option));
  }

  /**
   * Emit ProductMasterDeleted event
   */
  private async _emitMasterDeletedEvent(masterId: string, tx: DbTransaction): Promise<void> {
    await this.outboxPublisher.saveEvent(
      {
        topic: PRODUCT_STREAM.topic.topic,
        eventType: 'ProductMasterDeleted',
        aggregateType: PRODUCT_STREAM.aggregateType,
        aggregateId: masterId,
        payload: {
          masterId,
          deletedAt: new Date().toISOString(),
        },
      },
      tx,
    );

    this.logger.log(`📦 Enqueued ProductMasterDeleted: ${masterId}`);
  }

  /**
   * Soft delete a product
   */
  async deleteVersion(id: string, userId: string, tx?: DbTransaction): Promise<ProductMasterVersion> {
    const deleted = await this.db.run(async (tx) => {
      // Check if product exists and is not already deleted
      const product = await this.getVersionById(id, { includeDeleted: true }, tx);
      if (!product) {
        throw new NotFoundException(`Product with ID ${id} not found`);
      }

      if (product.deletedAt) {
        throw new BadRequestException('Product is already deleted');
      }

      const [deleted] = await tx
        .update(productMasterVersions)
        .set({
          deletedAt: new Date(),
          deletedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(productMasterVersions.id, id))
        .returning();

      // Log audit event
      await this.logAudit(
        {
          versionId: id,
          action: 'deleted',
          changes: { deletedAt: deleted.deletedAt },
          userId,
        },
        tx,
      );

      if (product.status === 'active') {
        await this._emitMasterDeletedEvent(product.masterId, tx);
      }

      await this.productSellableQuantity.recalculateAndPublishForVersion(id, tx);

      return deleted;
    }, tx);

    return deleted;
  }

  /**
   * Restore a soft-deleted product
   */
  async restore(id: string, userId: string, tx?: DbTransaction): Promise<ProductMasterVersion> {
    return await this.db.run(async (tx) => {
      // Find product including deleted ones
      const [product] = await tx.select().from(productMasterVersions).where(eq(productMasterVersions.id, id));

      if (!product) {
        throw new NotFoundException(`Product with ID ${id} not found`);
      }

      if (!product.deletedAt) {
        throw new BadRequestException('Product is not deleted');
      }

      const [restored] = await tx
        .update(productMasterVersions)
        .set({
          deletedAt: null,
          deletedBy: null,
          updatedAt: new Date(),
        })
        .where(eq(productMasterVersions.id, id))
        .returning();

      // Log audit event
      await this.logAudit(
        {
          versionId: id,
          action: 'restored',
          changes: { deletedAt: null },
          userId,
        },
        tx,
      );

      await this.productSellableQuantity.recalculateAndPublishForVersion(id, tx);

      return restored;
    }, tx);
  }

  /**
   * Master 자체를 soft delete (product_masters.deletedAt 설정)
   * Master가 삭제되면 모든 Version은 자동으로 조회되지 않음 (join 시 필터링)
   * Active 버전이 있었다면 ProductMasterDeleted 이벤트 발행
   */
  async deleteMaster(masterId: string, userId: string, tx?: DbTransaction): Promise<ProductMaster> {
    return await this.db.run(async (tx) => {
      // 1. Master 존재 및 삭제 여부 확인
      const [master] = await tx.select().from(productMasters).where(eq(productMasters.id, masterId));

      if (!master) {
        throw new NotFoundException(`Master not found: ${masterId}`);
      }

      if (master.deletedAt) {
        throw new BadRequestException('Master is already deleted');
      }

      // 2. Active 버전 확인 (이벤트 발행용)
      const [activeVersion] = await tx
        .select()
        .from(productMasterVersions)
        .where(and(eq(productMasterVersions.masterId, masterId), eq(productMasterVersions.status, 'active')))
        .limit(1);

      // 3. Master soft delete
      const [deletedMaster] = await tx
        .update(productMasters)
        .set({
          deletedAt: new Date(),
          deletedBy: userId,
        })
        .where(eq(productMasters.id, masterId))
        .returning();

      // 4. Active 버전이 있었다면 이벤트 발행
      if (activeVersion) {
        await this._emitMasterDeletedEvent(masterId, tx);
      }

      await this.productSellableQuantity.recalculateAndPublishForMaster(masterId, tx);

      return deletedMaster;
    }, tx);
  }

  /**
   * Master 복원 (product_masters.deletedAt = null)
   */
  async restoreMaster(masterId: string, tx?: DbTransaction): Promise<ProductMaster> {
    return await this.db.run(async (tx) => {
      // 1. Master 존재 확인 (includeDeleted)
      const [master] = await tx.select().from(productMasters).where(eq(productMasters.id, masterId));

      if (!master) {
        throw new NotFoundException(`Master not found: ${masterId}`);
      }

      if (!master.deletedAt) {
        throw new BadRequestException('Master is not deleted');
      }

      // 2. Master 복원
      const [restoredMaster] = await tx
        .update(productMasters)
        .set({
          deletedAt: null,
          deletedBy: null,
        })
        .where(eq(productMasters.id, masterId))
        .returning();

      await this.productSellableQuantity.recalculateAndPublishForMaster(masterId, tx);

      return restoredMaster;
    }, tx);
  }

  /**
   * Get all soft-deleted products
   */
  async findDeleted(tx?: DbTransaction): Promise<MasterProductWithPrimaryVersionDto[]> {
    return await this.db.run(async (tx) => {
      // 모든 master 를 가져오고, 각 master 에 보여줄 버전을 1) active, 2) inactive 최신, 3) 없으면 null 순서로 선택
      const masters = await tx.select().from(productMasters).where(isNotNull(productMasters.deletedAt)); // 삭제된 master 만 가져올 경우

      const results: MasterProductWithPrimaryVersionDto[] = [];

      for (const master of masters) {
        let primaryVersion: ProductVersionDto | null = null;

        // 1. active 버전 조회
        const [activeVersion] = await tx
          .select()
          .from(productMasterVersions)
          .where(and(eq(productMasterVersions.masterId, master.id), eq(productMasterVersions.status, 'active')))
          .limit(1);

        if (activeVersion) {
          primaryVersion = activeVersion;
        } else {
          // 2. 가장 최근 inactive 버전 조회
          const [inactiveVersion] = await tx
            .select()
            .from(productMasterVersions)
            .where(and(eq(productMasterVersions.masterId, master.id), eq(productMasterVersions.status, 'inactive')))
            .orderBy(desc(productMasterVersions.createdAt))
            .limit(1);

          if (inactiveVersion) {
            primaryVersion = inactiveVersion;
          }
        }

        results.push({
          ...master,
          primaryVersion: primaryVersion,
        });
      }

      return results;
    }, tx);
  }

  /**
   * Hard delete (permanent) - use with caution
   */
  async hardDelete(id: string, userId: string, tx?: DbTransaction): Promise<{ deleted: boolean }> {
    return await this.db.run(async (tx) => {
      // Check if product exists
      const [product] = await tx.select().from(productMasterVersions).where(eq(productMasterVersions.id, id));

      if (!product) {
        throw new NotFoundException(`Product with ID ${id} not found`);
      }

      // Log before deletion (orphaned record)
      await this.logAudit(
        {
          versionId: id,
          action: 'hard_deleted',
          changes: { permanent: true },
          userId,
        },
        tx,
      );

      const purchaseConstraintMappings = await tx
        .select({ purchaseConstraintId: productMasterPurchaseConstraints.purchaseConstraintId })
        .from(productMasterPurchaseConstraints)
        .where(
          and(
            eq(productMasterPurchaseConstraints.masterId, product.masterId),
            eq(productMasterPurchaseConstraints.versionId, id),
          ),
        );

      await tx.delete(productMasterVersions).where(eq(productMasterVersions.id, id));

      await this._cleanupOrphanedPurchaseConstraints(
        purchaseConstraintMappings.map((mapping) => mapping.purchaseConstraintId),
        tx,
      );

      return { deleted: true };
    }, tx);
  }

  private async _cleanupOrphanedPurchaseConstraints(
    candidateConstraintIds: string[],
    tx: DbTransaction,
  ): Promise<void> {
    await deleteEntitiesIfUnmapped(
      tx,
      {
        entityTable: productPurchaseConstraints,
        entityIdColumn: productPurchaseConstraints.id,
        junctionTable: productMasterPurchaseConstraints,
        junctionFkColumn: productMasterPurchaseConstraints.purchaseConstraintId,
      },
      candidateConstraintIds,
    );
  }

  /**
   * Apply option diff to a draft version
   */
  private async _applyOptionDiff(
    versionId: string,
    masterId: string,
    optionDiff: OptionDiff,
    tx: DbTransaction,
  ): Promise<boolean> {
    let structureChanged = false;
    const locale = 'ko-KR';

    // 1. add: 새 옵션 그룹 추가
    if (optionDiff.add && optionDiff.add.length > 0) {
      structureChanged = true;
      for (const addOption of optionDiff.add) {
        // 옵션 그룹 엔티티 생성
        const [optionGroup] = await tx.insert(productOptionGroups).values({}).returning();

        // Display 정보 저장
        await tx.insert(productOptionGroupDisplays).values({
          optionGroupId: optionGroup.id,
          masterId: masterId,
          versionId: versionId,
          locale,
          displayName: addOption.displayName,
          description: addOption.description,
          sortOrder: addOption.sortOrder ?? 0,
        });

        // 매핑 테이블 연결
        await tx.insert(productMasterOptionGroups).values({
          id: uuidv7(),
          masterId: masterId,
          optionGroupId: optionGroup.id,
          versionId: versionId,
        });

        // 옵션 값들 생성
        for (const addValue of addOption.values) {
          const [optionValue] = await tx
            .insert(productOptionValues)
            .values({ optionGroupId: optionGroup.id })
            .returning();

          await tx.insert(productOptionValueDisplays).values({
            optionValueId: optionValue.id,
            masterId: masterId,
            versionId: versionId,
            locale,
            displayName: addValue.displayName,
            colorCode: addValue.colorCode,
            imageUrl: addValue.imageUrl,
            sortOrder: addValue.sortOrder ?? 0,
          });
        }
      }
    }

    // 2. modifyDisplay: 표시 정보만 수정
    if (optionDiff.modifyDisplay && optionDiff.modifyDisplay.length > 0) {
      for (const modify of optionDiff.modifyDisplay) {
        const updates: any = {};
        if (modify.displayName) updates.displayName = modify.displayName;
        if (modify.description !== undefined) updates.description = modify.description;
        if (modify.sortOrder !== undefined) updates.sortOrder = modify.sortOrder;

        if (Object.keys(updates).length > 0) {
          await tx
            .update(productOptionGroupDisplays)
            .set(updates)
            .where(
              and(
                eq(productOptionGroupDisplays.optionGroupId, modify.optionGroupId),
                eq(productOptionGroupDisplays.masterId, masterId),
                eq(productOptionGroupDisplays.versionId, versionId),
                eq(productOptionGroupDisplays.locale, locale),
              ),
            );
        }

        if (modify.values && modify.values.length > 0) {
          for (const valueModify of modify.values) {
            const valueUpdates: any = {};
            if (valueModify.displayName) valueUpdates.displayName = valueModify.displayName;
            if (valueModify.colorCode !== undefined) valueUpdates.colorCode = valueModify.colorCode;
            if (valueModify.imageUrl !== undefined) valueUpdates.imageUrl = valueModify.imageUrl;
            if (valueModify.sortOrder !== undefined) valueUpdates.sortOrder = valueModify.sortOrder;

            if (Object.keys(valueUpdates).length > 0) {
              await tx
                .update(productOptionValueDisplays)
                .set(valueUpdates)
                .where(
                  and(
                    eq(productOptionValueDisplays.optionValueId, valueModify.optionValueId),
                    eq(productOptionValueDisplays.masterId, masterId),
                    eq(productOptionValueDisplays.versionId, versionId),
                    eq(productOptionValueDisplays.locale, locale),
                  ),
                );
            }
          }
        }
      }
    }

    // 3. addValues: 기존 옵션 그룹에 새 값 추가
    if (optionDiff.addValues && optionDiff.addValues.length > 0) {
      structureChanged = true;
      for (const addValues of optionDiff.addValues) {
        for (const addValue of addValues.values) {
          const [optionValue] = await tx
            .insert(productOptionValues)
            .values({ optionGroupId: addValues.optionGroupId })
            .returning();

          await tx.insert(productOptionValueDisplays).values({
            optionValueId: optionValue.id,
            masterId: masterId,
            versionId: versionId,
            locale,
            displayName: addValue.displayName,
            colorCode: addValue.colorCode,
            imageUrl: addValue.imageUrl,
            sortOrder: addValue.sortOrder ?? 0,
          });
        }
      }
    }

    // 4. removeValues: 기존 옵션 그룹에서 값 삭제
    if (optionDiff.removeValues && optionDiff.removeValues.length > 0) {
      structureChanged = true;
      for (const removeValues of optionDiff.removeValues) {
        for (const optionValueId of removeValues.optionValueIds) {
          await tx
            .delete(productOptionValueDisplays)
            .where(
              and(
                eq(productOptionValueDisplays.optionValueId, optionValueId),
                eq(productOptionValueDisplays.masterId, masterId),
                eq(productOptionValueDisplays.versionId, versionId),
              ),
            );

          this.logger.log(`Removed option value ${optionValueId} from master ${masterId} version ${versionId}`);
        }
      }
    }

    // 5. remove: 옵션 그룹 제거 (매핑만 제거)
    if (optionDiff.remove && optionDiff.remove.length > 0) {
      structureChanged = true;
      for (const optionGroupId of optionDiff.remove) {
        await tx
          .delete(productMasterOptionGroups)
          .where(
            and(
              eq(productMasterOptionGroups.masterId, masterId),
              eq(productMasterOptionGroups.optionGroupId, optionGroupId),
              eq(productMasterOptionGroups.versionId, versionId),
            ),
          );
      }
    }

    return structureChanged;
  }

  /**
   * 옵션 구조 변경에 따른 variant 재생성
   * - 옵션 그룹 추가/삭제: 모든 기존 variant 버리고 재생성
   * - 옵션값만 추가/삭제: 승계 가능한 variant는 승계, 나머지는 증분 처리
   */
  private async _regenerateVariantsForVersion(
    masterId: string,
    versionId: string,
    changeType: 'option_group_changed' | 'option_value_changed',
    tx: DbTransaction,
  ): Promise<void> {
    const [master] = await tx
      .select()
      .from(productMasterVersions)
      .where(and(eq(productMasterVersions.masterId, masterId), eq(productMasterVersions.id, versionId)))
      .limit(1);

    if (!master) {
      throw new NotFoundException(`Master not found: ${masterId} version ${versionId}`);
    }

    const locale = 'ko-KR';

    if (changeType === 'option_group_changed') {
      // 옵션 그룹 구조 변경 → 전체 재생성
      this.logger.log(
        `Option group structure changed for ${master.masterId} v${versionId}. Regenerating all variants.`,
      );

      // 1. 기존 매핑 조회 (삭제 전에 저장)
      const existingMappings = await tx
        .select({ variantId: productMasterVariants.variantId })
        .from(productMasterVariants)
        .where(
          and(eq(productMasterVariants.masterId, master.masterId), eq(productMasterVariants.versionId, versionId)),
        );

      const existingVariantIds = existingMappings.map((m) => m.variantId);

      // 2. 기존 매핑 모두 삭제
      await tx
        .delete(productMasterVariants)
        .where(
          and(eq(productMasterVariants.masterId, master.masterId), eq(productMasterVariants.versionId, versionId)),
        );

      // 3. 현재 버전의 옵션 구조로 variant 전체 생성 (이벤트 없이)
      const optionGroups = await this._getVersionOptionGroupsWithDisplays(master.masterId, versionId, locale, tx);

      await this._generateVariantsWithoutEvents(master, optionGroups, tx);

      // 4. 제거된 variant 정리 (전체 재생성이므로 모든 기존 variant가 후보)
      const newMappings = await tx
        .select({ variantId: productMasterVariants.variantId })
        .from(productMasterVariants)
        .where(
          and(eq(productMasterVariants.masterId, master.masterId), eq(productMasterVariants.versionId, versionId)),
        );

      const newVariantIds = newMappings.map((m) => m.variantId);
      const removedVariantIds = existingVariantIds.filter((id) => !newVariantIds.includes(id));

      if (removedVariantIds.length > 0) {
        await this._cleanupOrphanedVariants(master.masterId, versionId, removedVariantIds, tx);
      }

      this.logger.log(
        `Variant regeneration complete: ${newVariantIds.length} total variants created (${removedVariantIds.length} removed)`,
      );
    } else {
      // 옵션값만 변경 → 증분 업데이트 (승계 + 추가/제외)
      this.logger.log(`Option values changed for ${master.masterId} v${versionId}. Applying incremental update.`);

      // 1. 현재 버전의 옵션 구조 조회
      const currentOptionGroups = await this._getVersionOptionGroupsWithDisplays(
        master.masterId,
        versionId,
        locale,
        tx,
      );

      if (currentOptionGroups.length === 0) {
        this.logger.warn(`No option groups found for version ${versionId}. Skipping variant regeneration.`);
        return;
      }

      // 2. 새 조합 목록 생성
      const newCombinations = this.generateOptionCombinations(currentOptionGroups);

      // 3. 부모 버전에서 기존 variant 조회
      const parentVersionVariants = await this._getParentVersionVariants(master.masterId, versionId, tx);

      // 4. 기존 매핑 조회 (삭제 전에 저장)
      const existingMappings = await tx
        .select({ variantId: productMasterVariants.variantId })
        .from(productMasterVariants)
        .where(
          and(eq(productMasterVariants.masterId, master.masterId), eq(productMasterVariants.versionId, versionId)),
        );

      const existingVariantIds = existingMappings.map((m) => m.variantId);

      // 5. 기존 매핑 삭제
      await tx
        .delete(productMasterVariants)
        .where(
          and(eq(productMasterVariants.masterId, master.masterId), eq(productMasterVariants.versionId, versionId)),
        );

      // 6. 승계 및 신규 생성
      let inheritedCount = 0;
      let createdCount = 0;
      const newVariantIds: string[] = [];

      for (const combination of newCombinations) {
        const matchingVariant = this._findMatchingVariant(parentVersionVariants, combination);

        if (matchingVariant) {
          // 승계: 기존 variant 매핑 복사
          await tx.insert(productMasterVariants).values({
            id: uuidv7(),
            masterId: master.masterId,
            variantId: matchingVariant.variantId,
            versionId: versionId,
            createdAt: new Date(),
          });

          newVariantIds.push(matchingVariant.variantId);
          inheritedCount++;
          this.logger.debug(`Inherited variant ${matchingVariant.variantId} to v${versionId}`);
        } else {
          // 신규 생성 (이벤트 없이)
          const [variant] = await tx
            .insert(productVariants)
            .values({
              variantName: combination.map((v) => v.displayName).join(' × '),
              isDefault: false,
              status: 'active',
            })
            .returning();

          await tx.insert(productMasterVariants).values({
            id: uuidv7(),
            masterId: master.masterId,
            variantId: variant.id,
            versionId: versionId,
            createdAt: new Date(),
          });

          // variant-option 연결
          for (const optionValue of combination) {
            await tx.insert(variantOptionValues).values({
              variantId: variant.id,
              optionValueId: optionValue.optionValueId || optionValue.id,
            });
          }

          newVariantIds.push(variant.id);
          createdCount++;
          this.logger.debug(`Created new variant ${variant.id} for v${versionId}`);
        }
      }

      // 7. 제거된 variant 정리
      const removedVariantIds = existingVariantIds.filter((id) => !newVariantIds.includes(id));

      if (removedVariantIds.length > 0) {
        await this._cleanupOrphanedVariants(master.masterId, versionId, removedVariantIds, tx);
      }

      this.logger.log(
        `Variant regeneration complete: ${inheritedCount} inherited, ${createdCount} created, ${newVariantIds.length} total (${removedVariantIds.length} removed)`,
      );
    }
  }

  /**
   * 이벤트 발행 없이 variant 생성 (_generateVariants의 복사본)
   */
  private async _generateVariantsWithoutEvents(
    version: ProductMasterVersion,
    optionGroups: any[],
    tx: DbTransaction,
  ): Promise<void> {
    if (!optionGroups || optionGroups.length === 0) {
      const [variant] = await tx
        .insert(productVariants)
        .values({
          variantName: null,
          isDefault: true,
          status: 'active',
        })
        .returning();

      await tx.insert(productMasterVariants).values({
        id: uuidv7(),
        masterId: version.masterId,
        variantId: variant.id,
        versionId: version.id,
        createdAt: new Date(),
      });

      return;
    }

    const combinations = this.generateOptionCombinations(optionGroups);

    for (const combination of combinations) {
      const [variant] = await tx
        .insert(productVariants)
        .values({
          variantName: combination.map((v) => v.displayName).join(' × '),
          isDefault: false,
          status: 'active',
        })
        .returning();

      await tx.insert(productMasterVariants).values({
        id: uuidv7(),
        masterId: version.masterId,
        variantId: variant.id,
        versionId: version.id,
        createdAt: new Date(),
      });

      for (const optionValue of combination) {
        await tx.insert(variantOptionValues).values({
          variantId: variant.id,
          optionValueId: optionValue.optionValueId || optionValue.id,
        });
      }
    }
  }

  /**
   * 부모 버전의 variant와 옵션 조합 조회
   */
  private async _getParentVersionVariants(
    masterId: string,
    versionId: string,
    tx: DbTransaction,
  ): Promise<Array<{ variantId: string; optionValueIds: string[] }>> {
    // 현재 버전의 부모 조회
    const [currentVersionRow] = await tx
      .select({ parentVersionId: productMasterVersions.parentVersionId })
      .from(productMasterVersions)
      .where(and(eq(productMasterVersions.masterId, masterId), eq(productMasterVersions.id, versionId)))
      .limit(1);

    if (!currentVersionRow || !currentVersionRow.parentVersionId) {
      this.logger.debug(`No parent version for v${versionId}`);
      return [];
    }

    // 부모 버전 정보 조회
    const [parentVersion] = await tx
      .select()
      .from(productMasterVersions)
      .where(eq(productMasterVersions.id, currentVersionRow.parentVersionId))
      .limit(1);

    if (!parentVersion) {
      this.logger.warn(`Parent version not found: ${currentVersionRow.parentVersionId}`);
      return [];
    }

    // 부모 버전의 variant 매핑 조회
    const variantMappings = await tx
      .select()
      .from(productMasterVariants)
      .where(and(eq(productMasterVariants.masterId, masterId), eq(productMasterVariants.versionId, parentVersion.id)));

    const result: Array<{ variantId: string; optionValueIds: string[] }> = [];
    for (const mapping of variantMappings) {
      const optionValues = await tx
        .select({ optionValueId: variantOptionValues.optionValueId })
        .from(variantOptionValues)
        .where(eq(variantOptionValues.variantId, mapping.variantId));

      result.push({
        variantId: mapping.variantId,
        optionValueIds: optionValues.map((ov) => ov.optionValueId),
      });
    }

    this.logger.debug(`Found ${result.length} variants in parent version ${parentVersion.version}`);

    return result;
  }

  /**
   * 옵션 조합이 동일한 variant 찾기
   */
  private _findMatchingVariant(
    parentVariants: Array<{ variantId: string; optionValueIds: string[] }>,
    combination: any[],
  ): { variantId: string } | null {
    const targetIds = combination.map((c) => c.optionValueId || c.id).sort();

    for (const parentVariant of parentVariants) {
      const parentIds = [...parentVariant.optionValueIds].sort();

      if (targetIds.length === parentIds.length && targetIds.every((id, idx) => id === parentIds[idx])) {
        return { variantId: parentVariant.variantId };
      }
    }

    return null;
  }

  /**
   * 고아 variant 정리
   * - 오직 하나의 draft 버전에만 참조되던 variant가 제거될 때 엔티티 삭제
   * - Active/inactive 버전이 참조하거나, 여러 버전이 참조하면 삭제 불가
   */
  private async _cleanupOrphanedVariants(
    masterId: string,
    versionId: string,
    removedVariantIds: string[],
    tx: DbTransaction,
  ): Promise<void> {
    if (removedVariantIds.length === 0) {
      return;
    }

    let deletedCount = 0;

    for (const variantId of removedVariantIds) {
      // 1. 이 variant를 참조하는 모든 버전 매핑 조회
      const allMappings = await tx
        .select({
          versionId: productMasterVariants.versionId,
          status: productMasterVersions.status,
        })
        .from(productMasterVariants)
        .innerJoin(
          productMasterVersions,
          and(
            eq(productMasterVariants.masterId, productMasterVersions.masterId),
            eq(productMasterVariants.versionId, productMasterVersions.id),
          ),
        )
        .where(and(eq(productMasterVariants.masterId, masterId), eq(productMasterVariants.variantId, variantId)));

      // 2. 삭제 조건 검증
      const canDelete =
        allMappings.length === 0 ||
        (allMappings.length === 1 && allMappings[0].status === 'draft' && allMappings[0].versionId === versionId);

      if (canDelete) {
        // 3. Variant 엔티티 삭제
        await tx.delete(productVariants).where(eq(productVariants.id, variantId));

        deletedCount++;
        this.logger.log(
          `Deleted orphaned variant entity: ${variantId} (only referenced by current draft v${versionId})`,
        );
      } else {
        this.logger.debug(
          `Kept variant entity: ${variantId} (referenced by ${allMappings.length} version(s): ${allMappings.map((m) => `v${m.versionId}(${m.status})`).join(', ')})`,
        );
      }
    }

    if (deletedCount > 0) {
      this.logger.log(
        `Cleaned up ${deletedCount} orphaned variant entities out of ${removedVariantIds.length} candidates`,
      );
    }
  }

  /**
   * Get version option groups with display information
   */

  private async _getVersionOptionGroupsWithDisplays(
    masterId: string,
    versionId: string,
    locale: string = 'ko-KR',
    tx: DbTransaction,
  ): Promise<VersionOptionGroupWithDisplays[]> {
    const groups = await tx
      .select({
        optionGroupId: productMasterOptionGroups.optionGroupId,
        displayName: productOptionGroupDisplays.displayName,
        description: productOptionGroupDisplays.description,
        sortOrder: productOptionGroupDisplays.sortOrder,
      })
      .from(productMasterOptionGroups)
      .innerJoin(
        productOptionGroupDisplays,
        and(
          eq(productMasterOptionGroups.optionGroupId, productOptionGroupDisplays.optionGroupId),
          eq(productMasterOptionGroups.masterId, productOptionGroupDisplays.masterId),
          eq(productMasterOptionGroups.versionId, productOptionGroupDisplays.versionId),
          eq(productOptionGroupDisplays.locale, locale),
        ),
      )
      .where(and(eq(productMasterOptionGroups.masterId, masterId), eq(productMasterOptionGroups.versionId, versionId)))
      .orderBy(productOptionGroupDisplays.sortOrder);

    const result: VersionOptionGroupWithDisplays[] = [];

    for (const group of groups) {
      const values = await tx
        .select({
          optionValueId: productOptionValues.id,
          displayName: productOptionValueDisplays.displayName,
          colorCode: productOptionValueDisplays.colorCode,
          imageUrl: productOptionValueDisplays.imageUrl,
          sortOrder: productOptionValueDisplays.sortOrder,
        })
        .from(productOptionValues)
        .innerJoin(
          productOptionValueDisplays,
          and(
            eq(productOptionValues.id, productOptionValueDisplays.optionValueId),
            eq(productOptionValueDisplays.masterId, masterId),
            eq(productOptionValueDisplays.versionId, versionId),
            eq(productOptionValueDisplays.locale, locale),
          ),
        )
        .where(eq(productOptionValues.optionGroupId, group.optionGroupId))
        .orderBy(productOptionValueDisplays.sortOrder);

      result.push({
        ...group,
        values,
      });
    }

    return result;
  }

  /**
   * Log audit event
   */
  private async logAudit(
    data: {
      versionId: string;
      action: string;
      changes: Record<string, any>;
      userId: string;
    },
    tx?: DbTransaction,
  ) {
    return this.db.run(async (tx) => {
      await tx.insert(productAuditLog).values({
        versionId: data.versionId,
        action: data.action,
        changes: data.changes,
        userId: data.userId,
      });
    }, tx);
  }
}
