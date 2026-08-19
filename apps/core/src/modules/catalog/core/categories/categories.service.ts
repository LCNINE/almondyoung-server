import { Injectable, ConflictException, Logger } from '@nestjs/common';
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
import { ProjectionSnapshotAssembler } from '../products/assemblers/projection-snapshot.assembler';
import { eq, isNull, like, inArray, and, or, sql, asc } from 'drizzle-orm';
import { RowList } from 'postgres';
import { InjectPublisher, type PublisherFor } from '@app/events';
import { PRODUCT_STREAM } from '@packages/event-contracts/streams/product.stream';
import type {
  CategoryChangedPayload,
  CategorySnapshot,
  ProductMasterActiveVersionChangedPayload,
} from '@packages/event-contracts/streams/product.stream';

/** 카테고리 트리 최대 깊이 — 조상/자손 순회 무한루프 방지 */
const MAX_CATEGORY_DEPTH = 10;

@Injectable()
export class ProductCategoriesService {
  private readonly logger = new Logger(ProductCategoriesService.name);

  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly projectionSnapshotAssembler: ProjectionSnapshotAssembler,
    @InjectPublisher(PRODUCT_STREAM)
    private readonly productPublisher: PublisherFor<typeof PRODUCT_STREAM>,
  ) {}

  private getClient(tx?: DbTransaction): DbClient {
    return tx ?? this.db.db;
  }

  // 기본 CRUD
  async createCategory(data: CreateCategoryDto, tx?: DbTransaction): Promise<CategoryResponseDto> {
    return this.db.run(async (client) => {
      const { tagGroupLinks, isBrand, ...categoryData } = data;

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
        // 브랜드 여부는 별도 컬럼이 아니라 display_settings jsonb 안에 있다.
        ...(isBrand !== undefined && { displaySettings: { isBrand } }),
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
      const { tagGroupLinks, isVisibleToMembersOnly, isBrand, ...categoryData } = data;
      const updatingCategoryData: UpdateProductCategory = categoryData;

      // 멤버십 전용 노출·브랜드 여부는 별도 컬럼이 아니라 display_settings jsonb 안에 있다.
      let displaySettings: CategoryDisplaySettings | undefined;
      if (isVisibleToMembersOnly !== undefined || isBrand !== undefined) {
        const [current] = await client
          .select({ displaySettings: pimSchema.productCategories.displaySettings })
          .from(pimSchema.productCategories)
          .where(eq(pimSchema.productCategories.id, categoryId));

        if (!current) {
          throw new NotFoundError(`Category not found: ${categoryId}`);
        }

        displaySettings = {
          ...(current.displaySettings as CategoryDisplaySettings),
          ...(isVisibleToMembersOnly !== undefined && { isVisibleToMembersOnly }),
          ...(isBrand !== undefined && { isBrand }),
        };
      }

      const [updatedCategory] = await client
        .update(pimSchema.productCategories)
        .set({
          ...updatingCategoryData,
          ...(displaySettings && { displaySettings }),
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

      if (isVisibleToMembersOnly !== undefined) {
        await this.publishDescendantsChanged(categoryId, client);
      }

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

      // 연결이 끊기거나 다른 카테고리로 옮겨지는 상품들. 삭제 전에 미리 잡아둔다.
      const affectedActiveVersions = await this.getActiveVersionsInCategory(categoryId, txn);

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

      // 삭제된 카테고리에 걸려 있던 상품들도 프로젝션을 재발행한다.
      // (moveProductsTo 면 새 카테고리로, 아니면 연결 해제 상태로 반영)
      await this.publishProductProjectionRefresh(affectedActiveVersions, 'deleteCategory', txn);
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
          isVisibleToMembersOnly: category.displaySettings?.isVisibleToMembersOnly ?? false,
          // DB 의 imageUrl 을 API 의 thumbnail 로 맞춘다 (상세 응답과 동일한 이름)
          thumbnail: category.imageUrl,
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

      // 상품-카테고리 연결이 바뀌었으니 상품 프로젝션을 재발행해 Medusa/검색에 반영한다.
      await this.publishProductProjectionRefresh(productVersions, 'moveProductsToCategory', txn);
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

        // 실제로 새로 연결된 상품만 재발행한다 (이미 연결돼 있던 건 변화 없음).
        await this.publishProductProjectionRefresh(newProductVersions, 'addProductsToCategory', txn);
      }
    };

    // 트랜잭션 처리
    await this.db.run(executeAdd, tx);
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
   * 멤버십 전용 플래그는 자손까지 상속된다. 부모에서 값이 바뀌면 자손들의
   * 프로젝션도 다시 계산돼야 하므로 자손 카테고리 이벤트를 함께 발행한다.
   */
  private async publishDescendantsChanged(categoryId: string, txn: DbTransaction): Promise<void> {
    // path LIKE 는 레거시 path 포맷에서 신뢰할 수 없어 parentId 로 내려간다.
    const descendants: ProductCategory[] = [];
    let frontier = [categoryId];

    for (let depth = 0; frontier.length > 0 && depth < MAX_CATEGORY_DEPTH; depth += 1) {
      const children = await txn
        .select()
        .from(pimSchema.productCategories)
        .where(inArray(pimSchema.productCategories.parentId, frontier));

      if (children.length === 0) break;

      descendants.push(...children);
      frontier = children.map((child) => child.id);
    }

    for (const descendant of descendants) {
      await this.publishCategoryEvent(descendant.id, 'updated', this.buildCategorySnapshot(descendant), txn);
    }

    if (descendants.length > 0) {
      this.logger.log(`멤버십 전용 상속 반영 — 자손 ${descendants.length}건 재발행 (categoryId=${categoryId})`);
    }
  }

  /**
   * 루트 → 직계 부모 순서의 조상 스냅샷.
   *
   * 소비자(Medusa 동기화)가 부모를 먼저 보장하지 않으면, 부모보다 자식 이벤트가 먼저
   * 처리될 때 자식이 최상위 카테고리로 붙는다. 이벤트 순서에 기대지 않도록 함께 싣는다.
   */
  private async buildAncestorSnapshots(snapshot: CategorySnapshot, tx: DbTransaction): Promise<CategorySnapshot[]> {
    // path 는 신뢰하지 않는다 — 레거시(cafe24 마이그레이션) 행은 path 가 '728' 처럼
    // 코드 문자열이라 UUID 로 조회하면 터진다. parentId 를 따라 직접 올라간다.
    const ancestors: CategorySnapshot[] = [];
    let parentId = snapshot.parentId;

    for (let depth = 0; parentId && depth < MAX_CATEGORY_DEPTH; depth += 1) {
      const [parent] = await tx
        .select()
        .from(pimSchema.productCategories)
        .where(eq(pimSchema.productCategories.id, parentId));

      if (!parent) break;

      ancestors.unshift(this.buildCategorySnapshot(parent));
      parentId = parent.parentId;
    }

    return ancestors;
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
      ancestors: snapshot ? await this.buildAncestorSnapshots(snapshot, tx) : undefined,
    };

    await this.productPublisher.enqueue({ eventType: 'CategoryChanged', aggregateId: categoryId, payload }, tx);
  }

  /**
   * 상품↔카테고리 연결이 바뀐 활성 버전들의 프로젝션을 재발행한다.
   *
   * CategoryChanged 는 카테고리 자체(이름/부모/노출)만 전달한다. 어떤 상품이 어떤
   * 카테고리에 속하는지는 ProductMasterActiveVersionChanged 의 snapshot 이 SSOT 라서,
   * 이 이벤트를 다시 내보내야 Medusa 상품-카테고리 연결·검색 색인·분석 차원이 갱신된다.
   * 소비자들은 snapshot 으로 카테고리 집합을 통째로 덮어쓰므로 추가·이동·해제가 모두 반영된다.
   *
   * - 대상은 **활성 버전만**이다. draft 버전의 연결 변경은 그 버전이 published 될 때 반영된다.
   * - changeReason 은 소비자가 "snapshot 으로 upsert" 하는 유일한 값인 'published' 를 쓴다.
   *   (버전 전환이 아니므로 previousActiveVersionId 는 null)
   * - 한 상품의 스냅샷 조립이 실패해도 카테고리 작업 자체는 되돌리지 않는다. 이벤트를 아예
   *   내보내지 않던 기존 동작보다 나빠지지 않게 하되, 누락은 error 로그로 남긴다.
   */
  private async publishProductProjectionRefresh(
    targets: Array<{ masterId: string; versionId: string }>,
    reason: string,
    txn: DbTransaction,
  ): Promise<void> {
    const unique = new Map<string, { masterId: string; versionId: string }>();
    for (const target of targets) {
      unique.set(`${target.masterId}:${target.versionId}`, target);
    }
    if (unique.size === 0) return;

    const changedAt = new Date().toISOString();
    const skipped: string[] = [];

    for (const { masterId, versionId } of unique.values()) {
      let assembly: Awaited<ReturnType<ProjectionSnapshotAssembler['assembleActiveVersionSnapshot']>>;
      try {
        assembly = await this.projectionSnapshotAssembler.assembleActiveVersionSnapshot(masterId, versionId, txn);
      } catch (error) {
        // 조립은 순수 read 라 실패해도 트랜잭션 상태를 더럽히지 않는다.
        skipped.push(masterId);
        this.logger.error(
          `[${reason}] 프로젝션 스냅샷 조립 실패 — Medusa/검색 반영 누락 (masterId=${masterId}, versionId=${versionId}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        continue;
      }

      await this.productPublisher.enqueue(
        {
          eventType: 'ProductMasterActiveVersionChanged',
          aggregateId: masterId,
          payload: {
            masterId,
            versionId,
            name: assembly.snapshot?.name ?? null,
            previousActiveVersionId: null,
            categoryIds: assembly.categoryIds,
            primaryCategoryId: assembly.primaryCategoryId,
            changeReason: 'published',
            changedAt,
            snapshot: assembly.snapshot,
          } satisfies ProductMasterActiveVersionChangedPayload,
        },
        txn,
      );
    }

    this.logger.log(
      `[${reason}] 상품 프로젝션 재발행 ${unique.size - skipped.length}/${unique.size}건` +
        (skipped.length > 0 ? ` (실패: ${skipped.join(', ')})` : ''),
    );
  }

  /** 카테고리에 연결된 상품 중 **활성 버전**만 (masterId, versionId) 로 추린다. */
  private async getActiveVersionsInCategory(
    categoryId: string,
    txn: DbTransaction,
  ): Promise<Array<{ masterId: string; versionId: string }>> {
    return txn
      .select({
        masterId: pimSchema.productMasterCategories.masterId,
        versionId: pimSchema.productMasterCategories.versionId,
      })
      .from(pimSchema.productMasterCategories)
      .innerJoin(
        pimSchema.productMasterVersions,
        eq(pimSchema.productMasterVersions.id, pimSchema.productMasterCategories.versionId),
      )
      .where(
        and(
          eq(pimSchema.productMasterCategories.categoryId, categoryId),
          eq(pimSchema.productMasterVersions.status, 'active'),
        ),
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

      if (dto.isVisibleToMembersOnly !== undefined) {
        await this.publishDescendantsChanged(categoryId, client);
      }

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
