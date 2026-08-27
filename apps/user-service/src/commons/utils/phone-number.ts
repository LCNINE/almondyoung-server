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

/**
 * 국내 휴대폰 번호인지. 인증문자 발송 전 형식 검증에 쓴다.
 *
 * 예전엔 Twilio Lookup API 를 왕복해 검증했는데, 그건 번호를 E.164 로 바꿔주는 게 주 목적이었다.
 * 발송을 국내망(NHN)으로 옮기면서 필요한 표기가 로컬(`01012345678`)로 뒤집혔고, 그러자 Lookup 은
 * 건당 과금하며 왕복 한 번 더 하는 값을 못 하게 됐다. 존재하지 않는 번호는 발송 API 가 걸러준다.
 */
export function isKoreanMobileNumber(value: string): boolean {
  return /^01[016789]\d{7,8}$/.test(phoneNumberDigits(value));
}

/** DB 조회용 — 저장값에서 숫자만 남겼을 때 매칭될 후보들. ['01012345678', '821012345678'] */
export function phoneNumberDigitVariants(value: string): string[] {
  const local = phoneNumberDigits(value);
  const international = local.startsWith('0') ? `82${local.slice(1)}` : local;
  return [...new Set([local, international])];
}
