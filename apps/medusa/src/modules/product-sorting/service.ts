import type { Context } from '@medusajs/framework/types';
import { InjectManager, MedusaContext, MedusaService } from '@medusajs/framework/utils';
import type { EntityManager } from '@mikro-orm/knex';
import ProductSortIndex from './models/product-sort-index';

export type SortField = 'min_price' | 'max_price' | 'sales_count' | 'review_count';

const SORT_COLUMNS: Record<SortField, string> = {
  min_price: 'min_price',
  max_price: 'max_price',
  sales_count: 'sales_count',
  review_count: 'review_count',
};

export type SortedProductIdsParams = {
  sortBy: SortField;
  order: 'asc' | 'desc';
  limit: number;
  offset: number;
  currencyCode: string;
  categoryIds?: string[];
  collectionId?: string;
  /** 비회원 요청. metadata.isVisibleToMembersOnly 상품을 SQL 단계에서 제외한다. */
  excludeMembersOnly: boolean;
};

type UpsertSortIndexData = {
  product_id: string;
  currency_code: string;
  min_price?: number;
  max_price?: number;
  sales_count?: number;
  view_count?: number;
  review_count?: number;
};

type ProductSortIndexRecord = {
  id: string;
  product_id: string;
  min_price: number;
  max_price: number;
  sales_count: number;
  view_count: number;
  review_count: number;
  currency_code: string;
};

type ListOptions = {
  order?: Record<string, 'ASC' | 'DESC'>;
  take?: number;
  skip?: number;
};

type ProductSortIndexFilter = Omit<Partial<ProductSortIndexRecord>, 'product_id'> & {
  product_id?: string | { $in: string[] };
};

interface GeneratedMethods {
  listProductSortIndices(filters: ProductSortIndexFilter, options?: ListOptions): Promise<ProductSortIndexRecord[]>;
  listAndCountProductSortIndices(
    filters: ProductSortIndexFilter,
    options?: ListOptions,
  ): Promise<[ProductSortIndexRecord[], number]>;
  createProductSortIndices(data: Partial<ProductSortIndexRecord>): Promise<ProductSortIndexRecord>;
  updateProductSortIndices(data: Partial<ProductSortIndexRecord> & { id: string }): Promise<ProductSortIndexRecord>;
}

class ProductSortingModuleService extends MedusaService({ ProductSortIndex }) {
  /**
   * 카테고리/컬렉션 필터 + 정렬 + 페이지네이션을 단일 SQL 로 처리하고 상품 id 만 돌려준다.
   *
   * product_sort_index(이 모듈)와 product_category_product(product 모듈)는 서로 다른 모듈이라
   * query.graph 로는 조인할 수 없다. 그래서 예전엔 "카테고리 상품 id 전량 로드 → 메모리에서
   * $in 교집합" 으로 우회했는데, 6천 개짜리 카테고리에서 12개를 보여주려고 매 요청마다 6천 건을
   * 실어 나르는 비용이 정렬 지연의 주원인이었다. 같은 Postgres 안에 있는 테이블이므로 knex 로
   * 직접 조인해 LIMIT 까지 DB 에서 끝낸다.
   */
  @InjectManager()
  async listSortedProductIds(
    params: SortedProductIdsParams,
    @MedusaContext() sharedContext: Context<EntityManager> = {},
  ): Promise<{ productIds: string[]; count: number }> {
    const knex = sharedContext.manager!.getKnex();
    const { sortBy, order, limit, offset, currencyCode, categoryIds, collectionId, excludeMembersOnly } = params;

    const base = knex('product_sort_index as psi')
      .join('product as p', 'p.id', 'psi.product_id')
      .whereNull('psi.deleted_at')
      .whereNull('p.deleted_at')
      .where('p.status', 'published')
      .where('psi.currency_code', currencyCode);

    // 카테고리 소속 상품을 CTE 로 먼저 확정한 뒤 조인한다. DISTINCT 가 필요한 건 하위 카테고리를
    // 함께 넘길 때 한 상품이 여러 카테고리에 걸쳐 중복 행이 되기 때문.
    //
    // EXISTS 로 쓰면 대부분 더 빠르지만(대형 카테고리 ~2ms) 카테고리 밀도가 전체 상품의 5% 안팎인
    // 구간에서 플래너가 정렬 인덱스를 전량 훑는 플랜을 골라 50ms 로 튄다 — 밀도에 따라 예측 불가능한
    // 절벽이 생긴다. CTE 는 전 구간 8ms 이하로 평탄하고 전체 상품 수가 아니라 카테고리 크기에만
    // 비례해서, 대형 카테고리에서 몇 ms 손해를 보더라도 이쪽이 안전하다.
    if (categoryIds?.length) {
      base
        .with('cat', (qb) =>
          qb.distinct('product_id').from('product_category_product').whereIn('product_category_id', categoryIds),
        )
        .join('cat', 'cat.product_id', 'psi.product_id');
    }

    if (collectionId) {
      base.where('p.collection_id', collectionId);
    }

    if (excludeMembersOnly) {
      base.whereRaw("(p.metadata->>'isVisibleToMembersOnly') IS DISTINCT FROM 'true'");
    }

    const [countRow, rows] = await Promise.all([
      base.clone().count<{ count: string }[]>({ count: '*' }).first(),
      base
        .clone()
        .select<{ product_id: string }[]>('psi.product_id')
        // sales_count / review_count 는 0 인 상품이 많아 동점이 대량 발생한다. tie-breaker
        // (product_id) 가 없으면 OFFSET 페이지네이션에서 같은 상품이 여러 페이지에 중복 출력된다.
        .orderBy([
          { column: `psi.${SORT_COLUMNS[sortBy]}`, order },
          { column: 'psi.product_id', order: 'asc' },
        ])
        .limit(limit)
        .offset(offset),
    ]);

    return {
      productIds: rows.map((row) => row.product_id),
      count: Number(countRow?.count ?? 0),
    };
  }

  private get methods(): GeneratedMethods {
    return this as unknown as GeneratedMethods;
  }

  async upsertSortIndex(data: UpsertSortIndexData) {
    const existing = await this.methods.listProductSortIndices({
      product_id: data.product_id,
      currency_code: data.currency_code,
    });

    if (existing.length > 0) {
      const updateData: Partial<UpsertSortIndexData> & { id: string } = {
        id: existing[0].id,
      };
      if (data.min_price !== undefined) updateData.min_price = data.min_price;
      if (data.max_price !== undefined) updateData.max_price = data.max_price;
      if (data.sales_count !== undefined) updateData.sales_count = data.sales_count;
      if (data.view_count !== undefined) updateData.view_count = data.view_count;
      if (data.review_count !== undefined) updateData.review_count = data.review_count;

      return await this.methods.updateProductSortIndices(updateData);
    }

    return await this.methods.createProductSortIndices(data);
  }

  async incrementSalesCount(productId: string, currencyCode: string, quantity: number) {
    const existing = await this.methods.listProductSortIndices({
      product_id: productId,
      currency_code: currencyCode,
    });

    if (existing.length > 0) {
      const currentCount = existing[0].sales_count ?? 0;
      return await this.methods.updateProductSortIndices({
        id: existing[0].id,
        sales_count: currentCount + quantity,
      });
    }

    return await this.methods.createProductSortIndices({
      product_id: productId,
      currency_code: currencyCode,
      sales_count: quantity,
    });
  }
}

export default ProductSortingModuleService;
