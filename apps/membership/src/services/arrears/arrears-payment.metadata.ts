/**
 * 미수 청산 결제를 가입 결제와 가르는 표식.
 *
 * `metadata.type` 은 가입 결제와 **같은 `MEMBERSHIP_FEE` 를 쓴다** — 미수는 못 받은 멤버십
 * 요금 그 자체라, 포인트 사용 불가·무통장 전용·환불 차단 같은 wallet 의 멤버십 결제 정책이
 * 그대로 걸려야 한다. 새 type 을 만들면 그 정책들이 조용히 안 걸린다.
 *
 * 대신 이 한 칸으로 갈라, 가입 확정 컨슈머가 미수 결제를 구독 생성으로 오인하지 않게 한다.
 * 리터럴을 흩뿌리면 한쪽만 고쳐져 갈리므로 판정은 이 파일의 함수만 쓴다.
 */
export const MEMBERSHIP_PAYMENT_KIND_FIELD = 'membershipPaymentKind';
export const MEMBERSHIP_PAYMENT_KIND_ARREARS = 'ARREARS';

/** 이 결제가 미수 청산인가. metadata 가 없거나 모양이 다르면 아니다. */
export function isArrearsPayment(metadata: Record<string, unknown> | null | undefined): boolean {
  return metadata?.[MEMBERSHIP_PAYMENT_KIND_FIELD] === MEMBERSHIP_PAYMENT_KIND_ARREARS;
}

/** intent metadata 에 실린 미수 원장 id 목록. 모양이 깨졌으면 빈 배열(= 청산 안 함). */
export function arrearsIdsFromMetadata(metadata: Record<string, unknown> | null | undefined): string[] {
  const raw = metadata?.arrearsIds;
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === 'string' && id.length > 0);
}
