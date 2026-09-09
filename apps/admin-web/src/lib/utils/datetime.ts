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

/**
 * ISO 8601(대개 UTC)을 `<input type="datetime-local">` 이 받는 로컬 시각
 * `YYYY-MM-DDTHH:mm` 으로 바꾼다. 그냥 slice(0,16) 하면 UTC 문자열이 그대로
 * 들어가 화면에 시차만큼 어긋난 시각이 보인다.
 */
export function isoToLocalInput(value?: string | Date | null): string {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
