/**
 * 개인정보 경로를 부르지만 개인정보를 그리지 않는 곳 — `<src 기준 파일> :: <경로 머리>` → 사유.
 * API 계층 파일이면 그 파일에서 그 머리를 개인정보 경로로 보지 않고, 화면 쪽 파일이면 그 파일이 그 머리에서 온 이름을
 * 써도 개인정보를 그리지 않는 것으로 본다. `pii-screens.gate.spec.ts` 가 읽고, 사유 없는 예외·죽은 예외를 막는다. 여러 화면이 같이 쓰는 부품(메뉴 배지 등)에 쓴다.
 */
export const PII_SCREEN_EXCEPTIONS: Readonly<Record<string, string>> = {
  // 현재 없음 — 화면 하나를 통째로 빼는 것은 `PII_SCREEN_NOT_SHOWN` 에 적는다.
};
