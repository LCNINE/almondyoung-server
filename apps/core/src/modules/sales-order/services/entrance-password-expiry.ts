/** 비번 보관 상한. 배송 완료 시 즉시 파기가 1차이고, 이건 미배송 잔류분을 위한 백스톱이다. */
export const ENTRANCE_PASSWORD_TTL_DAYS = 14;

const TTL_MS = ENTRANCE_PASSWORD_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * 공동현관 비번 만료 시각 = 주문일 + TTL. Medusa 쪽 통과점 파기 시각과 맞춘 값이다.
 *
 * `orderDate` 는 임의 타임존을 포함한 ISO 문자열일 수 있다 — `Date` 파싱은 내부적으로
 * epoch ms 로 정규화하므로 입력 타임존과 무관하게 UTC 기준 계산 결과가 일관된다.
 */
export function computeEntrancePasswordExpiry(orderDate: string): Date {
  return new Date(new Date(orderDate).getTime() + TTL_MS);
}
