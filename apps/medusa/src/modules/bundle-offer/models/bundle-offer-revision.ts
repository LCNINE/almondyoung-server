import { model } from '@medusajs/framework/utils';

/**
 * 상품(A)마다 마지막으로 적용한 구성품 교체의 리비전(core 저장 시각). 구성품이 0개가 돼도 남아서,
 * 늦게 도착한 옛 교체(재시도된 이벤트·지연된 발행 스냅샷)가 새 상태를 덮지 못하게 한다.
 */
const BundleOfferRevision = model
  .define(
    { name: 'BundleOfferRevision', tableName: 'bundle_offer_revision' },
    {
      id: model.id({ prefix: 'bdlr' }).primaryKey(),
      product_id: model.text(),
      changed_at: model.dateTime(),
    },
  )
  .indexes([{ on: ['product_id'], unique: true, where: 'deleted_at IS NULL' }]);

export default BundleOfferRevision;
