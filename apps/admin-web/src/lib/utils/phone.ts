/**
 * 휴대전화 번호 표시용 포맷터.
 *
 * DB에는 E.164 형식(`+821012345678`)으로 저장된다.
 * 한국 번호(`+82`)만 국내 표기(`010-1234-5678`)로 변환하고,
 * 그 외 국가 번호는 식별 가능하도록 E.164 그대로 노출한다.
 */
export function formatPhoneNumber(raw: string | null | undefined): string {
  if (!raw) return '';
  const value = raw.trim();

  // 한국(+82): 국가코드를 떼고 leading 0을 복원해 국내 번호로 변환한다.
  if (value.startsWith('+82')) {
    const national = '0' + value.slice(3).replace(/\D/g, '');
    return formatKoreanLocal(national);
  }

  // 그 외 국가 번호는 그대로(국가코드 노출).
  return value;
}

function formatKoreanLocal(national: string): string {
  const digits = national.replace(/\D/g, '');

  // 휴대폰 11자리 (010 등): 3-4-4
  if (/^01\d{9}$/.test(digits)) {
    return digits.replace(/^(\d{3})(\d{4})(\d{4})$/, '$1-$2-$3');
  }
  // 휴대폰 구형 10자리 (011/016~019): 3-3-4
  if (/^01\d{8}$/.test(digits)) {
    return digits.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');
  }
  // 서울 지역번호(02) 10자리: 2-4-4
  if (/^02\d{8}$/.test(digits)) {
    return digits.replace(/^(\d{2})(\d{4})(\d{4})$/, '$1-$2-$3');
  }
  // 서울 지역번호(02) 9자리: 2-3-4
  if (/^02\d{7}$/.test(digits)) {
    return digits.replace(/^(\d{2})(\d{3})(\d{4})$/, '$1-$2-$3');
  }
  // 그 외 지역번호(0XX) 10자리: 3-3-4
  if (/^0\d{9}$/.test(digits)) {
    return digits.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');
  }

  // 알 수 없는 패턴이면 변환한 국내 번호를 그대로 반환한다.
  return national;
}
