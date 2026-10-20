/**
 * 관리자 응답에서 가리는 개인정보의 종류. 형식은 `mask.ts` 한 곳이 정한다 —
 * 화면마다 다르게 가리면 여러 화면을 맞춰 원본이 복원되므로 규칙은 하나만 둔다.
 *
 * `redact` 는 행마다 모양이 다른 객체(변경 기록·원본 주문 JSON 등)를 통째로 null 로 바꾼다.
 */
export const PII_KINDS = ['name', 'phone', 'email', 'address', 'postal', 'account', 'secret', 'text', 'redact'] as const;

export type PiiKind = (typeof PII_KINDS)[number];

export type MaskableKind = Exclude<PiiKind, 'redact'>;

/** 응답 경로. `.` 으로 키를 잇고 배열은 `[]` — 맨 앞 `[]` 는 응답 자체가 배열이라는 뜻이다. */
export type PiiPath = string;
