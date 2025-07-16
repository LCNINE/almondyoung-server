/**
 * 금액 관련 유틸리티 함수
 * PostgreSQL decimal 타입과 JavaScript number 타입 간의 변환을 처리
 */

/**
 * DB에서 받은 decimal string을 number로 변환
 * @param value DB에서 받은 decimal 값 (string)
 * @returns number 타입의 금액
 */
export function parseDecimal(value: string | number): number {
  if (typeof value === 'number') {
    return value;
  }
  return parseFloat(value);
}

/**
 * JavaScript number를 DB에 저장할 decimal string으로 변환
 * @param value JavaScript number 값
 * @returns DB에 저장할 string 타입의 금액
 */
export function toDecimalString(value: number): string {
  return value.toString();
}

/**
 * 금액 배열을 number로 변환
 * @param amounts DB에서 받은 decimal string 배열
 * @returns number 배열
 */
export function parseDecimalArray(amounts: (string | number)[]): number[] {
  return amounts.map(parseDecimal);
}

/**
 * 금액 합계 계산 (DB decimal string 처리)
 * @param amounts DB에서 받은 decimal string 배열
 * @returns 합계 (number)
 */
export function sumDecimals(amounts: (string | number)[]): number {
  return amounts.reduce((sum, amount) => sum + parseDecimal(amount), 0);
}

/**
 * 금액 포맷팅 (한국 원화)
 * @param amount 금액 (number 또는 string)
 * @returns 포맷된 금액 문자열 (예: "1,000원")
 */
export function formatKRW(amount: string | number): string {
  const numAmount = parseDecimal(amount);
  return `${numAmount.toLocaleString('ko-KR')}원`;
}