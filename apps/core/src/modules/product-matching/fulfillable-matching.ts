/**
 * «FO 를 만들 수 있는 매칭» 판정. FO 생성과 리컨실러 12번 규칙이 같이 쓴다 — 규칙이 자기 판정을 따로 가지면
 * 워커와 엇갈려 헛돌다 포기만 쌓인다(스펙 2026-10-08-order-reconciler-design §4.4-2).
 * matched + variant + 링크 0개는 쓸 수 없다(숨은 미매칭, 스펙 §1.2).
 */
export type MatchingForFulfillment =
  | { status: string; strategy: string | null; links?: ReadonlyArray<{ skuId: string; quantity: number }> }
  | null
  | undefined;

export function isVoidMatching(matching: MatchingForFulfillment): boolean {
  return matching?.status === 'matched' && matching.strategy === 'void';
}

export function physicalSkuLinks(matching: MatchingForFulfillment): Array<{ skuId: string; quantity: number }> {
  if (matching?.status !== 'matched' || matching.strategy !== 'variant') return [];
  return Array.isArray(matching.links) ? matching.links.map((l) => ({ skuId: l.skuId, quantity: l.quantity })) : [];
}

export function isFulfillableMatching(matching: MatchingForFulfillment): boolean {
  return isVoidMatching(matching) || physicalSkuLinks(matching).length > 0;
}
