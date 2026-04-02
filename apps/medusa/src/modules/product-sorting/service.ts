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

class ProductSortingModuleService extends MedusaService({
  ProductSortIndex,
}) {
  async upsertSortIndex(data: UpsertSortIndexData) {
    const existing = await this.listProductSortIndices({
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

      return await this.updateProductSortIndices(updateData);
    }

    return await this.createProductSortIndices(data);
  }

  async incrementSalesCount(productId: string, currencyCode: string, quantity: number) {
    const existing = await this.listProductSortIndices({
      product_id: productId,
      currency_code: currencyCode,
    });

    if (existing.length > 0) {
      const currentCount = existing[0].sales_count ?? 0;
      return await this.updateProductSortIndices({
        id: existing[0].id,
        sales_count: currentCount + quantity,
      });
    }

    return await this.createProductSortIndices({
      product_id: productId,
      currency_code: currencyCode,
      sales_count: quantity,
    });
  }
}

export default ProductSortingModuleService;
