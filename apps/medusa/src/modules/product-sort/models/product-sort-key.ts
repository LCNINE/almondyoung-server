import { model } from '@medusajs/framework/utils';

export const ProductSortKey = model.define('product_sort_key', {
  id: model.id().primaryKey(),
  product_id: model.text().unique(),
  price_sort_key: model.bigNumber().nullable(),
  sales_sort_key: model.number().default(0),
  last_synced_at: model.dateTime().nullable(),
});
