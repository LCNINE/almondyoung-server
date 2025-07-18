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
 * 금액 합계 계산 (DB decimal string 처리) - number 반환
 * @param amounts DB에서 받은 decimal string 배열
 * @returns 합계 (number)
 */
export function sumDecimals(amounts: (string | number)[]): number {
  let total = 0;
  for (const amount of amounts) {
    total += parseDecimal(amount);
  }
  return total;
}

/**
 * 금액 합계 계산 (string 기반 정밀 계산)
 * @param amounts decimal string 배열
 * @returns 합계 (string) - 정밀도 보장
 */
export function sumDecimalStrings(amounts: (string | number)[]): string {
  let total = 0;
  for (const amount of amounts) {
    const amountNum: number =
      typeof amount === 'string' ? parseFloat(amount) : amount;
    total += amountNum;
  }
  return total.toFixed(4);
}

/**
 * 두 decimal string 덧셈
 * @param a 첫 번째 decimal string
 * @param b 두 번째 decimal string
 * @returns 덧셈 결과 (string)
 */
export function addDecimalStrings(
  a: string | number,
  b: string | number,
): string {
  const aNum = typeof a === 'string' ? parseFloat(a) : a;
  const bNum = typeof b === 'string' ? parseFloat(b) : b;
  return (aNum + bNum).toFixed(4);
}

/**
 * 두 decimal string 뺄셈
 * @param a 첫 번째 decimal string
 * @param b 두 번째 decimal string
 * @returns 뺄셈 결과 (string)
 */
export function subtractDecimalStrings(
  a: string | number,
  b: string | number,
): string {
  const aNum = typeof a === 'string' ? parseFloat(a) : a;
  const bNum = typeof b === 'string' ? parseFloat(b) : b;
  return (aNum - bNum).toFixed(4);
}

/**
 * 금액 포맷팅 (한국 원화)
 * @param amount 금액 (number 또는 string)
 * @returns 포맷된 금액 문자열 (예: "1,000원")
 */
export function formatKRW(amount: number): string {
  const numAmount = parseDecimal(amount);
  return `${numAmount.toLocaleString('ko-KR')}원`;
}
