const PHONE_PATTERN = /^0\d{8,10}$/

/** 서버(ugc stripPhoneSeparators)와 같이 하이픈·공백만 지운다 */
export function stripPhone(input: string): string {
  return input.replace(/[\s-]/g, "")
}

export function isValidPhone(digits: string): boolean {
  return PHONE_PATTERN.test(digits)
}

/** 숫자만 받은 번호를 보여줄 때 하이픈을 넣는다. 모르는 모양은 그대로 */
export function formatPhone(digits: string): string {
  if (digits.startsWith("02")) {
    if (digits.length === 9) return `02-${digits.slice(2, 5)}-${digits.slice(5)}`
    if (digits.length === 10) return `02-${digits.slice(2, 6)}-${digits.slice(6)}`
    return digits
  }
  if (digits.length === 10)
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11)
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
  return digits
}
