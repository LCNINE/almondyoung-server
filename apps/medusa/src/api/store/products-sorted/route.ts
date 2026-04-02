import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { PRODUCT_SORTING_MODULE } from '../../../modules/product-sorting';

type SortBy = 'min_price' | 'max_price' | 'sales_count' | 'view_count';
type SortOrder = 'asc' | 'desc';

type ProductSortIndexRecord = {
  id: string;
  product_id: string;
  min_price: number;
  max_price: number;
  sales_count: number;
  view_count: number;
  currency_code: string;
};

interface ProductSortingService {
  listProductSortIndices(
    filters: Partial<ProductSortIndexRecord>,
    options?: { order?: Record<string, 'ASC' | 'DESC'>; take?: number; skip?: number },
  ): Promise<ProductSortIndexRecord[]>;
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const sortingService = req.scope.resolve<ProductSortingService>(PRODUCT_SORTING_MODULE);
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

    const sortBy = (req.query.sort_by as SortBy) || 'min_price';
    const order = (req.query.order as SortOrder) || 'asc';
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;
    const currencyCode = (req.query.currency_code as string) || 'krw';

    const validSortFields: SortBy[] = ['min_price', 'max_price', 'sales_count', 'view_count'];
    if (!validSortFields.includes(sortBy)) {
      return res.status(400).json({
        message: `Invalid sort_by field. Must be one of: ${validSortFields.join(', ')}`,
      });
    }

    const sortIndexes = await sortingService.listProductSortIndices(
      { currency_code: currencyCode },
      {
        order: { [sortBy]: order === 'desc' ? 'DESC' : 'ASC' },
        take: limit,
        skip: offset,
      },
    );

    const productIds = sortIndexes.map((s) => s.product_id);

    if (productIds.length === 0) {
      return res.json({ products: [], count: 0 });
    }

    const { data: products } = await query.graph({
      entity: 'product',
      fields: ['id', 'title', 'handle', 'thumbnail', 'variants.*', 'images.*'],
      filters: { id: productIds },
    });

    const productMap = new Map(products.map((p: { id: string }) => [p.id, p]));
    const sorted = productIds.map((id) => productMap.get(id)).filter(Boolean);

    res.json({ products: sorted, count: sorted.length });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[ProductSorting] API Error:', error);
    res.status(500).json({ error: message });
  }
}
