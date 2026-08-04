/**
 * 시스템이 양식 프리필에 발급하는 상품키 형식.
 *
 * `form-export.snapshot.reader.ts:128` 이 `P-${seq.padStart(6,'0')}` 로 만든다. 이 형식을
 * **예약**으로 두는 이유는 두 가지다.
 *
 * (1) 워크북의 숨은 `_양식정보` 시트를 잃으면 `exportId` 가 사라지고, 업로드가 그 파일을
 *     "신규 전용 세션"으로 읽어 프리필 행 전량을 신규 상품으로 재생성한다
 *     (스펙 2026-08-04-product-bulk-form-md-skill-design §2.2). 예약 형식을 알면 그 사고를
 *     파일 수준에서 잡을 수 있다.
 * (2) 시스템 발급 키와 사람이 지은 키가 같은 공간을 쓰면 반드시 혼동이 생긴다. 빈 양식에서
 *     작업자가 `P-000001` 을 짓는 것도 함께 막는 것이 의도한 동작이다.
 */
const RESERVED_ROW_KEY_RE = /^P-\d{6}$/;

export function isReservedRowKey(rowKey: string): boolean {
  return RESERVED_ROW_KEY_RE.test(rowKey.trim());
}

/** `exportId` 가 없는 워크북에 예약 키가 있을 때 — 파일 전체를 거부한다. */
export const RESERVED_ROW_KEY_WITHOUT_EXPORT_MESSAGE =
  '수정용 양식인데 양식 정보가 사라졌습니다. 시트를 복사하거나 다른 프로그램으로 다시 저장하면 사라집니다. ' +
  '상품 목록에서 양식을 다시 받아 작성해 주세요. ' +
  '새 상품만 등록하려는 것이라면 상품키를 P-000001 형식이 아닌 다른 값으로 지어 주세요.';

/** `exportId` 는 해석됐는데 그 예약 키가 매핑에 없을 때 — 그 행만 오류로 떨군다. */
export function reservedRowKeyUnresolvedMessage(rowKey: string): string {
  return (
    `상품키 ${rowKey} 는 이 양식에 없는 시스템 발급 키입니다. ` +
    '다른 양식의 행을 섞지 않았는지 확인해 주세요. ' +
    '새 상품이라면 P-000001 형식이 아닌 다른 상품키를 지어 주세요.'
  );
}
