import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthorizationService } from '@app/authorization';
import { DbService, InjectDb } from '@app/db';
import { and, asc, eq, ilike, inArray, isNull, sql } from 'drizzle-orm';
import { type ProductAiSales, salesProblems, productAiLookupSchema } from '@packages/product-ai/sales';
import { type DbTransaction } from '../../../catalog.types';
import {
  type PimSchema,
  productCategories,
  tagValues,
  productMasterOptionGroups,
  productOptionGroupDisplays,
  productOptionValueDisplays,
  productOptionValues,
  productMasterVariants,
  variantOptionValues,
} from '../../../schema/catalog.schema';
import { skus } from '../../../../inventory/schema/inventory.schema';
import { ProductCategoriesService } from '../../../core/categories/categories.service';
import { ProductMastersService } from '../../../core/products/services/product-masters.service';
import { PricingService } from '../../../core/pricing/pricing.service';
import { ProductSkuMappingService } from '../../../../product-matching/services/product-sku-mapping.service';

@Injectable()
export class ProductAiSalesService {
  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly categories: ProductCategoriesService,
    private readonly masters: ProductMastersService,
    private readonly pricing: PricingService,
    private readonly matching: ProductSkuMappingService,
    private readonly authorization: AuthorizationService,
  ) {}

  async canCreateSku(roles: string[]) {
    if (roles.includes('master')) return true;
    if (!roles.length) return false;
    try {
      const scopes = await this.authorization.getScopesByRoles(roles);
      return scopes.has('master') || scopes.has('inventory.manage');
    } catch {
      return false;
    }
  }

  async lookup(input: unknown) {
    const { kind, query } = productAiLookupSchema.parse(input);
    const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
    if (kind === 'inventory')
      return this.db.db
        .select({ id: skus.id, name: skus.name, code: skus.code, optionKey: skus.optionKey, stockType: skus.stockType })
        .from(skus)
        .where(and(isNull(skus.deletedAt), ilike(skus.name, pattern)))
        .orderBy(asc(skus.name), asc(skus.id))
        .limit(20);
    if (kind === 'tags')
      return this.db.db
        .select()
        .from(tagValues)
        .where(and(ilike(tagValues.name, pattern), eq(tagValues.isActive, true)))
        .limit(20);
    return this.db.db
      .select({
        id: productCategories.id,
        name: productCategories.name,
        parentId: productCategories.parentId,
        path: productCategories.path,
      })
      .from(productCategories)
      .where(and(eq(productCategories.isActive, true), ilike(productCategories.name, pattern)))
      .orderBy(asc(productCategories.path))
      .limit(20);
  }

  async validate(sales: ProductAiSales, roles: string[], publishing: boolean, tx: DbTransaction) {
    const problems = publishing ? salesProblems(sales) : [];
    if (sales.options && sales.options.reduce((n, group) => n * group.values.length, 1) > 100)
      problems.push('옵션 조합은 100개까지 지원합니다.');
    if (sales.inventory.some((item) => Boolean(item.skuId) === Boolean(item.newSkuName)))
      problems.push('기존 재고와 새 재고 생성을 구분해 주세요.');
    if (problems.length) throw new BadRequestException(problems[0]);
    if (sales.inventory.some((item) => item.newSkuName) && !(await this.canCreateSku(roles)))
      throw new ForbiddenException('새 재고 품목 생성에는 inventory.manage 권한이 필요합니다.');
    const categoryIds = [
      ...new Set(
        sales.categories.flatMap((category) =>
          [category.id, category.parentId].filter((id): id is string => Boolean(id)),
        ),
      ),
    ];
    if (categoryIds.length) {
      const found = await tx
        .select({ id: productCategories.id })
        .from(productCategories)
        .where(and(inArray(productCategories.id, categoryIds), eq(productCategories.isActive, true)));
      if (found.length !== categoryIds.length)
        throw new BadRequestException('카테고리가 변경됐습니다. 다시 검색해 주세요.');
    }
    const skuIds = [...new Set(sales.inventory.flatMap((item) => (item.skuId ? [item.skuId] : [])))];
    if (skuIds.length) {
      const found = await tx
        .select({ id: skus.id })
        .from(skus)
        .where(and(inArray(skus.id, skuIds), isNull(skus.deletedAt)));
      if (found.length !== skuIds.length)
        throw new BadRequestException('재고 품목이 변경됐습니다. 다시 검색해 주세요.');
    }
  }

  async apply(
    versionId: string,
    masterId: string,
    sales: ProductAiSales,
    previous: ProductAiSales | null | undefined,
    tx: DbTransaction,
  ) {
    const categoryIds: string[] = [];
    for (const category of sales.categories) {
      if (category.id) {
        categoryIds.push(category.id);
        continue;
      }
      // Serialize name/parent creation and reuse exact matches on retries and later previews.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`product-ai-category:${category.parentId}:${category.name}`}))`,
      );
      const [existing] = await tx
        .select({ id: productCategories.id })
        .from(productCategories)
        .where(
          and(
            eq(productCategories.name, category.name),
            category.parentId ? eq(productCategories.parentId, category.parentId) : isNull(productCategories.parentId),
            eq(productCategories.isActive, true),
          ),
        )
        .limit(1);
      categoryIds.push(
        existing?.id ??
          (
            await this.categories.createCategory(
              { name: category.name, ...(category.parentId ? { parentId: category.parentId } : {}) },
              tx,
            )
          ).id,
      );
    }
    sales.categories.forEach((category, index) => {
      category.id = categoryIds[index];
    });
    const optionChanged = sales.options !== null && JSON.stringify(sales.options) !== JSON.stringify(previous?.options);
    const oldGroups = optionChanged
      ? await tx
          .select({ id: productMasterOptionGroups.optionGroupId })
          .from(productMasterOptionGroups)
          .where(eq(productMasterOptionGroups.versionId, versionId))
      : [];
    await this.masters.updateVersion(
      versionId,
      {
        ...(sales.marketPrice !== null ? { marketPrice: sales.marketPrice } : {}),
        ...(sales.supplyPrice !== null ? { supplyPrice: sales.supplyPrice } : {}),
        ...(categoryIds.length
          ? {
              categoryIds,
              ...(sales.primaryCategoryIndex !== null
                ? { primaryCategoryId: categoryIds[sales.primaryCategoryIndex] }
                : {}),
            }
          : {}),
        tagValueIds: sales.tagValueIds,
        ...(optionChanged
          ? {
              optionDiff: {
                remove: oldGroups.map((group) => group.id),
                add: sales.options!.map((group, sortOrder) => ({
                  displayName: group.name,
                  sortOrder,
                  values: group.values.map((displayName, sortOrder) => ({ displayName, sortOrder })),
                })),
              },
            }
          : {}),
      },
      tx,
    );

    const variants = await tx
      .select({ id: productMasterVariants.variantId })
      .from(productMasterVariants)
      .where(eq(productMasterVariants.versionId, versionId));
    const values = variants.length
      ? await tx
          .select({
            variantId: variantOptionValues.variantId,
            name: productOptionValueDisplays.displayName,
            order: productOptionGroupDisplays.sortOrder,
          })
          .from(variantOptionValues)
          .innerJoin(productOptionValues, eq(productOptionValues.id, variantOptionValues.optionValueId))
          .innerJoin(
            productOptionValueDisplays,
            and(
              eq(productOptionValueDisplays.optionValueId, productOptionValues.id),
              eq(productOptionValueDisplays.versionId, versionId),
              eq(productOptionValueDisplays.locale, 'ko-KR'),
            ),
          )
          .innerJoin(
            productOptionGroupDisplays,
            and(
              eq(productOptionGroupDisplays.optionGroupId, productOptionValues.optionGroupId),
              eq(productOptionGroupDisplays.versionId, versionId),
              eq(productOptionGroupDisplays.locale, 'ko-KR'),
            ),
          )
          .where(
            inArray(
              variantOptionValues.variantId,
              variants.map((variant) => variant.id),
            ),
          )
          .orderBy(asc(productOptionGroupDisplays.sortOrder))
      : [];
    const resolved = sales.inventory.map((item) => ({
      item,
      variant: variants.find(
        (variant) =>
          JSON.stringify(values.filter((value) => value.variantId === variant.id).map((value) => value.name)) ===
          JSON.stringify(item.optionValues),
      ),
    }));
    if (resolved.some((row) => !row.variant)) throw new BadRequestException('재고 연결의 옵션 조합을 확인해 주세요.');

    const rule = (layer: 'base_price' | 'membership_price', value: number, order: number, variantId?: string) => ({
      layer,
      order,
      scopeType: variantId ? ('variants' as const) : ('all_variants' as const),
      ...(variantId ? { scopeTargetIds: [variantId] } : {}),
      operationType: 'override' as const,
      operationValue: value,
    });
    if (sales.salePrice)
      await this.pricing.replaceVersionRules(
        versionId,
        {
          basePriceRules: [
            rule('base_price', sales.salePrice, 1),
            ...resolved.flatMap(({ item, variant }, index) =>
              item.salePrice ? [rule('base_price', item.salePrice, index + 2, variant!.id)] : [],
            ),
          ],
          membershipPriceRules: [
            ...(sales.membershipPricing === 'custom' && sales.membershipPrice
              ? [rule('membership_price', sales.membershipPrice, 1)]
              : []),
            ...resolved.flatMap(({ item, variant }, index) =>
              item.membershipPrice ? [rule('membership_price', item.membershipPrice, index + 2, variant!.id)] : [],
            ),
          ],
          tieredPriceRules: [],
        },
        tx,
      );
    for (const { item, variant } of resolved) {
      const saved = await this.matching.upsert(
        variant!.id,
        {
          masterId,
          links: [
            {
              ...(item.skuId
                ? { skuId: item.skuId }
                : {
                    newSku: {
                      name: item.newSkuName!,
                      optionKey: item.optionValues.join(' / '),
                      stockType: 'physical' as const,
                    },
                  }),
              quantity: item.quantity,
            },
          ],
          policy: { preStockSellable: false, alwaysSellableZeroStock: false },
        },
        tx,
      );
      if (item.newSkuName) {
        const skuId = saved?.links[0]?.skuId;
        if (!skuId) throw new BadRequestException('생성한 재고 연결을 확인하지 못했습니다.');
        item.skuId = skuId;
        item.newSkuName = null;
      }
    }
  }
}
