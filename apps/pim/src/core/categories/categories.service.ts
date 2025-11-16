import { Injectable } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
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
} from './dto';
import {
  ProductMaster,
  DbTransaction,
  NewProductCategory,
  ProductCategory,
  UpdateProductCategory,
} from '../../types';
import {
  type PimSchema,
  pimSchema,
  CategoryDisplaySettings,
  CategorySeoConfig,
  CategoryTemplateConfig,
} from '../../schema';
import { eq, isNull, like, inArray, and, or, sql } from 'drizzle-orm';

@Injectable()
export class ProductCategoriesService {
  constructor(@InjectDb() private readonly db: DbService<PimSchema>) {}

  private getClient(tx?: DbTransaction) {
    return tx ?? this.db.db;
  }

  // 기본 CRUD
  async createCategory(
    data: CreateCategoryDto,
    tx?: DbTransaction,
  ): Promise<CategoryResponseDto> {
    const client = this.getClient(tx);

    const newCategoryData: NewProductCategory = {
      ...data,
      slug: data.slug ?? Math.random().toString(36).slice(2, 8),
    };
    const [newCategory] = await client
      .insert(pimSchema.productCategories)
      .values(newCategoryData)
      .returning();

    const responseDto: CategoryResponseDto = newCategory;
    return responseDto;
  }

  async updateCategory(
    categoryId: string,
    data: UpdateCategoryDto,
    tx?: DbTransaction,
  ): Promise<CategoryResponseDto> {
    const client = this.getClient(tx);

    const updatingCategoryData: UpdateProductCategory = data;
    const [updatedCategory] = await client
      .update(pimSchema.productCategories)
      .set({
        ...updatingCategoryData,
        updatedAt: new Date(),
      })
      .where(eq(pimSchema.productCategories.id, categoryId))
      .returning();

    const responseDto: CategoryResponseDto = updatedCategory;
    return responseDto;
  }

  async deleteCategory(
    categoryId: string,
    moveProductsTo?: string,
    tx?: DbTransaction,
  ): Promise<void> {
    const client = this.getClient(tx);

    const executeDelete = async (txn: any) => {
      const [category] = await txn
        .select()
        .from(pimSchema.productCategories)
        .where(eq(pimSchema.productCategories.id, categoryId));

      if (!category) {
        throw new Error(`Category not found: ${categoryId}`);
      }

      const childCategories = await txn
        .select()
        .from(pimSchema.productCategories)
        .where(eq(pimSchema.productCategories.parentId, categoryId));

      if (childCategories.length > 0) {
        throw new Error(
          `Cannot delete category with child categories. Move or delete children first.`,
        );
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
            throw new Error(`Target category not found: ${moveProductsTo}`);
          }

          await txn
            .update(pimSchema.productMasterCategories)
            .set({ categoryId: moveProductsTo })
            .where(
              eq(pimSchema.productMasterCategories.categoryId, categoryId),
            );
        } else {
          // 상품은 유지되지만 카테고리 연결만 제거
          await txn
            .delete(pimSchema.productMasterCategories)
            .where(
              eq(pimSchema.productMasterCategories.categoryId, categoryId),
            );
        }
      }

