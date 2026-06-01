import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, isPresent, QueryContext } from '@medusajs/framework/utils';
import { PRODUCT_SORTING_MODULE } from '../../../modules/product-sorting';

type SortBy = 'min_price' | 'max_price' | 'sales_count' | 'review_count';
type SortOrder = 'asc' | 'desc';

type ProductSortIndexRecord = {
  id: string;
  product_id: string;
  min_price: number;
  max_price: number;
  sales_count: number;
  currency_code: string;
};

type ProductSortIndexFilter = Omit<Partial<ProductSortIndexRecord>, 'product_id'> & {
  product_id?: string | { $in: string[] };
};

interface ProductSortingService {
  listProductSortIndices(
    filters: ProductSortIndexFilter,
    options?: { order?: Record<string, 'ASC' | 'DESC'>; take?: number; skip?: number },
  ): Promise<ProductSortIndexRecord[]>;
  listAndCountProductSortIndices(
    filters: ProductSortIndexFilter,
    options?: { order?: Record<string, 'ASC' | 'DESC'>; take?: number; skip?: number },
  ): Promise<[ProductSortIndexRecord[], number]>;
}


export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const sortingService = req.scope.resolve<ProductSortingService>(PRODUCT_SORTING_MODULE);
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

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

    // 카테고리/컬렉션 필터가 있으면 해당 상품 ID들을 먼저 조회
    let categoryProductIds: string[] | null = null;
    if (categoryIds.length > 0 || collectionId) {
      const categoryFilters: Record<string, unknown> = {};

      if (categoryIds.length > 0) {
        categoryFilters.categories = { id: categoryIds };
      }

      if (collectionId) {
        categoryFilters.collection_id = collectionId;
      }

      const { data: categoryProducts } = await query.graph({
        entity: 'product',
        fields: ['id'],
        filters: categoryFilters,
      });

      categoryProductIds = categoryProducts.map((p: { id: string }) => p.id);

      if (categoryProductIds.length === 0) {
        return res.json({ products: [], count: 0 });
      }
    }

    // 정렬 인덱스 필터 구성
    const sortIndexFilter: ProductSortIndexFilter = { currency_code: currencyCode };
    if (categoryProductIds) {
      sortIndexFilter.product_id = { $in: categoryProductIds };
    }

    const [sortIndexes, totalCount] = await sortingService.listAndCountProductSortIndices(
      sortIndexFilter,
      {
        // sales_count / review_count 는 0 인 상품이 많아 동점이 대량 발생한다.
        // tie-breaker(product_id) 가 없으면 OFFSET 페이지네이션에서 동점 상품의
        // 순서가 페이지마다 흔들려 같은 상품이 여러 페이지에 중복 출력된다.
        order: { [sortBy]: order === 'desc' ? 'DESC' : 'ASC', product_id: 'ASC' },
        take: limit,
        skip: offset,
      },
    );

    const productIds = sortIndexes.map((s) => s.product_id);

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
        'variants.*',
        'variants.calculated_price.*',
        'images.*',
      ],
      filters: { id: productIds },
      context,
    });

    const productMap = new Map(products.map((p: { id: string }) => [p.id, p]));
    const sorted = productIds.map((id) => productMap.get(id)).filter(Boolean);

    res.json({ products: sorted, count: totalCount });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[ProductSorting] API Error:', error);
    res.status(500).json({ error: message });
  }
}
