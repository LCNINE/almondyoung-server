/**
 * 성장 화면 금액 표기. 억 단위는 소수 둘째 자리까지 쓰되 끝의 0 은 뺀다 — «12.50억원» 대신 «12.5억 원», «8.00억원» 대신 «8억 원».
 * 만 단위 아래는 원 단위 그대로. 화면(메인 카드·성장 탭·설정)이 같은 함수를 써서 같은 금액이 같은 모양으로 보이게 한다.
 */
export function formatWon(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1e8) return `${sign}${Number((abs / 1e8).toFixed(2)).toLocaleString('ko-KR')}억 원`;
  if (abs >= 1e4) return `${sign}${Math.round(abs / 1e4).toLocaleString('ko-KR')}만 원`;
  return `${sign}${Math.round(abs).toLocaleString('ko-KR')}원`;
}

/** 'YYYY-MM-DD' → '9월 30일' */
export function formatMonthDay(day: string): string {
  return `${Number(day.slice(5, 7))}월 ${Number(day.slice(8, 10))}일`;
}
