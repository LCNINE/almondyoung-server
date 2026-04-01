import { model } from '@medusajs/framework/utils';

const ProductSortKey = model.define(
  { name: 'ProductSortKey', tableName: 'product_sort_key' },
  {
    id: model.id().primaryKey(),
    product_id: model.text().unique(),
    price_sort_key: model.bigNumber().nullable(),
    sales_sort_key: model.bigNumber().default(0),
    last_synced_at: model.dateTime().nullable(),
  },
);

export default ProductSortKey;
