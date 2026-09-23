/**
 * 가입 화면이 보여 주는 약관(`components/terms-and-conditions.tsx`)의 버전.
 * 동의 기록에 이 값이 남는다. 약관 파일을 고치면 이 값과 멤버십 서버의 버전 목록
 * (`apps/membership/src/services/terms/membership-terms.ts`)을 같이 올려야 한다 —
 * 서버 쪽 가드 스펙이 둘이 같은지와 본문 해시를 검사한다.
 */
export const MEMBERSHIP_TERMS_VERSION = "2026-09-23"
