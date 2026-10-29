export const RETURN_REASON_LABELS = new Map<string, string>([
  ['change_of_mind', '단순 변심'],
  ['defective', '상품 하자'],
  ['not_as_described', '상품 설명과 다름'],
  ['wrong_item', '오배송'],
  ['damaged_in_shipping', '배송 중 파손'],
  ['other', '기타'],
]);

export const SELLER_BORNE_REASONS = new Set([
  'defective',
  'not_as_described',
  'wrong_item',
  'damaged_in_shipping',
]);
