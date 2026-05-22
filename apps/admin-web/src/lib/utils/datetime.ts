/**
 * <input type="datetime-local"> 의 값(`YYYY-MM-DDTHH:mm`, 초·타임존 없음)을
 * 완전한 ISO 8601 문자열로 변환한다. 백엔드 @IsISO8601() 검증이 datetime-local
 * 원본 문자열을 거부하므로 전송 직전에 변환해야 한다.
 * 빈 값/유효하지 않은 값은 undefined.
 */
export function localInputToIso(value?: string | null): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
