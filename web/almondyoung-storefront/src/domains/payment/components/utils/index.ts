import type { BnplProfileDto } from "@lib/types/dto/wallet"

/**
 * D-day 텍스트 포맷팅
 * @param dday - D-day 숫자
 * @returns 포맷팅된 D-day 텍스트 (예: "D-3", "D-Day", "D+2")
 */
export function formatDday(dday: number): string {
  if (dday === 0) return "D-Day"
  if (dday > 0) return `D-${dday}`
  return `D+${Math.abs(dday)}`
}

/**
 * 날짜를 "M월 D일" 형식으로 포맷팅
 * @param dateString - 날짜 문자열 (YYYY-MM-DD 형식)
 * @returns 포맷팅된 날짜 (예: "6월 7일")
 */
export function formatPaymentDate(dateString: string): string {
  const date = new Date(dateString)
  const month = date.getMonth() + 1
  const day = date.getDate()
  return `${month}월 ${day}일`
}

/**
 * 금액을 한국식 만 단위로 포맷팅 (천 단위로 반올림)
 * @param amount - 금액
 * @returns 포맷팅된 금액 (예: "15만 6천", "100만", "155만 2천")
 */
export function formatAmount(amount: number): string {
  if (amount < 10000) {
    return amount.toLocaleString("ko-KR")
  }

  const man = Math.floor(amount / 10000)
  const remainder = amount % 10000
  const cheon = Math.round(remainder / 1000)

  if (cheon === 0) {
    // 딱 떨어지거나 천 원 미만: "10만", "100만"
    return `${man.toLocaleString("ko-KR")}만`
  }

  if (cheon === 10) {
    // 반올림 결과가 1만이 되는 경우: "16만"
    return `${(man + 1).toLocaleString("ko-KR")}만`
  }

  // 나머지가 있는 경우: "15만 6천", "155만 2천"
  return `${man.toLocaleString("ko-KR")}만 ${cheon}천`
}

/**
 * BNPL 프로필에서 은행명 추출
 * @param profile - BNPL 프로필
 * @returns 은행명 또는 기본값
 */
export function getBankName(profile: BnplProfileDto): string {
  return profile.details?.paymentCompanyName || "은행"
}

// 계좌번호 마스킹
export function maskAccountNumber(accountNumber: string): string {
  if (accountNumber.length <= 8) return accountNumber
  const start = accountNumber.slice(0, 4)
  const end = accountNumber.slice(-2)
  return `${start}-${"*".repeat(accountNumber.length - 6)}-${end}`
}
