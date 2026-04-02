import { model } from '@medusajs/framework/utils';

const ProductSortIndex = model
  .define(
    { name: 'ProductSortIndex', tableName: 'product_sort_index' },
    {
      id: model.id().primaryKey(),
      product_id: model.text(),
      min_price: model.bigNumber().default(0),
      max_price: model.bigNumber().default(0),
      sales_count: model.number().default(0),
      view_count: model.number().default(0),
      currency_code: model.text().default('krw'),
    },
  )
  .indexes([
    {
      on: ['min_price'],
      name: 'idx_sort_min_price',
    },
    {
      on: ['sales_count'],
      name: 'idx_sort_sales_count',
    },
    {
      on: ['product_id', 'currency_code'],
      name: 'idx_sort_product_currency',
      unique: true,
    },
  ]);

export default ProductSortIndex;
