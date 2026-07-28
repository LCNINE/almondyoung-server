import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, getVariantAvailability, isPresent, QueryContext } from '@medusajs/framework/utils';
import { PRODUCT_SORTING_MODULE } from '../../../modules/product-sorting';
import {
  filterProductsForMemberState,
  resolveMemberState,
  type MembershipProduct,
} from '../../../utils/membership-filter';

type SortBy = 'min_price' | 'max_price' | 'sales_count' | 'review_count';
type SortOrder = 'asc' | 'desc';

interface ProductSortingService {
  listSortedProductIds(params: {
    sortBy: SortBy;
    order: SortOrder;
    limit: number;
    offset: number;
    currencyCode: string;
    categoryIds?: string[];
    collectionId?: string;
    excludeMembersOnly: boolean;
  }): Promise<{ productIds: string[]; count: number }>;
}

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  try {
    const sortingService = req.scope.resolve<ProductSortingService>(PRODUCT_SORTING_MODULE);
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
    const { isMember } = await resolveMemberState(req);

    const sortBy = (req.query.sort_by as SortBy) || 'sales_count';
    const order = (req.query.order as SortOrder) || 'desc';
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;
    const currencyCode = (req.query.currency_code as string) || 'krw';
    const rawCategoryId = req.query.category_id;
    const categoryIds: string[] = Array.isArray(rawCategoryId)
      ? (rawCategoryId as string[])
      : typeof rawCategoryId === 'string' && rawCategoryId
        ? [rawCategoryId]
        : [];
    const collectionId = (req.query.collection_id as string) || '';

    const validSortFields: SortBy[] = ['min_price', 'max_price', 'sales_count', 'review_count'];
    if (!validSortFields.includes(sortBy)) {
      return res.status(400).json({
        message: `Invalid sort_by field. Must be one of: ${validSortFields.join(', ')}`,
      });
    }

    // 카테고리/컬렉션 필터 + 정렬 + 페이지네이션을 단일 SQL 로 끝낸다.
    // status: 'published' 와 멤버십 전용 노출 제외를 여기서 걸어야 미발행(판매중단) 상품이
    // 정렬 단계부터 빠져 count 까지 정확해진다. (표준 /store/products 는 미들웨어가 자동으로
    // published 필터를 강제하지만, 이 라우트는 직접 조회하므로 명시 필요)
    const { productIds, count: totalCount } = await sortingService.listSortedProductIds({
      sortBy,
      order,
      limit,
      offset,
      currencyCode,
      categoryIds: categoryIds.length > 0 ? categoryIds : undefined,
      collectionId: collectionId || undefined,
      excludeMembersOnly: !isMember,
    });

    if (productIds.length === 0) {
      return res.json({ products: [], count: 0 });
    }

    // pricing context 구성
    const context: Record<string, unknown> = {};
    const pricingContext = (req as any).pricingContext ?? { currency_code: currencyCode };
    if (isPresent(pricingContext)) {
      context['variants'] = {
        calculated_price: QueryContext(pricingContext),
      };
    }

    const { data: products } = await query.graph({
      entity: 'product',
      fields: [
        'id',
        'title',
        'handle',
        'thumbnail',
        // metadata: 멤버십가 공개 제한과 멤버십 회원 전용 노출 판정에 필요
        'metadata',
        'variants.*',
        'variants.calculated_price.*',
        'images.*',
      ],
      // 카테고리/컬렉션 필터가 없는 전역 정렬 목록까지 커버하기 위한 방어적 필터.
      // 카테고리가 있는 경우엔 위에서 이미 published 만 추렸으므로 사실상 no-op.
      filters: { id: productIds, status: 'published' },
      context,
    });

    const productMap = new Map(products.map((p: { id: string }) => [p.id, p]));
    const sorted = filterProductsForMemberState(
      productIds.map((id) => productMap.get(id)).filter(Boolean) as MembershipProduct[],
      isMember,
    );

    // inventory_quantity 는 query.graph 파생 필드로 안 나온다. 판매채널 재고를 별도 계산해
    // manage_inventory variant 에 붙인다 (core /store/products 의
    // wrapVariantsWithInventoryQuantityForSalesChannel 과 동일 로직). 안 붙이면 스토어프론트
    // 품절 판정이 undefined→0 으로 떨어져 재고 있는 상품도 회원에게 품절로 뜬다.
    const salesChannelIds =
      (req as unknown as { publishable_key_context?: { sales_channel_ids?: string[] } }).publishable_key_context
        ?.sales_channel_ids ?? [];
    const salesChannelId = salesChannelIds.length === 1 ? salesChannelIds[0] : undefined;
    const allVariants = sorted.flatMap((p) => (Array.isArray(p.variants) ? p.variants : [])) as Array<{
      id?: string;
      manage_inventory?: boolean;
      inventory_quantity?: number;
    }>;
    const variantIds = allVariants.map((v) => v.id).filter((id): id is string => typeof id === 'string');
    if (salesChannelId && variantIds.length > 0) {
      const availability = await getVariantAvailability(query, {
        variant_ids: variantIds,
        sales_channel_id: salesChannelId,
      });
      for (const variant of allVariants) {
        if (variant.manage_inventory && variant.id) {
          variant.inventory_quantity = availability[variant.id]?.availability ?? 0;
        }
      }
    }

    res.json({ products: sorted, count: totalCount });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[ProductSorting] API Error:', error);
    res.status(500).json({ error: message });
  }
}
