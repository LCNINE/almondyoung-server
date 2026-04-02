import { MedusaService } from '@medusajs/framework/utils';
import ProductSortIndex from './models/product-sort-index';

type UpsertSortIndexData = {
  product_id: string;
  currency_code: string;
  min_price?: number;
  max_price?: number;
  sales_count?: number;
  view_count?: number;
};

type ProductSortIndexRecord = {
  id: string;
  product_id: string;
  min_price: number;
  max_price: number;
  sales_count: number;
  view_count: number;
  currency_code: string;
};

type ListOptions = {
  order?: Record<string, 'ASC' | 'DESC'>;
  take?: number;
  skip?: number;
};

// MedusaService가 런타임에 생성하는 메서드 타입 정의
interface GeneratedMethods {
  listProductSortIndices(
    filters: Partial<ProductSortIndexRecord>,
    options?: ListOptions,
  ): Promise<ProductSortIndexRecord[]>;
  createProductSortIndices(data: Partial<ProductSortIndexRecord>): Promise<ProductSortIndexRecord>;
  updateProductSortIndices(data: Partial<ProductSortIndexRecord> & { id: string }): Promise<ProductSortIndexRecord>;
}

class ProductSortingModuleService extends MedusaService({ ProductSortIndex }) {
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
