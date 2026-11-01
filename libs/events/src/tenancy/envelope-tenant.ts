/** 남이 보낸 값(`unknown`)을 객체로 읽는다 — 배열·원시값·null 은 undefined. `as` 대신 쓰는 한 곳 */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined;
}

/**
 * 봉투의 `metadata.tenantId` 를 `tenantId` 로 둔다 — 있던 값은 덮고 다른 metadata 는 둔다. 실패 행을 다시 흘릴 때만 쓴다
 * (ticket 30): 다시 넣기와 `.dlq` 가져오기는 «이 행이 어느 테넌트의 것인가»를 봉투가 아니라 행이 든 DB(또는 사람)가 정한다.
 */
export function stampEnvelopeTenant(envelope: Record<string, unknown>, tenantId: string): Record<string, unknown> {
  return { ...envelope, metadata: { ...asRecord(envelope.metadata), tenantId } };
}
