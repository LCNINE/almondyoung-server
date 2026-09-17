/** Reject malformed direct links instead of silently widening their stock scope. */
export function validatePutawaySearch(search: Record<string, unknown>): {
  skuId?: string;
  originLocationId?: string;
} {
  const result: { skuId?: string; originLocationId?: string } = {};
  for (const key of ['skuId', 'originLocationId'] as const) {
    if (search[key] === undefined) continue;
    const value =
      typeof search[key] === 'string' ? search[key].trim().toLowerCase() : '';
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        value
      )
    )
      throw new Error(
        '적치 링크를 확인할 수 없어요. 이동 화면에서 다시 선택해 주세요.'
      );
    result[key] = value;
  }
  return result;
}
