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
} from '../../../types';
import {
  type PimSchema,
  productMasters,
  productMasterCategories,
  productCategories,
  productOptionGroups,
  productOptionValues,
  productVariants,
  variantOptionValues,
  productImages,
  uploads,
  productAuditLog,
  productMasterOptionGroups,
  productMasterVariants,
  productMasterPricingRules,
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
  ) {}

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
    const db =
      tx ||
      (await this.db.db.transaction(async (txn) => {
        return await this._createMasterWithinTransaction(data, txn);
      }));

    if (tx) {
      return await this._createMasterWithinTransaction(data, tx);
    } else {
      return db as ProductMaster;
    }
  }

  private async _createMasterWithinTransaction(
    data: CreateMasterDto,
    tx: DbTransaction,
  ): Promise<ProductMaster> {
    // HTML 처리 단순화
    let processedHtml = null;
    if ((data as any).descriptionHtml) {
      processedHtml = (data as any).descriptionHtml
        .replace(/<img ec-data-src="([^"]+)"/g, '<img src="$1"')
        .replace(/<br><p><br><\/p>/g, '')
        .replace(/<p><br><\/p>/g, '');
    } else if ((data as any).detailHtmlTags) {
      processedHtml = (data as any).detailHtmlTags
        .join('')
        .replace(/<img ec-data-src="([^"]+)"/g, '<img src="$1"')
        .replace(/<br><p><br><\/p>/g, '')
        .replace(/<p><br><\/p>/g, '');
    }

    // 버전 관리: masterId는 논리적 그룹 ID, id는 물리적 버전 ID
    const masterId = uuidv7();  // 논리적 판매상품 그룹 ID
    const versionId = uuidv7(); // 첫 번째 버전의 물리적 ID

    const masterData = {
      id: versionId,
      masterId: masterId,  // 별도의 논리적 ID로 명확히 분리
      version: 1,
      versionStatus: 'draft',
      parentVersionId: null,
      draftOwnerId: null,
      name: data.name,
      description: data.description,
      descriptionHtml: processedHtml,
      brand: data.brand,
      thumbnail: data.thumbnail,
      basePrice: data.basePrice,
      tags: data.tags,
      images: data.images,
      attributes: data.attributes,
      seoTitle: data.seoTitle,
      seoDescription: data.seoDescription,
      seoKeywords: data.seoKeywords,
      isWholesaleOnly: data.isWholesaleOnly || false,
      isMembershipOnly: data.isMembershipOnly || false,
    };

    const [master] = await tx
      .insert(productMasters)
      .values(masterData as any)
      .returning();

    // 이미지 연결 처리
    await this._linkImages(master.id, data, tx);

    // 카테고리 연결 처리
    if (data.categoryIds && data.categoryIds.length > 0) {
      await this._linkCategories(master.id, data.categoryIds, data.primaryCategoryId, tx);
    }

    // 옵션 처리는 비동기로 후속 처리
    setImmediate(async () => {
      try {
        await this._processOptionsAsync(master.id, data);
      } catch (error) {
        console.error('옵션 처리 실패:', error.message);
      }
    });

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

  async getMasterById(
    masterId: string,
    tx?: DbTransaction,
    includeDeleted = false,
  ): Promise<ProductMaster | null> {
    if (!masterId) {
      throw new Error('Master ID is required');
    }

    const client = this.getClient(tx);

    const conditions = [eq(productMasters.id, masterId)];
    if (!includeDeleted) {
      conditions.push(isNull(productMasters.deletedAt));
    }

    const result = await client
      .select()
      .from(productMasters)
      .where(and(...conditions));

    return result.length > 0 ? result[0] : null;
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

    // 1. 상품 기본 정보 조회
    const masterResult = await client
      .select()
      .from(productMasters)
      .where(eq(productMasters.id, masterId));

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
    tx?: DbTransaction,
  ): Promise<MasterDetailDto | null> {
    const client = this.getClient(tx);

    const master = await this.getMasterById(masterId, tx);
    if (!master) {
      return null;
    }
    const optionGroups = await client
      .select()
      .from(productOptionGroups)
      .where(eq(productOptionGroups.masterId, masterId))
      .orderBy(productOptionGroups.sortOrder);

    const optionGroupsWithValues: any[] = [];
    for (const group of optionGroups) {
      const values = await client
        .select()
        .from(productOptionValues)
        .where(eq(productOptionValues.optionGroupId, group.id))
        .orderBy(productOptionValues.sortOrder);

      optionGroupsWithValues.push({
        ...group,
        values,
      });
    }

    const variants = await client
      .select()
      .from(productVariants)
      .where(eq(productVariants.masterId, masterId))
      .orderBy(productVariants.displayOrder);

    const channelProducts = [];

    return {
      ...master,
      optionGroups: optionGroupsWithValues,
      variants: variants.map((v) => ({ ...v, optionValues: [] })),
      channelProducts,
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
      basePrice: number | null;
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
          basePrice: productMasters.basePrice,
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
        thumbnail: productMasters.thumbnail,
        basePrice: productMasters.basePrice,
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
      // 0. 기존 마스터 조회
      const existingMaster = await this.getMasterById(masterId, txClient);
      if (!existingMaster) {
        throw new Error(`Master not found: ${masterId}`);
      }

      // NOTE: Pricing strategy logic has been moved to PricingModule
      // Use the new rule-based pricing API: PUT /products/:masterId/pricing-rules

      // 3. 기본 필드 업데이트
      const { 
        categoryIds, 
        primaryCategoryId, 
        migrationData,
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

      return updated;
    };

    return tx ? executeUpdate(tx) : this.db.db.transaction(executeUpdate);
  }

  async deleteMaster(masterId: string, tx?: DbTransaction): Promise<boolean> {
    if (!masterId) {
      throw new Error('Master ID is required');
    }

    const client = this.getClient(tx);

    const master = await this.getMasterById(masterId, tx);
    if (!master) {
      return false;
    }
    const result = await client
      .delete(productMasters)
      .where(eq(productMasters.id, masterId));

    return true;
  }

  async createOptionGroups(
    masterId: string,
    optionGroups: any[],
    tx?: DbTransaction,
  ): Promise<void> {
    if (!masterId) {
      throw new Error('Master ID is required');
    }

    if (!optionGroups || optionGroups.length === 0) {
      throw new Error('Option groups are required');
    }

    const client = this.getClient(tx);

    const exists = await this.existsMaster(masterId, tx);
    if (!exists) {
      throw new Error(`Master not found: ${masterId}`);
    }
    for (const optionGroup of optionGroups) {
      if (
        !optionGroup.name ||
        !optionGroup.displayName ||
        !optionGroup.values
      ) {
        throw new Error('Option group must have name, displayName, and values');
      }
      const existingGroup = await client
        .select()
        .from(productOptionGroups)
        .where(
          and(
            eq(productOptionGroups.masterId, masterId),
            eq(productOptionGroups.name, optionGroup.name),
          ),
        );

      if (existingGroup.length > 0) {
        throw new Error(
          `Option group '${optionGroup.name}' already exists for this master`,
        );
      }
      const [group] = await client
        .insert(productOptionGroups)
        .values({
          masterId: masterId,
          name: optionGroup.name,
          displayName: optionGroup.displayName,
          sortOrder: optionGroup.sortOrder || 0,
        })
        .returning();
      for (const value of optionGroup.values) {
        if (!value.value || !value.displayName) {
          throw new Error('Option value must have value and displayName');
        }
        const existingValue = await client
          .select()
          .from(productOptionValues)
          .where(
            and(
              eq(productOptionValues.optionGroupId, group.id),
              eq(productOptionValues.value, value.value),
            ),
          );

        if (existingValue.length > 0) {
          throw new Error(
            `Option value '${value.value}' already exists in group '${optionGroup.name}'`,
          );
        }

        await client.insert(productOptionValues).values({
          optionGroupId: group.id,
          value: value.value,
          displayName: value.displayName,
          sortOrder: value.sortOrder || 0,
        });
      }
    }
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

    const master = await this.getMasterById(masterId, tx);
    if (!master) {
      throw new Error(`Master not found: ${masterId}`);
    }

    const existingVariants = await client
      .select()
      .from(productVariants)
      .where(eq(productVariants.masterId, masterId));

    if (existingVariants.length > 0) {
      throw new Error(
        'Master already has variants. Use regenerateVariants to recreate them.',
      );
    }
    const optionGroups = await client
      .select()
      .from(productOptionGroups)
      .where(eq(productOptionGroups.masterId, masterId))
      .orderBy(asc(productOptionGroups.sortOrder));
    const optionGroupsWithValues: any[] = [];
    for (const group of optionGroups) {
      const values = await client
        .select()
        .from(productOptionValues)
        .where(eq(productOptionValues.optionGroupId, group.id))
        .orderBy(asc(productOptionValues.sortOrder));

      optionGroupsWithValues.push({
        ...group,
        values,
      } as any);
    }
    if (tx) {
      await this._generateVariants(masterId, master, optionGroupsWithValues, tx);
    } else {
      await this.db.db.transaction(async (txn) => {
        await this._generateVariants(masterId, master, optionGroupsWithValues, txn);
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
    const existingOptionGroups = await client
      .select()
      .from(productOptionGroups)
      .where(eq(productOptionGroups.masterId, masterId));

    if (existingOptionGroups.length > 0) {
      throw new Error(
        'Cannot generate default variant for master with option groups. Use generateVariants instead.',
      );
    }
    const existingVariants = await client
      .select()
      .from(productVariants)
      .where(eq(productVariants.masterId, masterId));

    if (existingVariants.length > 0) {
      throw new Error(
        'Master already has variants. Cannot generate default variant.',
      );
    }
    await client.insert(productVariants).values({
      masterId,
      variantName: null,
      isDefault: true,
      status: 'active',
      displayOrder: 0,
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

    const master = await this.getMasterById(masterId, tx);
    if (!master) {
      throw new Error(`Master not found: ${masterId}`);
    }

    const executeRegeneration = async (txn: DbTransaction) => {
      await txn
        .delete(productVariants)
        .where(eq(productVariants.masterId, masterId));
      const optionGroups = await txn
        .select()
        .from(productOptionGroups)
        .where(eq(productOptionGroups.masterId, masterId))
        .orderBy(asc(productOptionGroups.sortOrder));
      const optionGroupsWithValues: any[] = [];
      for (const group of optionGroups) {
        const values = await txn
          .select()
          .from(productOptionValues)
          .where(eq(productOptionValues.optionGroupId, group.id))
          .orderBy(asc(productOptionValues.sortOrder));

        optionGroupsWithValues.push({
          ...group,
          values,
        } as any);
      }
      await this._generateVariants(masterId, master, optionGroupsWithValues, txn);
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

  private async _processOptionsAsync(
    masterId: string,
    data: CreateMasterDto,
  ): Promise<void> {
    try {
      // master 조회 추가
      const master = await this.getMasterById(masterId);
      if (!master) {
        this.logger.error(`Master not found: ${masterId}`);
        return;
      }

      if (
        !(data as any).optionGroups ||
        (data as any).optionGroups.length === 0
      ) {
        // 옵션이 없으면 기본 variant 생성
        await this.db.db.transaction(async (tx) => {
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
        });
        return;
      }

      await this.db.db.transaction(async (tx) => {
        await this._bulkInsertOptions(
          masterId,
          master,
          (data as any).optionGroups,
          tx,
        );
      });
    } catch (error) {
      this.logger.error('옵션 처리 실패:', error.message);
    }
  }

  private async _bulkInsertOptions(
    masterId: string,
    master: ProductMaster,
    optionGroups: any[],
    tx: DbTransaction,
  ): Promise<void> {
    // 1. 옵션 그룹들을 bulk insert (masterId 없이)
    const groupInsertData = optionGroups.map((group, index) => ({
      name: group.name,
      displayName: group.displayName,
      sortOrder: group.sortOrder || index,
    }));

    const insertedGroups = await tx
      .insert(productOptionGroups)
      .values(groupInsertData)
      .returning();

    // 2. 매핑 테이블에 연결
    const mappingData = insertedGroups.map(group => ({
      id: uuidv7(),
      masterId: master.masterId,
      optionGroupId: group.id,
      version: master.version,
      createdAt: new Date(),
    }));

    await tx.insert(productMasterOptionGroups).values(mappingData);

    // 3. 옵션 값들을 bulk insert
    const valueInsertData: any[] = [];
    for (let i = 0; i < optionGroups.length; i++) {
      const group = optionGroups[i];
      const insertedGroup = insertedGroups[i];

      for (let j = 0; j < group.values.length; j++) {
        const value = group.values[j];
        valueInsertData.push({
          optionGroupId: insertedGroup.id,
          value: value.value,
          displayName: value.displayName,
          sortOrder: value.sortOrder || j,
        });
      }
    }

    const insertedValues = await tx
      .insert(productOptionValues)
      .values(valueInsertData)
      .returning();

    // 4. 옵션 조합으로 variants 생성
    const optionGroupsWithValues = insertedGroups.map((group, index) => ({
      ...group,
      values: insertedValues.filter((v) => v.optionGroupId === group.id),
    }));

    await this._generateVariants(master, optionGroupsWithValues, tx);
  }

  /**
   * Soft delete a product
   */
  async softDelete(id: string, userId: string, tx?: DbTransaction): Promise<ProductMaster> {
    const client = this.getClient(tx);

    // Check if product exists and is not already deleted
    const product = await this.getMasterById(id, tx, true);
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
