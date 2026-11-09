import { model } from '@medusajs/framework/utils';

/**
 * 함께 구매 구성품 하나. 상품(A) 상세에서 고객이 이 구성품(B)을 함께 담으면 B 만 할인된다.
 * 정본은 core 이고 상품(A)마다 목록 전체가 한 번에 바뀐다. 상품은 id 로 가리킨다(이름으로 찾지 않는다).
 */
const BundleOffer = model
  .define(
    { name: 'BundleOffer', tableName: 'bundle_offer' },
    {
      id: model.id({ prefix: 'bdlo' }).primaryKey(),
      product_id: model.text(),
      addon_product_id: model.text(),
      // core 의 구성품 마스터 id(진단·재동기화용)
      addon_pim_master_id: model.text(),
      // null 이면 구성품의 모든 옵션(Medusa variant id)
      allowed_variant_ids: model.array().nullable(),
      regular_rate_bp: model.number(),
      membership_rate_bp: model.number(),
      enabled: model.boolean().default(true),
      starts_at: model.dateTime().nullable(),
      ends_at: model.dateTime().nullable(),
      label: model.text().nullable(),
      sort: model.number().default(0),
    },
  )
  .indexes([
    { on: ['product_id', 'addon_product_id'], unique: true, where: 'deleted_at IS NULL' },
    { on: ['addon_product_id'], where: 'deleted_at IS NULL' },
  ]);

export default BundleOffer;
