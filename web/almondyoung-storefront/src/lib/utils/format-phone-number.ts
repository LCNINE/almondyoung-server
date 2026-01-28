/** 전화번호 포맷팅 (010-1234-5678 형식) */
export const formatPhoneNumber = (value: string): string => {
  const numbers = value.replace(/\D/g, "")
  if (numbers.length <= 3) return numbers
  if (numbers.length <= 7) return `${numbers.slice(0, 3)}-${numbers.slice(3)}`
  return `${numbers.slice(0, 3)}-${numbers.slice(3, 7)}-${numbers.slice(7, 11)}`
}

/**
 * +82 번호를 010 숫자 형식으로 변환 (하이픈 제거)
 * @param {string} phone - 변환할 전화번호 (예: "+82 10-1234-5678")
 * @returns {string} - 변환된 숫자열 (예: "01012345678")
 */
export const getCleanKoreanNumber = (phone: string) => {
  if (!phone) return ""

  // 숫자가 아닌 모든 문자(+, -, 공백 등) 제거
  let cleaned = phone.replace(/\D/g, "")

  // 82로 시작하면 0으로 교체, 아니면 그대로 반환
  return cleaned.startsWith("82") ? "0" + cleaned.slice(2) : cleaned
}
