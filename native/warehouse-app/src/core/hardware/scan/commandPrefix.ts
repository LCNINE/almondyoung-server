/**
 * 명령 바코드의 접두어(스테이션 UI 스펙 §5.3). `%` 로 시작하는 스캔은 전부 명령이다 — 상품(숫자)·송장(숫자)·
 * 위치(`B-05-03` 꼴) 바코드는 `%` 로 시작하지 않는다. 스캔 버스가 이것으로 명령을 일반 구독자에게서 떼어 낸다.
 * 형식의 나머지(어떤 명령인지)는 `src/station/commandCode.ts` 가 안다.
 */
export const COMMAND_PREFIX = '%';

export function isCommandCode(code: string): boolean {
  return code.startsWith(COMMAND_PREFIX);
}
