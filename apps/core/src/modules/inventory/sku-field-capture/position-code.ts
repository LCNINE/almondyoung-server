/**
 * 선반 위치 코드 정규화 — 앞뒤 공백 제거 + 대문자화. 적재(스크립트)와 조회(API)가 같은 함수를 쓴다.
 * scripts/ 의 tsx 가 이 파일을 직접 import 하므로 어떤 import 도 두지 않는다.
 */
export function normalizePositionCode(raw: string): string {
  return raw.trim().toUpperCase();
}
