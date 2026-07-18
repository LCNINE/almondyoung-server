/** draft 버전 편집을 이어가는 상세 화면 경로. active 버전이 없는 draft 는 versionId 로 직접 조회한다. */
export function buildDraftEditPath(masterId: string, versionId: string): string {
  return `/mall/products-list/${masterId}?versionId=${versionId}`;
}
