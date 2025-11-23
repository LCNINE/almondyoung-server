import { Injectable, Logger, forwardRef, Inject } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { InjectStreamPublisher, StreamPublisher } from '@app/events';
import { PRODUCT_STREAM, ProductEvents } from '@packages/event-contracts';
import {
  CreateMasterDto,
  MasterDetailDto,
  ProductMaster,
  NewProductMaster,
  UpdateProductMaster,
  DbTransaction,
  OptionDiff,
} from '../../../types';
import {
  type PimSchema,
  productMasters,
  productMasterCategories,
  productCategories,
  productOptionGroups,
  productOptionValues,
  productOptionGroupDisplays,
  productOptionValueDisplays,
  productVariants,
  variantOptionValues,
  productImages,
  uploads,
  productAuditLog,
  productMasterOptionGroups,
  productMasterVariants,
  productMasterPricingRules,
  productTagValues,
  tagValues,
  tagGroups,
} from '../../../schema';
import { eq, and, ilike, count, asc, desc, inArray, isNull, isNotNull } from 'drizzle-orm';
import { ProductVersionsService } from './product-versions.service';
import { v7 as uuidv7 } from 'uuid';

@Injectable()
export class ProductMastersService {
  private readonly logger = new Logger(ProductMastersService.name);

  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,

    @InjectStreamPublisher(PRODUCT_STREAM.topic.topic)
    private readonly productPublisher: StreamPublisher<ProductEvents>,

