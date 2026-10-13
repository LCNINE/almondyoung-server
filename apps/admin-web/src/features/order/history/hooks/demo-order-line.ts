export function isOrderLineMatched(
  line: { matchingResolved?: boolean | null; variantId?: string | null },
  stage: string | undefined
): boolean {
  // core 가 라인 구성 판정으로 내려준 값을 본다(#1063). 옛 productMatchingId 는 더 쓰이지 않는다.
  // Demo orders already select a catalog variant and do not need a legacy channel matching record.
  return !!line.matchingResolved || (stage === 'demo' && !!line.variantId);
}
