// fields 정규화(`*items`, `+payment_collections...` 등 HTTP 필드 문법 → query.graph 형태)와
// 페이지네이션 metadata 를 위해 validateAndTransformQuery 에 넘기는 설정.
// 스토어프론트가 fields 쿼리로 필요한 필드를 명시하므로 defaults 는 최소 fallback.
export const listTransformQueryConfig = {
  defaults: [
    'id',
    'display_id',
    'status',
    'fulfillment_status',
    'payment_status',
    'created_at',
    'updated_at',
    'total',
    'currency_code',
    'metadata',
  ],
  isList: true,
};
