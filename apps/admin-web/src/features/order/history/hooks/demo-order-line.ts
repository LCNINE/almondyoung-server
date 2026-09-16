export function isOrderLineMatched(
  line: { productMatchingId?: string | null; variantId?: string | null },
  stage: string | undefined
): boolean {
  // Demo orders already select a catalog variant and do not need a legacy channel matching record.
  return !!line.productMatchingId || (stage === 'demo' && !!line.variantId);
}
