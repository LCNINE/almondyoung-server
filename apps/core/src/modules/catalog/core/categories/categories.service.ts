import { Injectable, ConflictException } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { NotFoundError, BadRequestError, ConflictError } from '@app/shared';
import {
  CreateCategoryDto,
  UpdateCategoryDto,
  CategoryPathInfoDto,
  CategoryTreeNodeDto,
  CategoryResponseDto,
  CategoryDetailResponseDto,
  CategoryTreeResponseDto,
  CategoryPathResponseDto,
  UpdateDisplaySettingsDto,
  UpdateSeoConfigDto,
  UpdateTemplateConfigDto,
  CategoryTagGroupLinkDto,
  CategoryTagGroupsResponseDto,
  CategoryTagGroupItemDto,
} from './dto';
import { CategoryMapper, CategoryTagGroupsEntity, CategoryTagGroupItem } from './mappers';
import {
  ProductMaster,
  DbTransaction,
  DbClient,
  NewProductCategory,
  ProductCategory,
  UpdateProductCategory,
} from '../../catalog.types';
import {
  type PimSchema,
  pimSchema,
  CategoryDisplaySettings,
  CategorySeoConfig,
  CategoryTemplateConfig,
} from '../../schema/catalog.schema';
import { ProductReadAssembler } from '../products/assemblers/product-read.assembler';
import { eq, isNull, like, inArray, and, or, sql, asc } from 'drizzle-orm';
import { RowList } from 'postgres';
import { OutboxPublisher } from '@app/events';
import { PRODUCT_STREAM } from '@packages/event-contracts/streams/product.stream';
import type { CategoryChangedPayload, CategorySnapshot } from '@packages/event-contracts/streams/product.stream';