    @Inject(forwardRef(() => ProductVersionsService))
    private readonly productVersionsService: ProductVersionsService,
  ) { }

  private async _linkImages(
    masterId: string,
    data: CreateMasterDto,
    tx: DbTransaction,
  ): Promise<void> {
    // 썸네일 URL 직접 사용 (외부 URL 그대로)
    if ((data as any).thumbnailUrl) {
      await tx
        .update(productMasters)
        .set({ thumbnail: (data as any).thumbnailUrl })
        .where(eq(productMasters.id, masterId));
    }
    // 기존 업로드 방식도 지원 (하위 호환성)
    else if ((data as any).thumbnailUploadId) {
      const uploadResult = await tx
        .select({ url: uploads.url })
        .from(uploads)
        .where(eq(uploads.id, (data as any).thumbnailUploadId))
        .limit(1);

      if (uploadResult.length > 0) {
        await tx
          .update(productMasters)
          .set({ thumbnail: uploadResult[0].url })
          .where(eq(productMasters.id, masterId));
      }
    }
  }

  private getClient(tx?: DbTransaction) {
    return tx ?? this.db.db;
  }

  /**
   * ProductVariantCreated 이벤트 발행
   *
   * variant 생성 시 WMS에 매칭 생성을 위한 이벤트를 발행합니다.
   * 이벤트 발행 실패해도 트랜잭션은 커밋됩니다 (Orchestrator가 WMS에 직접 요청하므로 복원력 보장).
   */
  private async publishVariantCreatedEvent(
    master: ProductMaster,
    variant: any,
    optionCombination: Array<{ name: string; value: string }> | null,
  ): Promise<void> {
    try {
      await this.productPublisher.publishEvent({
        eventType: 'ProductVariantCreated',
        aggregateId: master.id,
        payload: {
          productId: master.id,
          productName: master.name,
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

      this.logger.log(
        `📤 Published ProductVariantCreated: ${variant.id} (${master.name})`,
      );
    } catch (error) {
      this.logger.error(
        `❌ Failed to publish ProductVariantCreated: ${variant.id}`,
        error.stack,
      );
      // 이벤트 발행 실패해도 트랜잭션은 커밋
      // Orchestrator가 WMS에 직접 요청하므로 복원력 보장
    }
  }

  async createMaster(
    data: CreateMasterDto,
    tx?: DbTransaction,
  ): Promise<ProductMaster> {
    return tx
      ? this._createMasterWithinTransaction(data, tx)
      : this.db.db.transaction(async (txn) => {
        return this._createMasterWithinTransaction(data, txn);
      });
  }

  private async _createMasterWithinTransaction(
    data: CreateMasterDto,
    tx: DbTransaction,
  ): Promise<ProductMaster> {
    // 버전 관리: masterId는 논리적 그룹 ID, id는 물리적 버전 ID
    const masterId = uuidv7();  // 논리적 판매상품 그룹 ID
    const versionId = uuidv7(); // 첫 번째 버전의 물리적 ID

    // 빈 draft 상태로 생성 - 모든 세부사항은 update API로 채움
    const masterData = {
      id: versionId,
      masterId: masterId,
      version: 1,
      versionStatus: 'draft',
      parentVersionId: null,
      draftOwnerId: null,

      // 제공된 필드만 사용, 나머지는 기본값
      name: data.name || '새 상품',
      description: data.description ?? null,
      brand: data.brand ?? null,
      thumbnail: data.thumbnail ?? null,
      descriptionHtml: data.description ?? null,
      tags: data.tags ?? [],
      images: data.images ?? null,
      attributes: data.attributes ?? {},
      seoTitle: data.seoTitle ?? null,
      seoDescription: data.seoDescription ?? null,
      seoKeywords: data.seoKeywords ?? [],
      isWholesaleOnly: data.isWholesaleOnly ?? false,
      isMembershipOnly: data.isMembershipOnly ?? false,
      status: 'draft',
    };

    const [master] = await tx
      .insert(productMasters)
      .values(masterData as any)
      .returning();

    // 항상 기본 variant 1개 생성 (옵션 없음)
    const [variant] = await tx
      .insert(productVariants)
      .values({
        variantName: null,
        isDefault: true,
        status: 'active',
      })
      .returning();

    // 매핑 테이블에 연결
    await tx.insert(productMasterVariants).values({
      id: uuidv7(),
      masterId: master.masterId,
      variantId: variant.id,
      version: master.version,
      createdAt: new Date(),
    });

    // WMS 이벤트 발행
    await this.publishVariantCreatedEvent(master, variant, null);

    return master;
  }

  private async _linkCategories(
    masterId: string,
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

    const existingCategoryIds = existingCategories.map(c => c.id);
    const missingCategoryIds = categoryIds.filter(id => !existingCategoryIds.includes(id));

    if (missingCategoryIds.length > 0) {
      throw new Error(`Categories not found: ${missingCategoryIds.join(', ')}`);
    }

    // Validate primaryCategoryId if provided
    if (primaryCategoryId && !categoryIds.includes(primaryCategoryId)) {
      throw new Error('primaryCategoryId must be one of the categoryIds');
    }

    // Create category relations
    const categoryRelations = categoryIds.map(categoryId => ({
      masterId: masterId,
      categoryId: categoryId,
      isPrimary: categoryId === primaryCategoryId,
      createdAt: new Date(),
    }));

    await tx.insert(productMasterCategories).values(categoryRelations);
  }

  private async _generateVariants(
    master: ProductMaster,
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

      // 매핑 테이블에 연결
      await tx.insert(productMasterVariants).values({
        id: uuidv7(),
        masterId: master.masterId,
        variantId: variant.id,
        version: master.version,
        createdAt: new Date(),
      });

      // 이벤트 발행
      await this.publishVariantCreatedEvent(master, variant, null);

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

      // 매핑 테이블에 연결
      await tx.insert(productMasterVariants).values({
        id: uuidv7(),
        masterId: master.masterId,
        variantId: variant.id,
        version: master.version,
        createdAt: new Date(),
      });

      for (const optionValue of combination) {
        await tx.insert(variantOptionValues).values({
          variantId: variant.id,
          optionValueId: optionValue.id,
        });
      }

      // 이벤트 발행 (옵션 조합 포함)
      await this.publishVariantCreatedEvent(
        master,
        variant,
        combination.map((opt) => ({
          name: opt.groupName || opt.name,
          value: opt.displayName,
        })),
      );
    }
  }

  async getVersionById(
    versionId: string,
    tx?: DbTransaction,
    options?: { includeDeleted?: boolean; throwIfNotFound?: boolean }
  ): Promise<ProductMaster | null> {
    if (!versionId) {
      throw new Error('Version ID is required');
    }

    const client = this.getClient(tx);

    const conditions = [eq(productMasters.id, versionId)];
    if (!options?.includeDeleted) {
      conditions.push(isNull(productMasters.deletedAt));
    }

    const result = await client
      .select()
      .from(productMasters)
      .where(and(...conditions));

    const version = result.length > 0 ? result[0] : null;

    if (!version && options?.throwIfNotFound) {
      throw new Error(`Version ${versionId} not found`);
    }

    return version;
  }

  async getMasterById(
    masterId: string,
    tx?: DbTransaction,
  ): Promise<ProductMaster | null> {
    if (!masterId) {
      throw new Error('Master ID is required');
    }

    const client = this.getClient(tx);

    const [activeMaster] = await client
      .select()
      .from(productMasters)
      .where(
        and(
          eq(productMasters.masterId, masterId),
          eq(productMasters.versionStatus, 'active'),
          isNull(productMasters.deletedAt)
        )
      )
      .limit(1);

    return activeMaster || null;
  }

  async getMasterWithImages(
    masterId: string,
    tx?: DbTransaction,
  ): Promise<
    (ProductMaster & { images: { primary: any; additional: any[] } }) | null
  > {
    if (!masterId) {
      throw new Error('Master ID is required');
    }

    const client = this.getClient(tx);

    // 1. 상품 기본 정보 조회 (active 버전)
    const masterResult = await client
      .select()
      .from(productMasters)
      .where(
        and(
          eq(productMasters.masterId, masterId),
          eq(productMasters.versionStatus, 'active'),
        ),
      )
      .limit(1);

    if (masterResult.length === 0) {
      return null;
    }

    const master = masterResult[0];

    // 2. 상품에 연결된 이미지 + 업로드 정보 join
    const images = await client
      .select({
        id: productImages.id,
        isPrimary: productImages.isPrimary,
        sortOrder: productImages.sortOrder,
        url: uploads.url,
        originalName: uploads.originalName,
        fileName: uploads.fileName,
        mimeType: uploads.mimeType,
        size: uploads.size,
      })
      .from(productImages)
      .innerJoin(uploads, eq(productImages.uploadId, uploads.id))
      .where(eq(productImages.masterId, masterId))
      .orderBy(desc(productImages.isPrimary), asc(productImages.sortOrder));

    // 3. 대표이미지와 부가이미지 분리
    const primaryImage = images.find((img) => img.isPrimary) || null;
    const additionalImages = images.filter((img) => !img.isPrimary);

    return {
      ...master,
      images: {
        primary: primaryImage,
        additional: additionalImages,
      },
    };
  }

  async getMasterDetail(
    masterId: string,
    version?: number,
    tx?: DbTransaction,
  ): Promise<MasterDetailDto | null> {
    const client = this.getClient(tx);

    // version이 지정되지 않으면 active 버전 사용
    let actualVersion = version;
    if (actualVersion === undefined) {
      const [activeMaster] = await client
        .select({ version: productMasters.version })
        .from(productMasters)
        .where(
          and(
            eq(productMasters.masterId, masterId),
            eq(productMasters.versionStatus, 'active'),
          ),
        )
        .limit(1);

      if (!activeMaster) {
        return null;
      }
      actualVersion = activeMaster.version;
    }

    const [master] = await client
      .select()
      .from(productMasters)
      .where(
        and(
          eq(productMasters.masterId, masterId),
          eq(productMasters.version, actualVersion)
        )
      )
      .limit(1);

    if (!master) {
      return null;
    }

    // 매핑 테이블을 통해 optionGroups 조회 + Display 테이블 JOIN
    const optionGroupResults = await client
      .select({
        id: productOptionGroups.id,
        displayName: productOptionGroupDisplays.displayName,
        sortOrder: productOptionGroupDisplays.sortOrder,
        createdAt: productOptionGroups.createdAt,
      })
      .from(productMasterOptionGroups)
      .innerJoin(
        productOptionGroups,
        eq(productMasterOptionGroups.optionGroupId, productOptionGroups.id),
      )
      .innerJoin(
        productOptionGroupDisplays,
        and(
          eq(productOptionGroups.id, productOptionGroupDisplays.optionGroupId),
          eq(productOptionGroupDisplays.masterId, masterId),
          eq(productOptionGroupDisplays.version, actualVersion),
          eq(productOptionGroupDisplays.locale, 'ko-KR'),
        ),
      )
      .where(
        and(
          eq(productMasterOptionGroups.masterId, masterId),
          eq(productMasterOptionGroups.version, actualVersion),
        ),
      )
      .orderBy(asc(productOptionGroupDisplays.sortOrder));

    const optionGroupsWithValues: any[] = [];
    for (const group of optionGroupResults) {
      // Display 테이블을 통해 optionValues 조회
      const values = await client
        .select({
          id: productOptionValues.id,
          optionGroupId: productOptionValues.optionGroupId,
          displayName: productOptionValueDisplays.displayName,
          sortOrder: productOptionValueDisplays.sortOrder,
          createdAt: productOptionValues.createdAt,
        })
        .from(productOptionValues)
        .innerJoin(
          productOptionValueDisplays,
          and(
            eq(productOptionValues.id, productOptionValueDisplays.optionValueId),
            eq(productOptionValueDisplays.masterId, masterId),
            eq(productOptionValueDisplays.version, actualVersion),
            eq(productOptionValueDisplays.locale, 'ko-KR'),
          ),
        )
        .where(eq(productOptionValues.optionGroupId, group.id))
        .orderBy(asc(productOptionValueDisplays.sortOrder));

      optionGroupsWithValues.push({
        ...group,
        values,
      });
    }

    // 매핑 테이블을 통해 variants 조회
    const variantResults = await client
      .select()
      .from(productMasterVariants)
      .innerJoin(
        productVariants,
        eq(productMasterVariants.variantId, productVariants.id),
      )
      .where(
        and(
          eq(productMasterVariants.masterId, masterId),
          eq(productMasterVariants.version, actualVersion),
        ),
      )
      .orderBy(asc(productVariants.displayOrder));

    const variants = variantResults.map((r) => r.product_variants);

    const channelProducts = [];

    // 태그 값 조회 (masterId, version 기준)
    const tagResults = await client
      .select({
        tagValueId: productTagValues.tagValueId,
        tagValueName: tagValues.name,
        tagValueDisplayOrder: tagValues.displayOrder,
        tagGroupId: tagGroups.id,
        tagGroupName: tagGroups.name,
      })
      .from(productTagValues)
      .innerJoin(
        tagValues,
        eq(productTagValues.tagValueId, tagValues.id)
      )
      .innerJoin(
        tagGroups,
        eq(tagValues.groupId, tagGroups.id)
      )
      .where(
        and(
          eq(productTagValues.masterId, masterId),
          eq(productTagValues.version, actualVersion),
          eq(tagValues.isActive, true),
          eq(tagGroups.isActive, true)
        )
      )
      .orderBy(
        asc(tagGroups.displayOrder),
        asc(tagValues.displayOrder)
      );

    const tags = tagResults.map(r => ({
      id: r.tagValueId,
      name: r.tagValueName,
      displayOrder: r.tagValueDisplayOrder,
      groupId: r.tagGroupId,
      groupName: r.tagGroupName,
    }));

    return {
      ...master,
      optionGroups: optionGroupsWithValues,
      variants: variants.map((v) => ({ ...v, optionValues: [] })),
      channelProducts,
      tagValues: tags,
    };
  }

  async getMasters(
    filters?: {
      status?: string;
      categoryId?: string;
      brand?: string;
      search?: string;
      page?: number;
      limit?: number;
      includeDeleted?: boolean;
    },
    tx?: DbTransaction,
  ): Promise<{
    data: {
      id: string;
      name: string;
      thumbnail: string | null;
      isMembershipOnly: boolean | null;
      status: string | null;
      createdAt: string | null;
    }[];
    total: number;
    page: number;
    limit: number;
  }> {
    const client = this.getClient(tx);

    // 고지훈 임시 수정 - page가 없으면 전체 상품 반환 (검색 기능용)
    const returnAll = filters?.page === undefined;
    const page = filters?.page || 1;
    const limit = returnAll ? 99999 : Math.min(filters?.limit || 20, 100);
    const offset = (page - 1) * limit;

    const whereConditions: any[] = [];

    // Add soft delete filter (unless explicitly including deleted)
    if (!filters?.includeDeleted) {
      whereConditions.push(isNull(productMasters.deletedAt));
    }

    if (filters?.status) {
      whereConditions.push(eq(productMasters.status, filters.status));
    }

    if (filters?.brand) {
      whereConditions.push(eq(productMasters.brand, filters.brand));
    }
    if (filters?.search) {
      whereConditions.push(ilike(productMasters.name, `%${filters.search}%`));
    }

    // 고지훈 임시 수정 - 카테고리 필터링 구현 (하위 카테고리 포함)
    // 카테고리 필터가 있는 경우와 없는 경우를 분리 처리
    if (filters?.categoryId) {
      // 1. 하위 카테고리 ID 목록 가져오기
      const categoryIds = [filters.categoryId];

      // 하위 카테고리 조회 (재귀적으로 모든 하위 카테고리 찾기)
      const getDescendants = async (parentId: string) => {
        const children = await client
          .select()
          .from(productCategories)
          .where(eq(productCategories.parentId, parentId));

        for (const child of children) {
          categoryIds.push(child.id);
          await getDescendants(child.id); // 재귀 호출
        }
      };

      await getDescendants(filters.categoryId);

      // 2. 카테고리 필터가 있는 경우: JOIN 사용
      const whereClause =
        whereConditions.length > 0 ? and(...whereConditions) : undefined;

      // COUNT 쿼리 (JOIN 포함, 하위 카테고리도 포함)
      const countBaseQuery = client
        .select({ count: count() })
        .from(productMasters)
        .innerJoin(
          productMasterCategories,
          eq(productMasters.id, productMasterCategories.masterId),
        );

      const countConditions = [
        inArray(productMasterCategories.categoryId, categoryIds),
      ];
      if (whereClause) {
        countConditions.push(whereClause);
      }

      const countQuery = countBaseQuery.where(and(...countConditions));
      const [{ count: total }] = await countQuery;

      // 데이터 쿼리 (JOIN 포함, 하위 카테고리도 포함)
      const dataQuery = client
        .select({
          id: productMasters.id,
          name: productMasters.name,
          thumbnail: productMasters.thumbnail,
          isMembershipOnly: productMasters.isMembershipOnly,
          status: productMasters.status,
          createdAt: productMasters.createdAt,
        })
        .from(productMasters)
        .innerJoin(
          productMasterCategories,
          eq(productMasters.id, productMasterCategories.masterId),
        )
        .where(and(...countConditions))
        .orderBy(desc(productMasters.createdAt));

      // 고지훈 임시 수정 - page가 있을 때만 limit/offset 적용
      if (!returnAll) {
        dataQuery.limit(limit).offset(offset);
      }

      const rawData = await dataQuery;

      // Date 객체를 ISO 문자열로 변환
      const data = rawData.map((item) => ({
        ...item,
        createdAt: item.createdAt?.toISOString() || null,
        // 고지훈 임시 시연용수정 - 썸네일 이미지 URL 제대로 반환
        thumbnail: item.thumbnail,
        // 고지훈 임시 시연용수정 - 상세설명은 description에 저장됨
      }));

      return {
        data,
        total,
        page,
        limit,
      };
    }

    // 카테고리 필터가 없는 경우: 기존 로직
    const whereClause =
      whereConditions.length > 0 ? and(...whereConditions) : undefined;
    const countQuery = client.select({ count: count() }).from(productMasters);

    if (whereClause) {
      countQuery.where(whereClause);
    }

    const [{ count: total }] = await countQuery;

    // 목록용으로 필요한 필드만 선택
    const dataQuery = client
      .select({
        id: productMasters.id,
        name: productMasters.name,
        brand: productMasters.brand,
        thumbnail: productMasters.thumbnail,
        isMembershipOnly: productMasters.isMembershipOnly,
        status: productMasters.status,
        createdAt: productMasters.createdAt,
      })
      .from(productMasters)
      .orderBy(desc(productMasters.createdAt));

    // 고지훈 임시 수정 - page가 있을 때만 limit/offset 적용
    if (!returnAll) {
      dataQuery.limit(limit).offset(offset);
    }

    if (whereClause) {
      dataQuery.where(whereClause);
    }

    const rawData = await dataQuery;

    // Date 객체를 ISO 문자열로 변환
    const data = rawData.map((item) => ({
      ...item,
      createdAt: item.createdAt?.toISOString() || null,
      // 고지훈 임시 시연용수정 - 썸네일 이미지 URL 제대로 반환
      thumbnail: item.thumbnail,
      // 고지훈 임시 시연용수정 - 상세설명은 description에 저장됨
    }));

    return {
      data,
      total,
      page,
      limit,
    };
  }

  async updateMaster(
    masterId: string,
    data: UpdateProductMaster,
    tx?: DbTransaction,
  ): Promise<ProductMaster> {
    if (!masterId) {
      throw new Error('Master ID is required');
    }

    const executeUpdate = async (txClient: DbTransaction) => {
      // 0. 기존 마스터 조회 (masterId는 versionId임)
      const existingMaster = await this.getVersionById(masterId, txClient);
      if (!existingMaster) {
        throw new Error(`Version not found: ${masterId}`);
      }

      // draft 상태 검증
      if (existingMaster.versionStatus !== 'draft') {
        throw new Error('Only draft versions can be modified');
      }

      // NOTE: Pricing strategy logic has been moved to PricingModule
      // Use the new rule-based pricing API: PUT /products/:masterId/pricing-rules

      // 3. 기본 필드 업데이트
      const {
        categoryIds,
        primaryCategoryId,
        migrationData,
        optionDiff,
        ...masterUpdateData
      } = data;

      // Update master basic info with type safety
      const [updated] = await txClient
        .update(productMasters)
        .set({
          ...(masterUpdateData satisfies Partial<Omit<NewProductMaster, 'id' | 'createdAt' | 'updatedAt'>>),
          updatedAt: new Date()
        })
        .where(eq(productMasters.id, masterId))
        .returning();

      if (!updated) {
        throw new Error(`Failed to update master: ${masterId}`);
      }

      // 4. 카테고리 업데이트
      if (categoryIds !== undefined) {
        // Delete existing relations
        await txClient
          .delete(productMasterCategories)
          .where(eq(productMasterCategories.masterId, masterId));

        // Create new relations
        if (categoryIds.length > 0) {
          await this._linkCategories(
            masterId,
            categoryIds,
            primaryCategoryId,
            txClient
          );
        }
      }

      // 5. 옵션 diff 처리
      if (optionDiff) {
        const structureChanged = await this._applyOptionDiff(
          masterId,
          existingMaster,
          optionDiff,
          txClient,
        );

        // 옵션 구조 변경 시 variants 재생성
        if (structureChanged) {
          const changeType =
            optionDiff.add || optionDiff.remove
              ? 'option_group_changed'
              : 'option_value_changed';

          this.logger.log(
            `Option structure changed for master ${masterId}. Regenerating variants (${changeType})...`,
          );

          await this._regenerateVariantsForVersion(
            existingMaster.masterId,
            existingMaster.version,
            changeType,
            txClient,
          );
        }
      }

      // 6. 태그 값 업데이트
      if (data.tagValueIds !== undefined) {
        await txClient
          .delete(productTagValues)
          .where(
            and(
              eq(productTagValues.masterId, updated.masterId),
              eq(productTagValues.version, updated.version)
            )
          );

        if (data.tagValueIds.length > 0) {
          const uniqueTagValueIds = [...new Set(data.tagValueIds)];

          if (uniqueTagValueIds.length !== data.tagValueIds.length) {
            throw new Error('Duplicate tag value IDs are not allowed');
          }

          const validTagValues = await txClient
            .select({ id: tagValues.id })
            .from(tagValues)
            .where(
              and(
                inArray(tagValues.id, data.tagValueIds),
                eq(tagValues.isActive, true)
              )
            );

          if (validTagValues.length !== data.tagValueIds.length) {
            const validIds = validTagValues.map(v => v.id);
            const invalidIds = data.tagValueIds.filter(id => !validIds.includes(id));
            throw new Error(`Tag values not found or inactive: ${invalidIds.join(', ')}`);
          }

          await txClient.insert(productTagValues).values(
            data.tagValueIds.map((tagValueId) => ({
              masterId: updated.masterId,
              version: updated.version,
              tagValueId,
              createdAt: new Date(),
            }))
          );
        }
      }

      return updated;
    };

    return tx ? executeUpdate(tx) : this.db.db.transaction(executeUpdate);
  }

  async deleteMaster(masterId: string, tx?: DbTransaction): Promise<boolean> {
    if (!masterId) {
      throw new Error('Master ID is required');
    }

    const client = this.getClient(tx);

    const master = await this.getVersionById(masterId, tx);
    if (!master) {
      return false;
    }
    const result = await client
      .delete(productMasters)
      .where(eq(productMasters.id, masterId));

    return true;
  }

  async generateVariants(masterId: string, tx?: DbTransaction): Promise<void> {
    if (!masterId) {
      throw new Error('Master ID is required');
    }

    const client = this.getClient(tx);

    const exists = await this.existsMaster(masterId, tx);
    if (!exists) {
      throw new Error(`Master not found: ${masterId}`);
    }

    const master = await this.getVersionById(masterId, tx);
    if (!master) {
      throw new Error(`Version not found: ${masterId}`);
    }

    // 매핑 테이블을 통해 기존 variants 확인
    const existingMappings = await client
      .select({ count: count() })
      .from(productMasterVariants)
      .where(
        and(
          eq(productMasterVariants.masterId, master.masterId),
          eq(productMasterVariants.version, master.version),
        ),
      );

    if (existingMappings[0].count > 0) {
      throw new Error(
        'Master already has variants. Use regenerateVariants to recreate them.',
      );
    }

    // Display 테이블을 통해 optionGroups 조회
    const optionGroups = await this._getVersionOptionGroupsWithDisplays(
      master.masterId,
      master.version,
      'ko-KR',
      client,
    );

    if (tx) {
      await this._generateVariants(master, optionGroups, tx);
    } else {
      await this.db.db.transaction(async (txn) => {
        await this._generateVariants(master, optionGroups, txn);
      });
    }
  }

  async generateDefaultVariant(
    masterId: string,
    tx?: DbTransaction,
  ): Promise<void> {
    if (!masterId) {
      throw new Error('Master ID is required');
    }

    const client = this.getClient(tx);

    const exists = await this.existsMaster(masterId, tx);
    if (!exists) {
      throw new Error(`Master not found: ${masterId}`);
    }

    const master = await this.getVersionById(masterId, tx);
    if (!master) {
      throw new Error(`Version not found: ${masterId}`);
    }

    // 매핑 테이블을 통해 optionGroups 확인
    const existingOptionGroups = await client
      .select({ count: count() })
      .from(productMasterOptionGroups)
      .where(
        and(
          eq(productMasterOptionGroups.masterId, master.masterId),
          eq(productMasterOptionGroups.version, master.version),
        ),
      );

    if (existingOptionGroups[0].count > 0) {
      throw new Error(
        'Cannot generate default variant for master with option groups. Use generateVariants instead.',
      );
    }

    // 매핑 테이블을 통해 기존 variants 확인
    const existingVariants = await client
      .select({ count: count() })
      .from(productMasterVariants)
      .where(
        and(
          eq(productMasterVariants.masterId, master.masterId),
          eq(productMasterVariants.version, master.version),
        ),
      );

    if (existingVariants[0].count > 0) {
      throw new Error(
        'Master already has variants. Cannot generate default variant.',
      );
    }

    // variant 생성 후 매핑
    const [variant] = await client
      .insert(productVariants)
      .values({
        variantName: null,
        isDefault: true,
        status: 'active',
        displayOrder: 0,
      })
      .returning();

    await client.insert(productMasterVariants).values({
      id: uuidv7(),
      masterId: master.masterId,
      variantId: variant.id,
      version: master.version,
      createdAt: new Date(),
    });
  }

  async regenerateVariants(
    masterId: string,
    tx?: DbTransaction,
  ): Promise<void> {
    if (!masterId) {
      throw new Error('Master ID is required');
    }

    const client = this.getClient(tx);

    const exists = await this.existsMaster(masterId, tx);
    if (!exists) {
      throw new Error(`Master not found: ${masterId}`);
    }

    const master = await this.getVersionById(masterId, tx);
    if (!master) {
      throw new Error(`Version not found: ${masterId}`);
    }

    const executeRegeneration = async (txn: DbTransaction) => {
      // 매핑 테이블을 통해 기존 variants 삭제
      const existingMappings = await txn
        .select({ variantId: productMasterVariants.variantId })
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, master.masterId),
            eq(productMasterVariants.version, master.version),
          ),
        );

      // 매핑 삭제
      await txn
        .delete(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, master.masterId),
            eq(productMasterVariants.version, master.version),
          ),
        );

      // 실제 variant 레코드 삭제 (다른 버전에서 사용되지 않는 경우)
      if (existingMappings.length > 0) {
        for (const { variantId } of existingMappings) {
          const otherMappings = await txn
            .select({ count: count() })
            .from(productMasterVariants)
            .where(eq(productMasterVariants.variantId, variantId));

          if (otherMappings[0].count === 0) {
            await txn.delete(productVariants).where(eq(productVariants.id, variantId));
          }
        }
      }

      // 매핑 테이블과 Display 테이블을 통해 optionGroups 조회
      const optionGroups = await this._getVersionOptionGroupsWithDisplays(
        master.masterId,
        master.version,
        'ko-KR',
        txn,
      );

      await this._generateVariants(master, optionGroups, txn);
    };

    if (tx) {
      await executeRegeneration(tx);
    } else {
      await this.db.db.transaction(async (txn) => {
        await executeRegeneration(txn);
      });
    }
  }

  // NOTE: Pricing methods removed. Use PricingModule instead:
  // - PricingService for rules management
  // - PricingCalculatorService for price calculation

  async existsMaster(masterId: string, tx?: DbTransaction): Promise<boolean> {
    if (!masterId) {
      return false;
    }

    const client = this.getClient(tx);

    const result = await client
      .select({ count: count() })
      .from(productMasters)
      .where(eq(productMasters.id, masterId));

    return result[0].count > 0;
  }

  async updateMasterStatus(
    masterId: string,
    status: string,
    tx?: DbTransaction,
  ): Promise<void> {
    if (!masterId) {
      throw new Error('Master ID is required');
    }

    if (!status) {
      throw new Error('Status is required');
    }

    const validStatuses = ['active', 'inactive', 'draft'];
    if (!validStatuses.includes(status)) {
      throw new Error(
        `Invalid status: ${status}. Valid statuses are: ${validStatuses.join(', ')}`,
      );
    }

    const client = this.getClient(tx);

    const exists = await this.existsMaster(masterId, tx);
    if (!exists) {
      throw new Error(`Master not found: ${masterId}`);
    }
    await client
      .update(productMasters)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(eq(productMasters.id, masterId));
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
    return combinations.map((combination) =>
      combination.map((option) => option.value || option),
    );
  }



  /**
   * Soft delete a product
   */
  async softDelete(id: string, userId: string, tx?: DbTransaction): Promise<ProductMaster> {
    const client = this.getClient(tx);

    // Check if product exists and is not already deleted
    const product = await this.getVersionById(id, tx, { includeDeleted: true });
    if (!product) {
      throw new Error(`Product with ID ${id} not found`);
    }

    if (product.deletedAt) {
      throw new Error('Product is already deleted');
    }

    const [deleted] = await client
      .update(productMasters)
      .set({
        deletedAt: new Date(),
        deletedBy: userId,
        updatedAt: new Date(),
      })
      .where(eq(productMasters.id, id))
      .returning();

    // Log audit event
    await this.logAudit({
      productId: id,
      action: 'deleted',
      changes: { deletedAt: deleted.deletedAt },
      userId,
    }, tx);

    return deleted;
  }

  /**
   * Restore a soft-deleted product
   */
  async restore(id: string, userId: string, tx?: DbTransaction): Promise<ProductMaster> {
    const client = this.getClient(tx);

    // Find product including deleted ones
    const [product] = await client
      .select()
      .from(productMasters)
      .where(eq(productMasters.id, id));

    if (!product) {
      throw new Error(`Product with ID ${id} not found`);
    }

    if (!product.deletedAt) {
      throw new Error('Product is not deleted');
    }

    const [restored] = await client
      .update(productMasters)
      .set({
        deletedAt: null,
        deletedBy: null,
        updatedAt: new Date(),
      })
      .where(eq(productMasters.id, id))
      .returning();

    // Log audit event
    await this.logAudit({
      productId: id,
      action: 'restored',
      changes: { deletedAt: null },
      userId,
    }, tx);

    return restored;
  }

  /**
   * Get all soft-deleted products
   */
  async findDeleted(tx?: DbTransaction): Promise<ProductMaster[]> {
    const client = this.getClient(tx);

    return client
      .select()
      .from(productMasters)
      .where(isNotNull(productMasters.deletedAt))
      .orderBy(desc(productMasters.deletedAt));
  }

  /**
   * Hard delete (permanent) - use with caution
   */
  async hardDelete(id: string, userId: string, tx?: DbTransaction): Promise<{ deleted: boolean }> {
    const client = this.getClient(tx);

    // Check if product exists
    const [product] = await client
      .select()
      .from(productMasters)
      .where(eq(productMasters.id, id));

    if (!product) {
      throw new Error(`Product with ID ${id} not found`);
    }

    // Log before deletion (orphaned record)
    await this.logAudit({
      productId: id,
      action: 'hard_deleted',
      changes: { permanent: true },
      userId,
    }, tx);

    await client
      .delete(productMasters)
      .where(eq(productMasters.id, id));

    return { deleted: true };
  }

  /**
   * Apply option diff to a draft version
   */
  private async _applyOptionDiff(
    masterId: string,
    master: ProductMaster,
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
        const [optionGroup] = await tx
          .insert(productOptionGroups)
          .values({})
          .returning();

        // Display 정보 저장
        await tx.insert(productOptionGroupDisplays).values({
          optionGroupId: optionGroup.id,
          masterId: master.masterId,
          version: master.version,
          locale,
          displayName: addOption.displayName,
          description: addOption.description,
          sortOrder: addOption.sortOrder ?? 0,
        });

        // 매핑 테이블 연결
        await tx.insert(productMasterOptionGroups).values({
          id: uuidv7(),
          masterId: master.masterId,
          optionGroupId: optionGroup.id,
          version: master.version,
        });

        // 옵션 값들 생성
        for (const addValue of addOption.values) {
          const [optionValue] = await tx
            .insert(productOptionValues)
            .values({ optionGroupId: optionGroup.id })
            .returning();

          await tx.insert(productOptionValueDisplays).values({
            optionValueId: optionValue.id,
            masterId: master.masterId,
            version: master.version,
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
            .where(and(
              eq(productOptionGroupDisplays.optionGroupId, modify.optionGroupId),
              eq(productOptionGroupDisplays.masterId, master.masterId),
              eq(productOptionGroupDisplays.version, master.version),
              eq(productOptionGroupDisplays.locale, locale),
            ));
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
                .where(and(
                  eq(productOptionValueDisplays.optionValueId, valueModify.optionValueId),
                  eq(productOptionValueDisplays.masterId, master.masterId),
                  eq(productOptionValueDisplays.version, master.version),
                  eq(productOptionValueDisplays.locale, locale),
                ));
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
            masterId: master.masterId,
            version: master.version,
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
                eq(productOptionValueDisplays.masterId, master.masterId),
                eq(productOptionValueDisplays.version, master.version),
              ),
            );

          this.logger.log(
            `Removed option value ${optionValueId} from master ${master.masterId} version ${master.version}`,
          );
        }
      }
    }

    // 5. remove: 옵션 그룹 제거 (매핑만 제거)
    if (optionDiff.remove && optionDiff.remove.length > 0) {
      structureChanged = true;
      for (const optionGroupId of optionDiff.remove) {
        await tx
          .delete(productMasterOptionGroups)
          .where(and(
            eq(productMasterOptionGroups.masterId, master.masterId),
            eq(productMasterOptionGroups.optionGroupId, optionGroupId),
            eq(productMasterOptionGroups.version, master.version),
          ));
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
    currentVersion: number,
    changeType: 'option_group_changed' | 'option_value_changed',
    tx: DbTransaction,
  ): Promise<void> {
    const [master] = await tx
      .select()
      .from(productMasters)
      .where(
        and(
          eq(productMasters.masterId, masterId),
          eq(productMasters.version, currentVersion)
        )
      )
      .limit(1);

    if (!master) {
      throw new Error(`Master not found: ${masterId} version ${currentVersion}`);
    }

    const locale = 'ko-KR';

    if (changeType === 'option_group_changed') {
      // 옵션 그룹 구조 변경 → 전체 재생성
      this.logger.log(
        `Option group structure changed for ${master.masterId} v${currentVersion}. Regenerating all variants.`,
      );

      // 1. 기존 매핑 조회 (삭제 전에 저장)
      const existingMappings = await tx
        .select({ variantId: productMasterVariants.variantId })
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, master.masterId),
            eq(productMasterVariants.version, currentVersion),
          ),
        );

      const existingVariantIds = existingMappings.map((m) => m.variantId);

      // 2. 기존 매핑 모두 삭제
      await tx
        .delete(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, master.masterId),
            eq(productMasterVariants.version, currentVersion),
          ),
        );

      // 3. 현재 버전의 옵션 구조로 variant 전체 생성 (이벤트 없이)
      const optionGroups = await this._getVersionOptionGroupsWithDisplays(
        master.masterId,
        currentVersion,
        locale,
        tx,
      );

      await this._generateVariantsWithoutEvents(master, optionGroups, tx);

      // 4. 제거된 variant 정리 (전체 재생성이므로 모든 기존 variant가 후보)
      const newMappings = await tx
        .select({ variantId: productMasterVariants.variantId })
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, master.masterId),
            eq(productMasterVariants.version, currentVersion),
          ),
        );

      const newVariantIds = newMappings.map((m) => m.variantId);
      const removedVariantIds = existingVariantIds.filter(
        (id) => !newVariantIds.includes(id),
      );

      if (removedVariantIds.length > 0) {
        await this._cleanupOrphanedVariants(
          master.masterId,
          currentVersion,
          removedVariantIds,
          tx,
        );
      }

      this.logger.log(
        `Variant regeneration complete: ${newVariantIds.length} total variants created (${removedVariantIds.length} removed)`,
      );
    } else {
      // 옵션값만 변경 → 증분 업데이트 (승계 + 추가/제외)
      this.logger.log(
        `Option values changed for ${master.masterId} v${currentVersion}. Applying incremental update.`,
      );

      // 1. 현재 버전의 옵션 구조 조회
      const currentOptionGroups = await this._getVersionOptionGroupsWithDisplays(
        master.masterId,
        currentVersion,
        locale,
        tx,
      );

      if (currentOptionGroups.length === 0) {
        this.logger.warn(`No option groups found for version ${currentVersion}. Skipping variant regeneration.`);
        return;
      }

      // 2. 새 조합 목록 생성
      const newCombinations = this.generateOptionCombinations(currentOptionGroups);

      // 3. 부모 버전에서 기존 variant 조회
      const parentVersionVariants = await this._getParentVersionVariants(
        master.masterId,
        currentVersion,
        tx,
      );

      // 4. 기존 매핑 조회 (삭제 전에 저장)
      const existingMappings = await tx
        .select({ variantId: productMasterVariants.variantId })
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, master.masterId),
            eq(productMasterVariants.version, currentVersion),
          ),
        );

      const existingVariantIds = existingMappings.map((m) => m.variantId);

      // 5. 기존 매핑 삭제
      await tx
        .delete(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, master.masterId),
            eq(productMasterVariants.version, currentVersion),
          ),
        );

      // 6. 승계 및 신규 생성
      let inheritedCount = 0;
      let createdCount = 0;
      const newVariantIds: string[] = [];

      for (const combination of newCombinations) {
        const matchingVariant = this._findMatchingVariant(
          parentVersionVariants,
          combination,
        );

        if (matchingVariant) {
          // 승계: 기존 variant 매핑 복사
          await tx.insert(productMasterVariants).values({
            id: uuidv7(),
            masterId: master.masterId,
            variantId: matchingVariant.variantId,
            version: currentVersion,
            createdAt: new Date(),
          });

          newVariantIds.push(matchingVariant.variantId);
          inheritedCount++;
          this.logger.debug(
            `Inherited variant ${matchingVariant.variantId} to v${currentVersion}`,
          );
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
            version: currentVersion,
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
          this.logger.debug(
            `Created new variant ${variant.id} for v${currentVersion}`,
          );
        }
      }

      // 7. 제거된 variant 정리
      const removedVariantIds = existingVariantIds.filter(
        (id) => !newVariantIds.includes(id),
      );

      if (removedVariantIds.length > 0) {
        await this._cleanupOrphanedVariants(
          master.masterId,
          currentVersion,
          removedVariantIds,
          tx,
        );
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
    master: ProductMaster,
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
        masterId: master.masterId,
        variantId: variant.id,
        version: master.version,
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
        masterId: master.masterId,
        variantId: variant.id,
        version: master.version,
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
    currentVersion: number,
    tx: DbTransaction,
  ): Promise<Array<{ variantId: string; optionValueIds: string[] }>> {
    // 현재 버전의 부모 조회
    const [currentVersionRow] = await tx
      .select({ parentVersionId: productMasters.parentVersionId })
      .from(productMasters)
      .where(
        and(
          eq(productMasters.masterId, masterId),
          eq(productMasters.version, currentVersion),
        ),
      )
      .limit(1);

    if (!currentVersionRow || !currentVersionRow.parentVersionId) {
      this.logger.debug(`No parent version for v${currentVersion}`);
      return [];
    }

    // 부모 버전 정보 조회
    const [parentVersion] = await tx
      .select()
      .from(productMasters)
      .where(eq(productMasters.id, currentVersionRow.parentVersionId))
      .limit(1);

    if (!parentVersion) {
      this.logger.warn(`Parent version not found: ${currentVersionRow.parentVersionId}`);
      return [];
    }

    // 부모 버전의 variant 매핑 조회
    const variantMappings = await tx
      .select()
      .from(productMasterVariants)
      .where(
        and(
          eq(productMasterVariants.masterId, masterId),
          eq(productMasterVariants.version, parentVersion.version),
        ),
      );

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

    this.logger.debug(
      `Found ${result.length} variants in parent version ${parentVersion.version}`,
    );

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

      if (
        targetIds.length === parentIds.length &&
        targetIds.every((id, idx) => id === parentIds[idx])
      ) {
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
    currentVersion: number,
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
          version: productMasterVariants.version,
          versionStatus: productMasters.versionStatus,
        })
        .from(productMasterVariants)
        .innerJoin(
          productMasters,
          and(
            eq(productMasterVariants.masterId, productMasters.masterId),
            eq(productMasterVariants.version, productMasters.version),
          ),
        )
        .where(
          and(
            eq(productMasterVariants.masterId, masterId),
            eq(productMasterVariants.variantId, variantId),
          ),
        );

      // 2. 삭제 조건 검증
      const canDelete =
        allMappings.length === 0 ||
        (allMappings.length === 1 &&
          allMappings[0].versionStatus === 'draft' &&
          allMappings[0].version === currentVersion);

      if (canDelete) {
        // 3. Variant 엔티티 삭제
        await tx
          .delete(productVariants)
          .where(eq(productVariants.id, variantId));

        deletedCount++;
        this.logger.log(
          `Deleted orphaned variant entity: ${variantId} (only referenced by current draft v${currentVersion})`,
        );
      } else {
        this.logger.debug(
          `Kept variant entity: ${variantId} (referenced by ${allMappings.length} version(s): ${allMappings.map((m) => `v${m.version}(${m.versionStatus})`).join(', ')})`,
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
    version: number,
    locale: string = 'ko-KR',
    tx: DbTransaction,
  ): Promise<any[]> {
    const result = await tx
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
          eq(productMasterOptionGroups.version, productOptionGroupDisplays.version),
          eq(productOptionGroupDisplays.locale, locale),
        ),
      )
      .where(
        and(
          eq(productMasterOptionGroups.masterId, masterId),
          eq(productMasterOptionGroups.version, version),
        ),
      )
      .orderBy(productOptionGroupDisplays.sortOrder);

    // 각 옵션 그룹의 값들 조회
    for (const group of result) {
      (group as any).values = await tx
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
            eq(productOptionValueDisplays.version, version),
            eq(productOptionValueDisplays.locale, locale),
          ),
        )
        .where(eq(productOptionValues.optionGroupId, group.optionGroupId))
        .orderBy(productOptionValueDisplays.sortOrder);
    }

    return result;
  }

  /**
   * Log audit event
   */
  private async logAudit(
    data: {
      productId: string;
      action: string;
      changes: Record<string, any>;
      userId: string;
    },
    tx?: DbTransaction,
  ) {
    const client = this.getClient(tx);

    await client.insert(productAuditLog).values({
      productId: data.productId,
      action: data.action,
      changes: data.changes,
      userId: data.userId,
      timestamp: new Date(),
    });
  }
}
