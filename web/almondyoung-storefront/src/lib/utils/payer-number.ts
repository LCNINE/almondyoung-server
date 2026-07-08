// CMS 자동이체 회원등록의 payerNumber(개인 생년월일 6자리 또는 사업자번호 10자리)
// 형식 검증. 효성의 D+1 실명대사에서 Q201(생년월일/사업자번호 불일치)로 실패하기 전에,
// 제출 단계에서 잡을 수 있는 오타성 오류를 사전 차단한다.
// wallet 서비스(apps/wallet/src/cms/payer-number.ts)와 동일한 규칙을 미러링한다.

const BUSINESS_NUMBER_WEIGHTS = [1, 3, 7, 1, 3, 7, 1, 3, 5]

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** 국세청 표준 사업자등록번호 체크섬. 오타성 10자리 입력을 차단한다. */
export function isValidBusinessRegistrationNumber(value: string): boolean {
  if (!/^\d{10}$/.test(value)) return false

  const digits = value.split("").map(Number)
  let sum = 0
  for (let i = 0; i < 9; i++) {
    sum += digits[i] * BUSINESS_NUMBER_WEIGHTS[i]
  }
  sum += Math.floor((digits[8] * 5) / 10)

  const checkDigit = (10 - (sum % 10)) % 10
  return checkDigit === digits[9]
}

/**
 * 생년월일 YYMMDD 형식·범위 검증. 세기를 알 수 없어 윤년은 판별하지 못하므로
 * 2월은 29일까지 허용한다. "형식은 맞고 값만 다른" 케이스는 못 잡는다.
 */
export function isValidBirthDateYYMMDD(value: string): boolean {
  if (!/^\d{6}$/.test(value)) return false

  const month = Number(value.slice(2, 4))
  const day = Number(value.slice(4, 6))
  if (month < 1 || month > 12) return false
  if (day < 1 || day > DAYS_IN_MONTH[month - 1]) return false
  return true
}

/** payerNumber(6자리 생년월일 또는 10자리 사업자번호) 형식 검증. */
export function isValidPayerNumber(value: string): boolean {
  const normalized = value.replace(/\D/g, "")
  if (/^\d{6}$/.test(normalized)) return isValidBirthDateYYMMDD(normalized)
  if (/^\d{10}$/.test(normalized))
    return isValidBusinessRegistrationNumber(normalized)
  return false
}