@Injectable()
export class ProductCategoriesService {
  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly productReadAssembler: ProductReadAssembler,
    private readonly outboxPublisher: OutboxPublisher,
  ) {}

  private getClient(tx?: DbTransaction): DbClient {
    return tx ?? this.db.db;
  }

  // 기본 CRUD
  async createCategory(data: CreateCategoryDto, tx?: DbTransaction): Promise<CategoryResponseDto> {
    return this.db.run(async (client) => {
      const { tagGroupLinks, ...categoryData } = data;

      // parentId가 있으면 부모 카테고리 조회하여 level/path 계산
      let level = 0;
      let parentPath = '';

      if (categoryData.parentId) {
        const [parentCategory] = await client
          .select({
            level: pimSchema.productCategories.level,
            path: pimSchema.productCategories.path,
          })
          .from(pimSchema.productCategories)
          .where(eq(pimSchema.productCategories.id, categoryData.parentId));

        if (!parentCategory) {
          throw new NotFoundError(`Parent category not found: ${categoryData.parentId}`);
        }

        level = parentCategory.level + 1;
        parentPath = parentCategory.path;
      }

      const newCategoryData: NewProductCategory = {
        ...categoryData,
        slug: categoryData.slug ?? Math.random().toString(36).slice(2, 8),
        level,
      };

      try {
        const [newCategory] = await client.insert(pimSchema.productCategories).values(newCategoryData).returning();

        // path 계산 및 업데이트
        const calculatedPath = parentPath ? `${parentPath}/${newCategory.id}` : newCategory.id;

        await client
          .update(pimSchema.productCategories)
          .set({ path: calculatedPath })
          .where(eq(pimSchema.productCategories.id, newCategory.id));

        newCategory.path = calculatedPath;

        if (tagGroupLinks && tagGroupLinks.length > 0) {
          await this._linkTagGroups(newCategory.id, tagGroupLinks, client);
        }

        // Enqueue CategoryChanged event
        const snapshot = this.buildCategorySnapshot(newCategory);
        await this.publishCategoryEvent(newCategory.id, 'created', snapshot, client);

        const responseDto: CategoryResponseDto = CategoryMapper.toDto(newCategory);
        return responseDto;
      } catch (error: any) {
        // Drizzle ORM이 에러를 래핑하므로 error.cause 확인 필요
        const pgError = error.cause || error;

        // PostgreSQL unique constraint violation (error code 23505)
        if (pgError.code === '23505') {
          // constraint 이름으로 slug 중복 감지
          if (pgError.constraint_name === 'product_categories_slug_unique') {
            throw new ConflictException(`Category with slug "${categoryData.slug}" already exists`);
          }
          // 다른 unique constraint 위반인 경우
          throw new ConflictException('Duplicate entry detected');
        }
        throw error;
      }
    }, tx);
  }

  async updateCategory(categoryId: string, data: UpdateCategoryDto, tx?: DbTransaction): Promise<CategoryResponseDto> {
    return this.db.run(async (client) => {
      const { tagGroupLinks, ...categoryData } = data;
      const updatingCategoryData: UpdateProductCategory = categoryData;
      const [updatedCategory] = await client
        .update(pimSchema.productCategories)
        .set({
          ...updatingCategoryData,
          updatedAt: new Date(),
        })
        .where(eq(pimSchema.productCategories.id, categoryId))
        .returning();

      if (tagGroupLinks !== undefined) {
        await client.delete(pimSchema.categoryTagGroups).where(eq(pimSchema.categoryTagGroups.categoryId, categoryId));

        if (tagGroupLinks.length > 0) {
          await this._linkTagGroups(categoryId, tagGroupLinks, client);
        }
      }

      // Enqueue CategoryChanged event
      const snapshot = this.buildCategorySnapshot(updatedCategory);
      await this.publishCategoryEvent(categoryId, 'updated', snapshot, client);

      return CategoryMapper.toDto(updatedCategory);
    }, tx);
  }

  async deleteCategory(categoryId: string, moveProductsTo?: string, tx?: DbTransaction): Promise<void> {
    const client = this.getClient(tx);

    const executeDelete = async (txn: DbTransaction) => {
      const [category] = await txn
        .select()
        .from(pimSchema.productCategories)
        .where(eq(pimSchema.productCategories.id, categoryId));

      if (!category) {
        throw new NotFoundError(`Category not found: ${categoryId}`);
      }

      const childCategories = await txn
        .select()
        .from(pimSchema.productCategories)
        .where(eq(pimSchema.productCategories.parentId, categoryId));

      if (childCategories.length > 0) {
        throw new BadRequestError(`Cannot delete category with child categories. Move or delete children first.`);
      }

      const productRelations = await txn
        .select()
        .from(pimSchema.productMasterCategories)
        .where(eq(pimSchema.productMasterCategories.categoryId, categoryId));

      if (productRelations.length > 0) {
        if (moveProductsTo) {
          const [targetCategory] = await txn
            .select()
            .from(pimSchema.productCategories)
            .where(eq(pimSchema.productCategories.id, moveProductsTo));

          if (!targetCategory) {
            throw new NotFoundError(`Target category not found: ${moveProductsTo}`);
          }

          await txn
            .update(pimSchema.productMasterCategories)
            .set({ categoryId: moveProductsTo })
            .where(eq(pimSchema.productMasterCategories.categoryId, categoryId));
        } else {
          // 상품은 유지되지만 카테고리 연결만 제거
          await txn
            .delete(pimSchema.productMasterCategories)
            .where(eq(pimSchema.productMasterCategories.categoryId, categoryId));
        }
      }

      await txn.delete(pimSchema.productCategories).where(eq(pimSchema.productCategories.id, categoryId));

      // Enqueue CategoryChanged event
      await this.publishCategoryEvent(categoryId, 'deleted', null, txn);
    };

    await this.db.run(executeDelete, tx);
  }

  async getCategoryById(categoryId: string, tx?: DbTransaction): Promise<CategoryDetailResponseDto> {
    const client = this.getClient(tx);

    const [category] = await client
      .select()
      .from(pimSchema.productCategories)
      .where(eq(pimSchema.productCategories.id, categoryId));

    if (!category) {
      throw new NotFoundError(`Category not found: ${categoryId}`);
    }

    const children = await client
      .select()
      .from(pimSchema.productCategories)
      .where(eq(pimSchema.productCategories.parentId, categoryId))
      .orderBy(pimSchema.productCategories.sortOrder);

    const directProductCount = await this.getCategoryProductCount(categoryId, false, tx);
    const totalProductCount = await this.getCategoryProductCount(categoryId, true, tx);

    const responseDto: CategoryDetailResponseDto = {
      ...CategoryMapper.toDto(category),
      children: CategoryMapper.toDtoArray(children),
      productCount: directProductCount,
      totalProductCount: totalProductCount,
    };
    return responseDto;
  }

  // 트리 구조 관리
  async getRootCategories(tx?: DbTransaction): Promise<CategoryResponseDto[]> {
    const client = this.getClient(tx);

    const categories = await client
      .select()
      .from(pimSchema.productCategories)
      .where(isNull(pimSchema.productCategories.parentId));

    const responseDto: CategoryResponseDto[] = CategoryMapper.toDtoArray(categories);
    return responseDto;
  }

  async getCategoryTree(
    maxDepth?: number,
    includeInactive?: boolean,
    tx?: DbTransaction,
  ): Promise<CategoryTreeResponseDto> {
    const client = this.getClient(tx);

    const baseQuery = client.select().from(pimSchema.productCategories);
    const allCategories = await (
      includeInactive ? baseQuery : baseQuery.where(eq(pimSchema.productCategories.isActive, true))
    ).orderBy(pimSchema.productCategories.level, pimSchema.productCategories.sortOrder);

    // Build tree structure
    const categoryMap = new Map<string, CategoryTreeNodeDto>();
    const rootCategories: CategoryTreeNodeDto[] = [];

    // First pass: create map
    for (const category of allCategories) {
      if (maxDepth === undefined || category.level <= maxDepth) {
        categoryMap.set(category.id, {
          ...category,
          children: [],
        });
      }
    }

    // Second pass: build tree
    for (const category of allCategories) {
      if (maxDepth !== undefined && category.level > maxDepth) continue;

      const categoryNode = categoryMap.get(category.id);
      if (!categoryNode) continue;

      if (!category.parentId) {
        rootCategories.push(categoryNode);
      } else {
        const parent = categoryMap.get(category.parentId);
        if (parent && parent.children) {
          parent.children.push(categoryNode);
        }
      }
    }

    return {
      categories: rootCategories,
      totalCount: allCategories.length,
      maxDepth: maxDepth || Math.max(...allCategories.map((c) => c.level)),
    };
  }

  async getChildCategories(categoryId: string, tx?: DbTransaction): Promise<CategoryResponseDto[]> {
    const client = this.getClient(tx);

    const children = await client
      .select()
      .from(pimSchema.productCategories)
      .where(eq(pimSchema.productCategories.parentId, categoryId))
      .orderBy(pimSchema.productCategories.sortOrder);

    const responseDto: CategoryResponseDto[] = CategoryMapper.toDtoArray(children);
    return responseDto;
  }

  async moveCategory(categoryId: string, newParentId?: string, tx?: DbTransaction): Promise<CategoryResponseDto> {
    const client = this.getClient(tx);

    const executeMove = async (txn: DbTransaction) => {
      const [category] = await txn
        .select()
        .from(pimSchema.productCategories)
        .where(eq(pimSchema.productCategories.id, categoryId));

      if (!category) {
        throw new NotFoundError(`Category not found: ${categoryId}`);
      }

      let newParentCategory: ProductCategory | null = null;
      if (newParentId) {
        const parentResult = await txn
          .select()
          .from(pimSchema.productCategories)
          .where(eq(pimSchema.productCategories.id, newParentId));

        if (parentResult.length === 0) {
          throw new NotFoundError(`Parent category not found: ${newParentId}`);
        }

        newParentCategory = parentResult[0];

        // 순환 참조 확인 - 새 부모가 현재 카테고리의 자식인지 검사
        if (await this.checkCircularReference(categoryId, newParentId, txn)) {
          throw new BadRequestError('Circular reference detected: Cannot move category to its own descendant');
        }
      }

      const newLevel = newParentCategory ? newParentCategory.level + 1 : 0;
      const newPath = newParentCategory ? `${newParentCategory.path}/${categoryId}` : categoryId;

      const [updatedCategory] = await txn
        .update(pimSchema.productCategories)
        .set({
          parentId: newParentId || null,
          level: newLevel,
          path: newPath,
          updatedAt: new Date(),
        })
        .where(eq(pimSchema.productCategories.id, categoryId))
        .returning();

      // 모든 자손들의 레벨과 경로 재계산
      await this._updateDescendantPaths(categoryId, txn);

      // Enqueue CategoryChanged event
      const snapshot = this.buildCategorySnapshot(updatedCategory);
      await this.publishCategoryEvent(categoryId, 'moved', snapshot, txn);

      return updatedCategory;
    };

    // 트랜잭션 처리
    const result = await this.db.run(executeMove, tx);

    const responseDto: CategoryResponseDto = CategoryMapper.toDto(result);
    return responseDto;
  }

  // 자손들의 경로와 레벨을 재계산하는 헬퍼 메서드
  private async _updateDescendantPaths(categoryId: string, txn: DbTransaction): Promise<void> {
    const [currentCategory] = await txn
      .select()
      .from(pimSchema.productCategories)
      .where(eq(pimSchema.productCategories.id, categoryId));

    if (!currentCategory) return;

    const children = await txn
      .select()
      .from(pimSchema.productCategories)
      .where(eq(pimSchema.productCategories.parentId, categoryId));

    for (const child of children) {
      const newLevel = currentCategory.level + 1;
      const newPath = `${currentCategory.path}/${child.id}`;

      await txn
        .update(pimSchema.productCategories)
        .set({
          level: newLevel,
          path: newPath,
          updatedAt: new Date(),
        })
        .where(eq(pimSchema.productCategories.id, child.id));

      // 재귀적으로 자손들 업데이트
      await this._updateDescendantPaths(child.id, txn);
    }
  }

  // 경로 및 계층 관리
  async getCategoryPath(categoryId: string, tx?: DbTransaction): Promise<CategoryPathResponseDto> {
    const client = this.getClient(tx);

    const [category] = await client
      .select()
      .from(pimSchema.productCategories)
      .where(eq(pimSchema.productCategories.id, categoryId));

    if (!category) {
      throw new NotFoundError(`Category not found: ${categoryId}`);
    }

    const path: ProductCategory[] = [];
    let currentCategory: ProductCategory | null = category;

    while (currentCategory) {
      path.unshift(currentCategory);

      if (currentCategory.parentId) {
        const [parent] = await client
          .select()
          .from(pimSchema.productCategories)
          .where(eq(pimSchema.productCategories.id, currentCategory.parentId));
        currentCategory = parent || null;
      } else {
        currentCategory = null;
      }
    }

    return {
      categoryId,
      path: path.map((cat) => ({
        id: cat.id,
        name: cat.name,
        slug: cat.slug,
        level: cat.level,
      })),
      fullPath: path.map((cat) => cat.name).join(' / '),
    };
  }

  async getCategoryDepth(categoryId: string, tx?: DbTransaction): Promise<number> {
    const client = this.getClient(tx);

    const result = await client
      .select({
        maxLevel: sql<number>`MAX(${pimSchema.productCategories.level})`,
      })
      .from(pimSchema.productCategories)
      .where(like(pimSchema.productCategories.path, `%/${categoryId}/%`));

    const [category] = await client
      .select({ level: pimSchema.productCategories.level })
      .from(pimSchema.productCategories)
      .where(eq(pimSchema.productCategories.id, categoryId));

    if (!category) {
      throw new NotFoundError(`Category not found: ${categoryId}`);
    }

    const maxChildLevel = result[0]?.maxLevel || category.level;
    return maxChildLevel - category.level;
  }

  async getAncestors(categoryId: string, tx?: DbTransaction): Promise<CategoryResponseDto[]> {
    const client = this.getClient(tx);

    const [category] = await client
      .select()
      .from(pimSchema.productCategories)
      .where(eq(pimSchema.productCategories.id, categoryId));

    if (!category) {
      throw new NotFoundError(`Category not found: ${categoryId}`);
    }

    const pathIds = category.path.split('/').filter((id) => id && id !== categoryId);

    if (pathIds.length === 0) {
      return [];
    }

    const ancestors = await client
      .select()
      .from(pimSchema.productCategories)
      .where(inArray(pimSchema.productCategories.id, pathIds))
      .orderBy(pimSchema.productCategories.level);

    const responseDto: CategoryResponseDto[] = CategoryMapper.toDtoArray(ancestors);
    return responseDto;
  }

  async getDescendants(categoryId: string, tx?: DbTransaction): Promise<CategoryResponseDto[]> {
    const client = this.getClient(tx);

    const [category] = await client
      .select()
      .from(pimSchema.productCategories)
      .where(eq(pimSchema.productCategories.id, categoryId));

    if (!category) {
      throw new NotFoundError(`Category not found: ${categoryId}`);
    }

    // path 기반으로 모든 자손 조회 (현재 카테고리 제외)
    const descendants = await client
      .select()
      .from(pimSchema.productCategories)
      .where(
        and(
          like(pimSchema.productCategories.path, `${category.path}/%`),
          sql`${pimSchema.productCategories.id} != ${categoryId}`,
        ),
      )
      .orderBy(pimSchema.productCategories.level, pimSchema.productCategories.sortOrder);

    const responseDto: CategoryResponseDto[] = CategoryMapper.toDtoArray(descendants);
    return responseDto;
  }

  // 상품 관리
  async getProductsByCategory(categoryId: string, includeSubcategories: boolean, tx?: DbTransaction) {
    const client = this.getClient(tx);

    // 카테고리 존재 확인
    const [category] = await client
      .select()
      .from(pimSchema.productCategories)
      .where(eq(pimSchema.productCategories.id, categoryId));

    if (!category) {
      throw new NotFoundError(`Category not found: ${categoryId}`);
    }

    let categoryIds = [categoryId];

    if (includeSubcategories) {
      // 하위 카테고리들도 포함
      const descendants = await client
        .select({ id: pimSchema.productCategories.id })
        .from(pimSchema.productCategories)
        .where(like(pimSchema.productCategories.path, `${category.path}/%`));

      categoryIds = [...categoryIds, ...descendants.map((d) => d.id)];
    }

    // 해당 카테고리(들)의 상품들 조회
    const products = await client
      .select({
        id: pimSchema.productMasterVersions.id,
        name: pimSchema.productMasterVersions.name,
        description: pimSchema.productMasterVersions.description,
        brand: pimSchema.productMasterVersions.brand,
        seoTitle: pimSchema.productMasterVersions.seoTitle,
        seoDescription: pimSchema.productMasterVersions.seoDescription,
        seoKeywords: pimSchema.productMasterVersions.seoKeywords,
        descriptionHtml: pimSchema.productMasterVersions.descriptionHtml,
        status: pimSchema.productMasterVersions.status,
        isWholesaleOnly: pimSchema.productMasterVersions.isWholesaleOnly,
        hideMembershipPriceForNonMembers: pimSchema.productMasterVersions.hideMembershipPriceForNonMembers,
        isVisibleToMembersOnly: pimSchema.productMasterVersions.isVisibleToMembersOnly,
        isOverseas: pimSchema.productMasterVersions.isOverseas,
        isMembershipOnly: pimSchema.productMasterVersions.isMembershipOnly,
        createdAt: pimSchema.productMasterVersions.createdAt,
        updatedAt: pimSchema.productMasterVersions.updatedAt,
        createdBy: pimSchema.productMasterVersions.createdBy,
        updatedBy: pimSchema.productMasterVersions.updatedBy,
        versionId: pimSchema.productMasterVersions.id, // product_images 조회용
      })
      .from(pimSchema.productMasterVersions)
      .innerJoin(
        pimSchema.productMasterCategories,
        and(
          eq(pimSchema.productMasterCategories.masterId, pimSchema.productMasterVersions.masterId),
          eq(pimSchema.productMasterCategories.versionId, pimSchema.productMasterVersions.id),
        ),
      )
      .where(
        and(
          inArray(pimSchema.productMasterCategories.categoryId, categoryIds),
          eq(pimSchema.productMasterVersions.status, 'active'),
        ),
      )
      .orderBy(pimSchema.productMasterVersions.name);

    // product_images에서 primary 이미지 조회 (thumbnail용)
    const versionIds = products.map((p) => p.versionId);
    const thumbnailMap = await this.productReadAssembler.getPrimaryImagesByVersionIds(versionIds, tx);

    const productsWithThumbnail = products.map((product) => ({
      ...product,
      thumbnail: thumbnailMap.get(product.versionId) ?? null,
      images: null,
    }));

    return productsWithThumbnail;
  }

  async getCategoryProductCount(
    categoryId: string,
    includeSubcategories: boolean,
    tx?: DbTransaction,
  ): Promise<number> {
    const client = this.getClient(tx);

    // 카테고리 존재 확인
    const [category] = await client
      .select()
      .from(pimSchema.productCategories)
      .where(eq(pimSchema.productCategories.id, categoryId));

    if (!category) {
      throw new NotFoundError(`Category not found: ${categoryId}`);
    }

    let categoryIds = [categoryId];

    if (includeSubcategories) {
      // 하위 카테고리들도 포함
      const descendants = await client
        .select({ id: pimSchema.productCategories.id })
        .from(pimSchema.productCategories)
        .where(like(pimSchema.productCategories.path, `${category.path}/%`));

      categoryIds = [...categoryIds, ...descendants.map((d) => d.id)];
    }

    // 상품 수 카운트 (중복 제거를 위해 DISTINCT 사용)
    const [result] = await client
      .select({
        count: sql<number>`COUNT(DISTINCT ${pimSchema.productMasterVersions.id})`,
      })
      .from(pimSchema.productMasterVersions)
      .innerJoin(
        pimSchema.productMasterCategories,
        and(
          eq(pimSchema.productMasterCategories.masterId, pimSchema.productMasterVersions.masterId),
          eq(pimSchema.productMasterCategories.versionId, pimSchema.productMasterVersions.id),
        ),
      )
      .where(
        and(
          inArray(pimSchema.productMasterCategories.categoryId, categoryIds),
          eq(pimSchema.productMasterVersions.status, 'active'),
        ),
      );

    return result.count;
  }

  async moveProductsToCategory(versionIds: string[], categoryId: string, tx?: DbTransaction): Promise<void> {
    if (!versionIds || versionIds.length === 0) {
      throw new BadRequestError('Version IDs are required');
    }

    const client = this.getClient(tx);

    const executeMove = async (txn: DbTransaction) => {
      // 1. 대상 카테고리 존재 확인
      const [category] = await txn
        .select()
        .from(pimSchema.productCategories)
        .where(eq(pimSchema.productCategories.id, categoryId));

      if (!category) {
        throw new NotFoundError(`Category not found: ${categoryId}`);
      }

      // 2. Version ID를 Master ID + Version 번호로 변환
      const productVersions = await txn
        .select({
          versionId: pimSchema.productMasterVersions.id,
          masterId: pimSchema.productMasterVersions.masterId,
          version: pimSchema.productMasterVersions.version,
        })
        .from(pimSchema.productMasterVersions)
        .where(
          and(
            inArray(pimSchema.productMasterVersions.id, versionIds),
            eq(pimSchema.productMasterVersions.status, 'active'),
          ),
        );

      if (productVersions.length === 0) {
        throw new NotFoundError('No active versions found');
      }

      const foundVersionIds = productVersions.map((p) => p.versionId);
      const missingVersionIds = versionIds.filter((id) => !foundVersionIds.includes(id));

      if (missingVersionIds.length > 0) {
        throw new NotFoundError(`Active versions not found: ${missingVersionIds.join(', ')}`);
      }

      // 3. 기존 카테고리 관계 삭제 (Master ID + Version 사용)
      for (const pv of productVersions) {
        await txn
          .delete(pimSchema.productMasterCategories)
          .where(
            and(
              eq(pimSchema.productMasterCategories.masterId, pv.masterId),
              eq(pimSchema.productMasterCategories.versionId, pv.versionId),
            ),
          );
      }

      // 4. 새 카테고리 관계 생성 (올바른 Master ID + Version 사용)
      const newRelations = productVersions.map((pv) => ({
        masterId: pv.masterId,
        versionId: pv.versionId,
        categoryId: categoryId,
        isPrimary: true,
        createdAt: new Date(),
      }));

      await txn.insert(pimSchema.productMasterCategories).values(newRelations);
    };

    // 트랜잭션 처리
    await this.db.run(executeMove, tx);
  }

  // 고지훈 추가 - 기존 카테고리를 유지하면서 추가로 카테고리에 상품 연결 (다대다 지원)
  async addProductsToCategory(versionIds: string[], categoryId: string, tx?: DbTransaction): Promise<void> {
    if (!versionIds || versionIds.length === 0) {
      throw new BadRequestError('Version IDs are required');
    }

    const client = this.getClient(tx);

    const executeAdd = async (txn: DbTransaction) => {
      // 1. 대상 카테고리 존재 확인
      const [category] = await txn
        .select()
        .from(pimSchema.productCategories)
        .where(eq(pimSchema.productCategories.id, categoryId));

      if (!category) {
        throw new NotFoundError(`Category not found: ${categoryId}`);
      }

      // 2. Version ID를 Master ID + Version 번호로 변환
      const productVersions = await txn
        .select({
          versionId: pimSchema.productMasterVersions.id,
          masterId: pimSchema.productMasterVersions.masterId,
          version: pimSchema.productMasterVersions.version,
        })
        .from(pimSchema.productMasterVersions)
        .where(
          and(
            inArray(pimSchema.productMasterVersions.id, versionIds),
            eq(pimSchema.productMasterVersions.status, 'active'),
          ),
        );

      if (productVersions.length === 0) {
        throw new NotFoundError('No active versions found');
      }

      const foundVersionIds = productVersions.map((p) => p.versionId);
      const missingVersionIds = versionIds.filter((id) => !foundVersionIds.includes(id));

      if (missingVersionIds.length > 0) {
        throw new NotFoundError(`Active versions not found: ${missingVersionIds.join(', ')}`);
      }

      // 3. 이미 연결된 상품-카테고리 관계 조회 (Master ID + Version + Category 사용)
      const existingRelations = await txn
        .select()
        .from(pimSchema.productMasterCategories)
        .where(
          and(
            inArray(
              pimSchema.productMasterCategories.masterId,
              productVersions.map((pv) => pv.masterId),
            ),
            inArray(
              pimSchema.productMasterCategories.versionId,
              productVersions.map((pv) => pv.versionId),
            ),
            eq(pimSchema.productMasterCategories.categoryId, categoryId),
          ),
        );

      // 4. 이미 연결된 상품 필터링
      const existingKeys = new Set(existingRelations.map((r) => `${r.masterId}:${r.versionId}`));

      const newProductVersions = productVersions.filter((pv) => !existingKeys.has(`${pv.masterId}:${pv.versionId}`));

      // 5. 아직 연결되지 않은 상품들만 새로 연결 (올바른 Master ID + Version 사용)
      if (newProductVersions.length > 0) {
        const newRelations = newProductVersions.map((pv) => ({
          masterId: pv.masterId,
          versionId: pv.versionId,
          categoryId: categoryId,
          isPrimary: false,
          createdAt: new Date(),
        }));

        await txn.insert(pimSchema.productMasterCategories).values(newRelations);
      }
    };

    // 트랜잭션 처리
    await this.db.run(executeAdd, tx);
  }

  // 검색 및 필터링
  async searchCategories(query: string, parentId?: string, tx?: DbTransaction): Promise<CategoryResponseDto[]> {
    const client = this.getClient(tx);

    if (!query || query.trim() === '') {
      throw new BadRequestError('Search query is required');
    }

    const searchTerm = `%${query.trim()}%`;
    const whereConditions = [
      or(like(pimSchema.productCategories.name, searchTerm), like(pimSchema.productCategories.description, searchTerm)),
    ];

    // 부모 ID가 지정된 경우 해당 부모 하위에서만 검색
    if (parentId) {
      // 부모 카테고리 존재 확인
      const [parentCategory] = await client
        .select()
        .from(pimSchema.productCategories)
        .where(eq(pimSchema.productCategories.id, parentId));

      if (!parentCategory) {
        throw new Error(`Parent category not found: ${parentId}`);
      }

      // 부모 ID 또는 부모의 자손인 카테골리만 포함
      whereConditions.push(
        or(
          eq(pimSchema.productCategories.parentId, parentId),
          like(pimSchema.productCategories.path, `${parentCategory.path}/%`),
        ),
      );
    }

    const categories = await client
      .select()
      .from(pimSchema.productCategories)
      .where(and(...whereConditions))
      .orderBy(pimSchema.productCategories.level, pimSchema.productCategories.name);

    const responseDto: CategoryResponseDto[] = CategoryMapper.toDtoArray(categories);
    return responseDto;
  }

  async getCategoriesByLevel(level: number, tx?: DbTransaction): Promise<CategoryResponseDto[]> {
    const client = this.getClient(tx);

    if (level < 0) {
      throw new BadRequestError('Level must be non-negative');
    }

    const categories = await client
      .select()
      .from(pimSchema.productCategories)
      .where(eq(pimSchema.productCategories.level, level))
      .orderBy(pimSchema.productCategories.sortOrder, pimSchema.productCategories.name);

    const responseDto: CategoryResponseDto[] = CategoryMapper.toDtoArray(categories);
    return responseDto;
  }

  // 정렬 및 순서
  async reorderCategories(parentId: string, categoryIds: string[], tx?: DbTransaction): Promise<void> {
    if (!categoryIds || categoryIds.length === 0) {
      throw new BadRequestError('Category IDs are required');
    }

    const executeReorder = async (txn: DbTransaction) => {
      // 1. 부모 카테고리 존재 확인 (parentId가 있는 경우)
      if (parentId) {
        const [parentCategory] = await txn
          .select()
          .from(pimSchema.productCategories)
          .where(eq(pimSchema.productCategories.id, parentId));

        if (!parentCategory) {
          throw new NotFoundError(`Parent category not found: ${parentId}`);
        }
      }

      // 2. 모든 카테고리가 해당 부모에 속하는지 확인
      const existingCategories = await txn
        .select()
        .from(pimSchema.productCategories)
        .where(
          and(
            inArray(pimSchema.productCategories.id, categoryIds),
            parentId
              ? eq(pimSchema.productCategories.parentId, parentId)
              : isNull(pimSchema.productCategories.parentId),
          ),
        );

      if (existingCategories.length !== categoryIds.length) {
        throw new BadRequestError('Some categories do not belong to the specified parent');
      }

      // 3. sortOrder 업데이트
      const updatedCategories: ProductCategory[] = [];
      for (let i = 0; i < categoryIds.length; i++) {
        const [updatedCategory] = await txn
          .update(pimSchema.productCategories)
          .set({
            sortOrder: i,
            updatedAt: new Date(),
          })
          .where(eq(pimSchema.productCategories.id, categoryIds[i]))
          .returning();

        if (updatedCategory) {
          updatedCategories.push(updatedCategory);
        }
      }

      // 4. 각 카테고리에 대해 CategoryChanged 이벤트 enqueue
      for (const category of updatedCategories) {
        const snapshot = this.buildCategorySnapshot(category);
        await this.publishCategoryEvent(category.id, 'updated', snapshot, txn);
      }
    };

    await this.db.run(executeReorder, tx);
  }

  async updateSortOrder(categoryId: string, sortOrder: number, tx?: DbTransaction): Promise<CategoryResponseDto> {
    if (sortOrder < 0) {
      throw new BadRequestError('Sort order must be non-negative');
    }

    return this.db.run(async (client) => {
      // 카테고리 존재 확인
      const [category] = await client
        .select()
        .from(pimSchema.productCategories)
        .where(eq(pimSchema.productCategories.id, categoryId));

      if (!category) {
        throw new NotFoundError(`Category not found: ${categoryId}`);
      }

      // sortOrder 업데이트
      const [updatedCategory] = await client
        .update(pimSchema.productCategories)
        .set({
          sortOrder: sortOrder,
          updatedAt: new Date(),
        })
        .where(eq(pimSchema.productCategories.id, categoryId))
        .returning();

      // Enqueue CategoryChanged event
      const snapshot = this.buildCategorySnapshot(updatedCategory);
      await this.publishCategoryEvent(categoryId, 'updated', snapshot, client);

      const responseDto: CategoryResponseDto = CategoryMapper.toDto(updatedCategory);
      return responseDto;
    }, tx);
  }

  // 검증 및 유틸리티
  async validateCategoryMove(categoryId: string, newParentId?: string, tx?: DbTransaction): Promise<boolean> {
    const client = this.getClient(tx);

    try {
      // 1. 이동할 카테고리 존재 확인
      const [category] = await client
        .select()
        .from(pimSchema.productCategories)
        .where(eq(pimSchema.productCategories.id, categoryId));

      if (!category) {
        return false; // 카테고리가 존재하지 않음
      }

      // 2. 새 부모 존재 확인 (newParentId가 있는 경우)
      if (newParentId) {
        const [newParent] = await client
          .select()
          .from(pimSchema.productCategories)
          .where(eq(pimSchema.productCategories.id, newParentId));

        if (!newParent) {
          return false; // 새 부모 카테고리가 존재하지 않음
        }

        // 3. 순환 참조 확인
        if (await this.checkCircularReference(categoryId, newParentId, tx)) {
          return false; // 순환 참조 감지
        }
      }

      return true; // 모든 검증 통과
    } catch (error) {
      return false; // 오류 발생 시 검증 실패
    }
  }

  async checkCircularReference(categoryId: string, newParentId: string, tx?: DbTransaction): Promise<boolean> {
    const client = this.getClient(tx);

    if (categoryId === newParentId) {
      return true; // 자기 자신을 부모로 설정하려는 경우
    }

    // 새 부모가 현재 카테고리의 자손인지 확인
    const [currentCategory] = await client
      .select({ path: pimSchema.productCategories.path })
      .from(pimSchema.productCategories)
      .where(eq(pimSchema.productCategories.id, categoryId));

    if (!currentCategory) {
      return false;
    }

    // newParentId가 currentCategory의 path에 포함되는지 확인
    const [newParent] = await client
      .select()
      .from(pimSchema.productCategories)
      .where(eq(pimSchema.productCategories.id, newParentId));

    if (!newParent) {
      return false;
    }

    // newParent의 path가 currentCategory의 path로 시작하는지 확인 (자손 관계)
    return newParent.path.startsWith(currentCategory.path + '/') || newParent.path === currentCategory.path;
  }

  async rebuildCategoryPaths(tx?: DbTransaction): Promise<void> {
    const client = this.getClient(tx);

    const executeRebuild = async (txn: DbTransaction) => {
      // 1. 모든 카테고리를 레벨 순으로 정렬하여 가져오기
      const allCategories = await txn
        .select()
        .from(pimSchema.productCategories)
        .orderBy(pimSchema.productCategories.level);

      // 2. 각 카테고리의 path와 level 재계산
      for (const category of allCategories) {
        let newPath = category.id;
        let newLevel = 0;

        if (category.parentId) {
          // 부모 카테고리 정보 조회
          const [parent] = await txn
            .select()
            .from(pimSchema.productCategories)
            .where(eq(pimSchema.productCategories.id, category.parentId));

          if (parent) {
            newPath = `${parent.path}/${category.id}`;
            newLevel = parent.level + 1;
          }
        }

        // 3. 카테고리 업데이트
        await txn
          .update(pimSchema.productCategories)
          .set({
            path: newPath,
            level: newLevel,
            updatedAt: new Date(),
          })
          .where(eq(pimSchema.productCategories.id, category.id));
      }
    };

    // 트랜잭션 처리
    await this.db.run(executeRebuild, tx);
  }

  // ===== Event Publishing Helpers =====

  /**
   * Build category snapshot for event publishing
   */
  private buildCategorySnapshot(category: ProductCategory): CategorySnapshot {
    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description ?? null,
      parentId: category.parentId ?? null,
      level: category.level,
      path: category.path,
      sortOrder: category.sortOrder,
      isActive: category.isActive,
      visibility: category.visibility,
      thumbnail: category.imageUrl ?? null,
      displaySettings: category.displaySettings as any,
      seoConfig: category.seoConfig as any,
      templateConfig: category.templateConfig as any,
      createdAt: category.createdAt.toISOString(),
      updatedAt: category.updatedAt.toISOString(),
    };
  }

  /**
   * Enqueue CategoryChanged event
   */
  private async publishCategoryEvent(
    categoryId: string,
    changeType: 'created' | 'updated' | 'deleted' | 'moved',
    snapshot: CategorySnapshot | null,
    tx: DbTransaction,
  ): Promise<void> {
    const payload: CategoryChangedPayload = {
      categoryId,
      changeType,
      timestamp: new Date().toISOString(),
      category: snapshot,
    };

    await this.outboxPublisher.saveEvent(
      {
        topic: PRODUCT_STREAM.topic.topic,
        eventType: 'CategoryChanged',
        aggregateType: PRODUCT_STREAM.aggregateType,
        aggregateId: categoryId,
        payload,
      },
      tx,
    );
  }

  // ===== Phase 2: Category Configuration Methods =====

  /**
   * 카테고리 표시 설정 업데이트
   */
  async updateDisplaySettings(
    categoryId: string,
    dto: UpdateDisplaySettingsDto,
    tx?: DbTransaction,
  ): Promise<CategoryResponseDto> {
    return this.db.run(async (client) => {
      const [category] = await client
        .select()
        .from(pimSchema.productCategories)
        .where(eq(pimSchema.productCategories.id, categoryId));

      if (!category) {
        throw new NotFoundError(`Category not found: ${categoryId}`);
      }

      const displaySettings: CategoryDisplaySettings = {
        ...(category.displaySettings as CategoryDisplaySettings),
        ...dto,
      };

      const [updated] = await client
        .update(pimSchema.productCategories)
        .set({
          displaySettings,
          updatedAt: new Date(),
        })
        .where(eq(pimSchema.productCategories.id, categoryId))
        .returning();

      // Enqueue CategoryChanged event
      const snapshot = this.buildCategorySnapshot(updated);
      await this.publishCategoryEvent(categoryId, 'updated', snapshot, client);

      const responseDto: CategoryResponseDto = CategoryMapper.toDto(updated);
      return responseDto;
    }, tx);
  }

  /**
   * 카테고리 SEO 설정 업데이트
   */
  async updateSeoConfig(categoryId: string, dto: UpdateSeoConfigDto, tx?: DbTransaction): Promise<CategoryResponseDto> {
    return this.db.run(async (client) => {
      const [category] = await client
        .select()
        .from(pimSchema.productCategories)
        .where(eq(pimSchema.productCategories.id, categoryId));

      if (!category) {
        throw new NotFoundError(`Category not found: ${categoryId}`);
      }

      const seoConfig: CategorySeoConfig = {
        ...(category.seoConfig as CategorySeoConfig),
        ...dto,
      };

      const [updated] = await client
        .update(pimSchema.productCategories)
        .set({
          seoConfig,
          updatedAt: new Date(),
        })
        .where(eq(pimSchema.productCategories.id, categoryId))
        .returning();

      // Enqueue CategoryChanged event
      const snapshot = this.buildCategorySnapshot(updated);
      await this.publishCategoryEvent(categoryId, 'updated', snapshot, client);

      const responseDto: CategoryResponseDto = CategoryMapper.toDto(updated);
      return responseDto;
    }, tx);
  }

  /**
   * 카테고리 템플릿 설정 업데이트
   */
  async updateTemplateConfig(
    categoryId: string,
    dto: UpdateTemplateConfigDto,
    tx?: DbTransaction,
  ): Promise<CategoryResponseDto> {
    return this.db.run(async (client) => {
      const [category] = await client
        .select()
        .from(pimSchema.productCategories)
        .where(eq(pimSchema.productCategories.id, categoryId));

      if (!category) {
        throw new NotFoundError(`Category not found: ${categoryId}`);
      }

      const templateConfig: CategoryTemplateConfig = {
        ...(category.templateConfig as CategoryTemplateConfig),
        ...dto,
      };

      const [updated] = await client
        .update(pimSchema.productCategories)
        .set({
          templateConfig,
          updatedAt: new Date(),
        })
        .where(eq(pimSchema.productCategories.id, categoryId))
        .returning();

      // Enqueue CategoryChanged event
      const snapshot = this.buildCategorySnapshot(updated);
      await this.publishCategoryEvent(categoryId, 'updated', snapshot, client);

      const responseDto: CategoryResponseDto = CategoryMapper.toDto(updated);
      return responseDto;
    }, tx);
  }

  /**
   * 카테고리 표시 여부 업데이트
   */
  async updateVisibility(categoryId: string, visible: boolean, tx?: DbTransaction): Promise<CategoryResponseDto> {
    return this.db.run(async (client) => {
      const [category] = await client
        .select()
        .from(pimSchema.productCategories)
        .where(eq(pimSchema.productCategories.id, categoryId));

      if (!category) {
        throw new NotFoundError(`Category not found: ${categoryId}`);
      }

      const [updated] = await client
        .update(pimSchema.productCategories)
        .set({
          visibility: visible,
          updatedAt: new Date(),
        })
        .where(eq(pimSchema.productCategories.id, categoryId))
        .returning();

      // Enqueue CategoryChanged event
      const snapshot = this.buildCategorySnapshot(updated);
      await this.publishCategoryEvent(categoryId, 'updated', snapshot, client);

      const responseDto: CategoryResponseDto = CategoryMapper.toDto(updated);
      return responseDto;
    }, tx);
  }

  // ===== TAG GROUP MANAGEMENT =====

  /**
   * 카테고리의 모든 조상 카테고리 조회 (재귀 CTE)
   * @param categoryId 조회할 카테고리 ID
   * @param tx 트랜잭션 컨텍스트
   * @returns 조상 카테고리 목록 (level 0 = 자기 자신, level 1 = 부모, level 2 = 조부모...)
   */
  private async _getAncestorCategoryIds(
    categoryId: string,
    tx: DbClient,
  ): Promise<Array<{ id: string; name: string; level: number }>> {
    const recursiveQuery = sql`
      WITH RECURSIVE ancestor_categories AS (
        -- Base case: 자기 자신
        SELECT 
          id, 
          name, 
          parent_id,
          0 as level
        FROM ${pimSchema.productCategories}
        WHERE id = ${categoryId}
        
        UNION ALL
        
        -- Recursive case: 부모들
        SELECT 
          pc.id,
          pc.name,
          pc.parent_id,
          ac.level + 1 as level
        FROM ${pimSchema.productCategories} pc
        INNER JOIN ancestor_categories ac ON pc.id = ac.parent_id
      )
      SELECT id, name, level
      FROM ancestor_categories
      ORDER BY level ASC
    `;

    const result = await tx.execute(recursiveQuery);
    const rows = result as RowList<{ id: string; name: string; level: number }[]>;
    return rows.map((row) => ({ id: row.id, name: row.name, level: row.level }));
  }

  /**
   * 카테고리에 태그 그룹 연결 (내부 헬퍼)
   */
  private async _linkTagGroups(categoryId: string, links: CategoryTagGroupLinkDto[], tx: DbTransaction): Promise<void> {
    if (!links || links.length === 0) {
      return;
    }

    const tagGroupIds = links.map((link) => link.tagGroupId);
    const existingGroups = await tx
      .select({ id: pimSchema.tagGroups.id })
      .from(pimSchema.tagGroups)
      .where(inArray(pimSchema.tagGroups.id, tagGroupIds));

    const existingGroupIds = existingGroups.map((g) => g.id);
    const missingGroupIds = tagGroupIds.filter((id) => !existingGroupIds.includes(id));

    if (missingGroupIds.length > 0) {
      throw new NotFoundError(`Tag groups not found: ${missingGroupIds.join(', ')}`);
    }

    // 조상 카테고리로부터 상속받은 태그 그룹 조회
    const ancestors = await this._getAncestorCategoryIds(categoryId, tx);
    const ancestorIds = ancestors.filter((a) => a.level > 0).map((a) => a.id);

    if (ancestorIds.length > 0) {
      const inheritedTagGroups = await tx
        .select({
          tagGroupId: pimSchema.categoryTagGroups.tagGroupId,
          categoryId: pimSchema.categoryTagGroups.categoryId,
          categoryName: pimSchema.productCategories.name,
        })
        .from(pimSchema.categoryTagGroups)
        .innerJoin(
          pimSchema.productCategories,
          eq(pimSchema.categoryTagGroups.categoryId, pimSchema.productCategories.id),
        )
        .where(
          and(
            inArray(pimSchema.categoryTagGroups.categoryId, ancestorIds),
            eq(pimSchema.categoryTagGroups.appliesToDescendants, true),
          ),
        );

      // 중복 검증
      for (const link of links) {
        const inherited = inheritedTagGroups.find((itg) => itg.tagGroupId === link.tagGroupId);
        if (inherited) {
          throw new ConflictError(
            `Tag group ${link.tagGroupId} is already inherited from ancestor category ${inherited.categoryName}`,
          );
        }
      }
    }

    const linkValues = links.map((link, index) => ({
      categoryId,
      tagGroupId: link.tagGroupId,
      displayOrder: link.displayOrder ?? index,
      isRequired: link.isRequired ?? false,
      appliesToDescendants: link.appliesToDescendants ?? false,
      createdAt: new Date(),
    }));

    await tx.insert(pimSchema.categoryTagGroups).values(linkValues);
  }

  /**
   * 카테고리의 태그 그룹 연결 교체
   */
  async replaceTagGroupLinks(categoryId: string, links: CategoryTagGroupLinkDto[], tx?: DbTransaction): Promise<void> {
    return this.db.run(async (trx) => {
      const [category] = await trx
        .select()
        .from(pimSchema.productCategories)
        .where(eq(pimSchema.productCategories.id, categoryId))
        .limit(1);

      if (!category) {
        throw new NotFoundError(`Category not found: ${categoryId}`);
      }

      await trx.delete(pimSchema.categoryTagGroups).where(eq(pimSchema.categoryTagGroups.categoryId, categoryId));

      if (links.length > 0) {
        await this._linkTagGroups(categoryId, links, trx);
      }
    }, tx);
  }

  /**
   * 카테고리의 태그 그룹 및 태그 값 조회 (상속 포함)
   *
   * 복잡한 JOIN을 피하고 여러 단순한 쿼리로 분리하여:
   * 1. 가독성 향상
   * 2. 카테시안 곱으로 인한 중복 데이터 방지
   * 3. 타입 안전성 개선
   */
  async getCategoryTagGroups(categoryId: string, tx?: DbTransaction): Promise<CategoryTagGroupsEntity> {
    const client = this.getClient(tx);

    const [category] = await client
      .select({ id: pimSchema.productCategories.id, name: pimSchema.productCategories.name })
      .from(pimSchema.productCategories)
      .where(eq(pimSchema.productCategories.id, categoryId))
      .limit(1);

    if (!category) {
      throw new NotFoundError(`Category not found: ${categoryId}`);
    }

    // 조상 카테고리 조회
    const ancestors = await this._getAncestorCategoryIds(categoryId, client);
    const allCategoryIds = ancestors.map((a) => a.id);

    // 태그 그룹 연결 정보만 조회 (tag_values 없이)
    // LEFT JOIN을 사용하지 않아 카테시안 곱 발생 없음
    const tagGroupLinks = await client
      .select({
        tagGroupId: pimSchema.categoryTagGroups.tagGroupId,
        categoryId: pimSchema.categoryTagGroups.categoryId,
        categoryName: pimSchema.productCategories.name,
        displayOrder: pimSchema.categoryTagGroups.displayOrder,
        isRequired: pimSchema.categoryTagGroups.isRequired,
        appliesToDescendants: pimSchema.categoryTagGroups.appliesToDescendants,
        tagGroupName: pimSchema.tagGroups.name,
        tagGroupDescription: pimSchema.tagGroups.description,
        tagGroupIsActive: pimSchema.tagGroups.isActive,
      })
      .from(pimSchema.categoryTagGroups)
      .innerJoin(
        pimSchema.productCategories,
        eq(pimSchema.categoryTagGroups.categoryId, pimSchema.productCategories.id),
      )
      .innerJoin(pimSchema.tagGroups, eq(pimSchema.categoryTagGroups.tagGroupId, pimSchema.tagGroups.id))
      .where(
        and(
          inArray(pimSchema.categoryTagGroups.categoryId, allCategoryIds),
          or(
            eq(pimSchema.categoryTagGroups.categoryId, categoryId),
            eq(pimSchema.categoryTagGroups.appliesToDescendants, true),
          ),
        ),
      );

    // 태그 그룹별로 정리 (groupID => mapping)
    const groupedData: Record<string, CategoryTagGroupItem> = {};

    for (const link of tagGroupLinks) {
      const isInherited = link.categoryId !== categoryId;

      groupedData[link.tagGroupId] = {
        id: link.tagGroupId,
        name: link.tagGroupName,
        description: link.tagGroupDescription,
        displayOrder: link.displayOrder,
        isRequired: link.isRequired,
        appliesToDescendants: link.appliesToDescendants,
        isInherited,
        inheritedFromCategoryId: isInherited ? link.categoryId : null,
        inheritedFromCategoryName: isInherited ? link.categoryName : null,
        isActive: link.tagGroupIsActive,
        values: [],
      };
    }

    // 각 태그 그룹의 값들을 별도 쿼리로 조회
    if (Object.keys(groupedData).length > 0) {
      const tagGroupIds = Object.keys(groupedData);

      const tagValues = await client
        .select()
        .from(pimSchema.tagValues)
        .where(and(inArray(pimSchema.tagValues.groupId, tagGroupIds), eq(pimSchema.tagValues.isActive, true)))
        .orderBy(asc(pimSchema.tagValues.displayOrder));

      // 값들을 각 그룹에 추가
      for (const value of tagValues) {
        if (groupedData[value.groupId]) {
          groupedData[value.groupId].values.push({
            id: value.id,
            groupId: value.groupId,
            name: value.name,
            displayOrder: value.displayOrder,
            isActive: value.isActive,
            createdAt: value.createdAt,
            updatedAt: value.updatedAt,
          });
        }
      }
    }

    // displayOrder로 정렬
    const sortedTagGroups = Object.values(groupedData).sort((a, b) => a.displayOrder - b.displayOrder);

    return {
      categoryId: category.id,
      categoryName: category.name,
      tagGroups: sortedTagGroups,
    };
  }
}