      await txn
        .delete(pimSchema.productCategories)
        .where(eq(pimSchema.productCategories.id, categoryId));
    };

    // 트랜잭션 처리
    if (tx) {
      await executeDelete(tx);
    } else {
      await this.db.db.transaction(executeDelete);
    }
  }

  async getCategoryById(
    categoryId: string,
    tx?: DbTransaction,
  ): Promise<CategoryDetailResponseDto> {
    const client = this.getClient(tx);

    const [category] = await client
      .select()
      .from(pimSchema.productCategories)
      .where(eq(pimSchema.productCategories.id, categoryId));

    if (!category) {
      throw new Error(`Category not found: ${categoryId}`);
    }

    const children = await client
      .select()
      .from(pimSchema.productCategories)
      .where(eq(pimSchema.productCategories.parentId, categoryId))
      .orderBy(pimSchema.productCategories.sortOrder);

    const directProductCount = await this.getCategoryProductCount(
      categoryId,
      false,
      tx,
    );
    const totalProductCount = await this.getCategoryProductCount(
      categoryId,
      true,
      tx,
    );

    const responseDto: CategoryDetailResponseDto = {
      ...category,
      children: children,
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

    const responseDto: CategoryResponseDto[] = categories;
    return responseDto;
  }

  async getCategoryTree(
    maxDepth?: number,
    tx?: DbTransaction,
  ): Promise<CategoryTreeResponseDto> {
    const client = this.getClient(tx);

    // Get all categories
    const allCategories = await client
      .select()
      .from(pimSchema.productCategories)
      .where(eq(pimSchema.productCategories.isActive, true))
      .orderBy(
        pimSchema.productCategories.level,
        pimSchema.productCategories.sortOrder,
      );

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

  async getChildCategories(
    categoryId: string,
    tx?: DbTransaction,
  ): Promise<CategoryResponseDto[]> {
    const client = this.getClient(tx);

    const children = await client
      .select()
      .from(pimSchema.productCategories)
      .where(eq(pimSchema.productCategories.parentId, categoryId))
      .orderBy(pimSchema.productCategories.sortOrder);

    const responseDto: CategoryResponseDto[] = children;
    return responseDto;
  }

  async moveCategory(
    categoryId: string,
    newParentId?: string,
    tx?: DbTransaction,
  ): Promise<CategoryResponseDto> {
    const client = this.getClient(tx);

    const executeMove = async (txn: any) => {
      const [category] = await txn
        .select()
        .from(pimSchema.productCategories)
        .where(eq(pimSchema.productCategories.id, categoryId));

      if (!category) {
        throw new Error(`Category not found: ${categoryId}`);
      }

      let newParentCategory: any = null;
      if (newParentId) {
        const parentResult = await txn
          .select()
          .from(pimSchema.productCategories)
          .where(eq(pimSchema.productCategories.id, newParentId));

        if (parentResult.length === 0) {
          throw new Error(`Parent category not found: ${newParentId}`);
        }

        newParentCategory = parentResult[0];

        // 순환 참조 확인 - 새 부모가 현재 카테고리의 자식인지 검사
        if (await this.checkCircularReference(categoryId, newParentId, txn)) {
          throw new Error(
            'Circular reference detected: Cannot move category to its own descendant',
          );
        }
      }

      const newLevel = newParentCategory ? newParentCategory.level + 1 : 0;
      const newPath = newParentCategory
        ? `${newParentCategory.path}/${categoryId}`
        : categoryId;

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

      return updatedCategory;
    };

    // 트랜잭션 처리
    const result = tx
      ? await executeMove(tx)
      : await this.db.db.transaction(executeMove);

    const responseDto: CategoryResponseDto = result;
    return responseDto;
  }

  // 자손들의 경로와 레벨을 재계산하는 헬퍼 메서드
  private async _updateDescendantPaths(
    categoryId: string,
    txn: any,
  ): Promise<void> {
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
  async getCategoryPath(
    categoryId: string,
    tx?: DbTransaction,
  ): Promise<CategoryPathResponseDto> {
    const client = this.getClient(tx);

    const [category] = await client
      .select()
      .from(pimSchema.productCategories)
      .where(eq(pimSchema.productCategories.id, categoryId));

    if (!category) {
      throw new Error(`Category not found: ${categoryId}`);
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

  async getCategoryDepth(
    categoryId: string,
    tx?: DbTransaction,
  ): Promise<number> {
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
      throw new Error(`Category not found: ${categoryId}`);
    }

    const maxChildLevel = result[0]?.maxLevel || category.level;
    return maxChildLevel - category.level;
  }

  async getAncestors(
    categoryId: string,
    tx?: DbTransaction,
  ): Promise<CategoryResponseDto[]> {
    const client = this.getClient(tx);

    const [category] = await client
      .select()
      .from(pimSchema.productCategories)
      .where(eq(pimSchema.productCategories.id, categoryId));

    if (!category) {
      throw new Error(`Category not found: ${categoryId}`);
    }

    const pathIds = category.path
      .split('/')
      .filter((id) => id && id !== categoryId);

    if (pathIds.length === 0) {
      return [];
    }

    const ancestors = await client
      .select()
      .from(pimSchema.productCategories)
      .where(inArray(pimSchema.productCategories.id, pathIds))
      .orderBy(pimSchema.productCategories.level);

    const responseDto: CategoryResponseDto[] = ancestors;
    return responseDto;
  }

  async getDescendants(
    categoryId: string,
    tx?: DbTransaction,
  ): Promise<CategoryResponseDto[]> {
    const client = this.getClient(tx);

    const [category] = await client
      .select()
      .from(pimSchema.productCategories)
      .where(eq(pimSchema.productCategories.id, categoryId));

    if (!category) {
      throw new Error(`Category not found: ${categoryId}`);
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
      .orderBy(
        pimSchema.productCategories.level,
        pimSchema.productCategories.sortOrder,
      );

    const responseDto: CategoryResponseDto[] = descendants;
    return responseDto;
  }

  // 상품 관리
  async getProductsByCategory(
    categoryId: string,
    includeSubcategories: boolean,
    tx?: DbTransaction,
  ) {
    const client = this.getClient(tx);

    // 카테고리 존재 확인
    const [category] = await client
      .select()
      .from(pimSchema.productCategories)
      .where(eq(pimSchema.productCategories.id, categoryId));

    if (!category) {
      throw new Error(`Category not found: ${categoryId}`);
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
        id: pimSchema.productMasters.id,
        name: pimSchema.productMasters.name,
        description: pimSchema.productMasters.description,
        brand: pimSchema.productMasters.brand,
        thumbnail: pimSchema.productMasters.thumbnail, // thumbnail 필드 추가
        basePrice: pimSchema.productMasters.basePrice,
        pricingStrategy: pimSchema.productMasters.pricingStrategy,
        tags: pimSchema.productMasters.tags,
        images: pimSchema.productMasters.images,
        attributes: pimSchema.productMasters.attributes,
        seoTitle: pimSchema.productMasters.seoTitle,
        seoDescription: pimSchema.productMasters.seoDescription,
        seoKeywords: pimSchema.productMasters.seoKeywords,
        descriptionHtml: pimSchema.productMasters.descriptionHtml,
        status: pimSchema.productMasters.status,
        isWholesaleOnly: pimSchema.productMasters.isWholesaleOnly,
        isMembershipOnly: pimSchema.productMasters.isMembershipOnly,
        createdAt: pimSchema.productMasters.createdAt,
        updatedAt: pimSchema.productMasters.updatedAt,
        createdBy: pimSchema.productMasters.createdBy,
        updatedBy: pimSchema.productMasters.updatedBy,
      })
      .from(pimSchema.productMasters)
      .innerJoin(
        pimSchema.productMasterCategories,
        eq(
          pimSchema.productMasters.id,
          pimSchema.productMasterCategories.masterId,
        ),
      )
      .where(inArray(pimSchema.productMasterCategories.categoryId, categoryIds))
      .orderBy(pimSchema.productMasters.name);

    return products;
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
      throw new Error(`Category not found: ${categoryId}`);
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
        count: sql<number>`COUNT(DISTINCT ${pimSchema.productMasters.id})`,
      })
      .from(pimSchema.productMasters)
      .innerJoin(
        pimSchema.productMasterCategories,
        eq(
          pimSchema.productMasters.id,
          pimSchema.productMasterCategories.masterId,
        ),
      )
      .where(
        inArray(pimSchema.productMasterCategories.categoryId, categoryIds),
      );

    return result.count;
  }

  async moveProductsToCategory(
    productIds: string[],
    categoryId: string,
    tx?: DbTransaction,
  ): Promise<void> {
    if (!productIds || productIds.length === 0) {
      throw new Error('Product IDs are required');
    }

    const client = this.getClient(tx);

    const executeMove = async (txn: any) => {
      // 1. 대상 카테고리 존재 확인
      const [category] = await txn
        .select()
        .from(pimSchema.productCategories)
        .where(eq(pimSchema.productCategories.id, categoryId));

      if (!category) {
        throw new Error(`Category not found: ${categoryId}`);
      }

      // 2. 상품들이 존재하는지 확인
      const existingProducts = await txn
        .select({ id: pimSchema.productMasters.id })
        .from(pimSchema.productMasters)
        .where(inArray(pimSchema.productMasters.id, productIds));

      const existingProductIds = existingProducts.map((p) => p.id);
      const missingProductIds = productIds.filter(
        (id) => !existingProductIds.includes(id),
      );

      if (missingProductIds.length > 0) {
        throw new Error(`Products not found: ${missingProductIds.join(', ')}`);
      }

      // 3. 기존 카테고리 관계 삭제
      await txn
        .delete(pimSchema.productMasterCategories)
        .where(inArray(pimSchema.productMasterCategories.masterId, productIds));

      // 4. 새 카테고리 관계 생성
      const newRelations = productIds.map((productId) => ({
        masterId: productId,
        categoryId: categoryId,
        isPrimary: true, // 기본값으로 주 카테고리로 설정
        createdAt: new Date(),
      }));

      await txn.insert(pimSchema.productMasterCategories).values(newRelations);
    };

    // 트랜잭션 처리
    if (tx) {
      await executeMove(tx);
    } else {
      await this.db.db.transaction(executeMove);
    }
  }

  // 고지훈 추가 - 기존 카테고리를 유지하면서 추가로 카테고리에 상품 연결 (다대다 지원)
  async addProductsToCategory(
    productIds: string[],
    categoryId: string,
    tx?: DbTransaction,
  ): Promise<void> {
    if (!productIds || productIds.length === 0) {
      throw new Error('Product IDs are required');
    }

    const client = this.getClient(tx);

    const executeAdd = async (txn: any) => {
      // 1. 대상 카테고리 존재 확인
      const [category] = await txn
        .select()
        .from(pimSchema.productCategories)
        .where(eq(pimSchema.productCategories.id, categoryId));

      if (!category) {
        throw new Error(`Category not found: ${categoryId}`);
      }

      // 2. 상품들이 존재하는지 확인
      const existingProducts = await txn
        .select({ id: pimSchema.productMasters.id })
        .from(pimSchema.productMasters)
        .where(inArray(pimSchema.productMasters.id, productIds));

      const existingProductIds = existingProducts.map((p) => p.id);
      const missingProductIds = productIds.filter(
        (id) => !existingProductIds.includes(id),
      );

      if (missingProductIds.length > 0) {
        throw new Error(`Products not found: ${missingProductIds.join(', ')}`);
      }

      // 3. 이미 연결된 상품-카테고리 관계 조회
      const existingRelations = await txn
        .select()
        .from(pimSchema.productMasterCategories)
        .where(
          and(
            inArray(pimSchema.productMasterCategories.masterId, productIds),
            eq(pimSchema.productMasterCategories.categoryId, categoryId),
          ),
        );

      const existingMasterIds = existingRelations.map((r) => r.masterId);

      // 4. 아직 연결되지 않은 상품들만 새로 연결
      const newProductIds = productIds.filter(
        (id) => !existingMasterIds.includes(id),
      );

      if (newProductIds.length > 0) {
        const newRelations = newProductIds.map((productId) => ({
          masterId: productId,
          categoryId: categoryId,
          isPrimary: false, // 추가 카테고리는 보조로 설정
          createdAt: new Date(),
        }));

        await txn
          .insert(pimSchema.productMasterCategories)
          .values(newRelations);
      }
    };

    // 트랜잭션 처리
    if (tx) {
      await executeAdd(tx);
    } else {
      await this.db.db.transaction(executeAdd);
    }
  }

  // 검색 및 필터링
  async searchCategories(
    query: string,
    parentId?: string,
    tx?: DbTransaction,
  ): Promise<CategoryResponseDto[]> {
    const client = this.getClient(tx);

    if (!query || query.trim() === '') {
      throw new Error('Search query is required');
    }

    const searchTerm = `%${query.trim()}%`;
    let whereConditions = [
      or(
        like(pimSchema.productCategories.name, searchTerm),
        like(pimSchema.productCategories.description, searchTerm),
      ),
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
      .orderBy(
        pimSchema.productCategories.level,
        pimSchema.productCategories.name,
      );

    const responseDto: CategoryResponseDto[] = categories;
    return responseDto;
  }

  async getCategoriesByLevel(
    level: number,
    tx?: DbTransaction,
  ): Promise<CategoryResponseDto[]> {
    const client = this.getClient(tx);

    if (level < 0) {
      throw new Error('Level must be non-negative');
    }

    const categories = await client
      .select()
      .from(pimSchema.productCategories)
      .where(eq(pimSchema.productCategories.level, level))
      .orderBy(
        pimSchema.productCategories.sortOrder,
        pimSchema.productCategories.name,
      );

    const responseDto: CategoryResponseDto[] = categories;
    return responseDto;
  }

  // 정렬 및 순서
  async reorderCategories(
    parentId: string,
    categoryIds: string[],
    tx?: DbTransaction,
  ): Promise<void> {
    if (!categoryIds || categoryIds.length === 0) {
      throw new Error('Category IDs are required');
    }

    const client = this.getClient(tx);

    const executeReorder = async (txn: any) => {
      // 1. 부모 카테고리 존재 확인 (parentId가 있는 경우)
      if (parentId) {
        const [parentCategory] = await txn
          .select()
          .from(pimSchema.productCategories)
          .where(eq(pimSchema.productCategories.id, parentId));

        if (!parentCategory) {
          throw new Error(`Parent category not found: ${parentId}`);
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
        throw new Error(
          'Some categories do not belong to the specified parent',
        );
      }

      // 3. sortOrder 업데이트
      for (let i = 0; i < categoryIds.length; i++) {
        await txn
          .update(pimSchema.productCategories)
          .set({
            sortOrder: i,
            updatedAt: new Date(),
          })
          .where(eq(pimSchema.productCategories.id, categoryIds[i]));
      }
    };

    // 트랜잭션 처리
    if (tx) {
      await executeReorder(tx);
    } else {
      await this.db.db.transaction(executeReorder);
    }
  }

  async updateSortOrder(
    categoryId: string,
    sortOrder: number,
    tx?: DbTransaction,
  ): Promise<CategoryResponseDto> {
    const client = this.getClient(tx);

    if (sortOrder < 0) {
      throw new Error('Sort order must be non-negative');
    }

    // 카테고리 존재 확인
    const [category] = await client
      .select()
      .from(pimSchema.productCategories)
      .where(eq(pimSchema.productCategories.id, categoryId));

    if (!category) {
      throw new Error(`Category not found: ${categoryId}`);
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

    const responseDto: CategoryResponseDto = updatedCategory;
    return responseDto;
  }

  // 검증 및 유틸리티
  async validateCategoryMove(
    categoryId: string,
    newParentId?: string,
    tx?: DbTransaction,
  ): Promise<boolean> {
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

  async checkCircularReference(
    categoryId: string,
    newParentId: string,
    tx?: DbTransaction,
  ): Promise<boolean> {
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
    return (
      newParent.path.startsWith(currentCategory.path + '/') ||
      newParent.path === currentCategory.path
    );
  }

  async rebuildCategoryPaths(tx?: DbTransaction): Promise<void> {
    const client = this.getClient(tx);

    const executeRebuild = async (txn: any) => {
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
    if (tx) {
      await executeRebuild(tx);
    } else {
      await this.db.db.transaction(executeRebuild);
    }
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
    const client = this.getClient(tx);

    const [category] = await client
      .select()
      .from(pimSchema.productCategories)
      .where(eq(pimSchema.productCategories.id, categoryId));

    if (!category) {
      throw new Error(`Category not found: ${categoryId}`);
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

    const responseDto: CategoryResponseDto = updated;
    return responseDto;
  }

  /**
   * 카테고리 SEO 설정 업데이트
   */
  async updateSeoConfig(
    categoryId: string,
    dto: UpdateSeoConfigDto,
    tx?: DbTransaction,
  ): Promise<CategoryResponseDto> {
    const client = this.getClient(tx);

    const [category] = await client
      .select()
      .from(pimSchema.productCategories)
      .where(eq(pimSchema.productCategories.id, categoryId));

    if (!category) {
      throw new Error(`Category not found: ${categoryId}`);
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

    const responseDto: CategoryResponseDto = updated;
    return responseDto;
  }

  /**
   * 카테고리 템플릿 설정 업데이트
   */
  async updateTemplateConfig(
    categoryId: string,
    dto: UpdateTemplateConfigDto,
    tx?: DbTransaction,
  ): Promise<CategoryResponseDto> {
    const client = this.getClient(tx);

    const [category] = await client
      .select()
      .from(pimSchema.productCategories)
      .where(eq(pimSchema.productCategories.id, categoryId));

    if (!category) {
      throw new Error(`Category not found: ${categoryId}`);
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

    const responseDto: CategoryResponseDto = updated;
    return responseDto;
  }

  /**
   * 카테고리 표시 여부 업데이트
   */
  async updateVisibility(
    categoryId: string,
    visible: boolean,
    tx?: DbTransaction,
  ): Promise<CategoryResponseDto> {
    const client = this.getClient(tx);

    const [category] = await client
      .select()
      .from(pimSchema.productCategories)
      .where(eq(pimSchema.productCategories.id, categoryId));

    if (!category) {
      throw new Error(`Category not found: ${categoryId}`);
    }

    const [updated] = await client
      .update(pimSchema.productCategories)
      .set({
        visibility: visible,
        updatedAt: new Date(),
      })
      .where(eq(pimSchema.productCategories.id, categoryId))
      .returning();

    const responseDto: CategoryResponseDto = updated;
    return responseDto;
  }
}
