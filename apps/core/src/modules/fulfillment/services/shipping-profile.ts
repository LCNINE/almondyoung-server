/**
 * 박스의 배송 프로필 — 담긴 SKU 가 모두 같은 프로필이면 그 값, 섞이거나 하나라도 없으면 NULL(확정 단계가 막는다).
 * FO 생성과 작성 중 박스 맞추기(DraftBoxAmender)가 같은 규칙을 써야 한다 — 다르면 같은 내용의 박스가 경로에 따라 다른 프로필을 갖는다.
 */
export function compatibleShippingProfileId(deliveryProfileIds: ReadonlyArray<string | null>): string | null {
  if (deliveryProfileIds.length === 0) return null;
  const first = deliveryProfileIds[0];
  if (first === null) return null;
  return deliveryProfileIds.every((id) => id === first) ? first : null;
}
