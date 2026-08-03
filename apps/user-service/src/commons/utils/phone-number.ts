/**
 * profiles.phoneNumber 에는 표기가 섞여 있다 — E.164('+821012345678'), 하이픈 로컬
 * ('010-1234-5678'), 숫자 로컬('01012345678'). 호출부는 항상 E.164 로 보내므로 문자열
 * 정확 비교를 하면 옛 표기로 저장된 계정은 아이디/비밀번호 찾기가 영구히 실패한다.
 * 비교는 숫자만 남긴 형태로 한다.
 */

/** 숫자만 남기고 국가번호를 떼어 로컬 표기로 통일한다. '010-1234-5678'·'+821012345678' → '01012345678' */
export function phoneNumberDigits(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.startsWith('82') ? `0${digits.slice(2)}` : digits;
}

/** 두 전화번호가 표기만 다른 같은 번호인지. */
export function isSamePhoneNumber(a: string, b: string): boolean {
  const digits = phoneNumberDigits(a);
  return digits.length > 0 && digits === phoneNumberDigits(b);
}

/** DB 조회용 — 저장값에서 숫자만 남겼을 때 매칭될 후보들. ['01012345678', '821012345678'] */
export function phoneNumberDigitVariants(value: string): string[] {
  const local = phoneNumberDigits(value);
  const international = local.startsWith('0') ? `82${local.slice(1)}` : local;
  return [...new Set([local, international])];
}
