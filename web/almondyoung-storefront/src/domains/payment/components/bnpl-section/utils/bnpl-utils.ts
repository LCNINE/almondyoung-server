import type { BnplProfileDto } from "@lib/types/dto/wallet"

/**
 * D-day 계산 함수
 * @param targetDate - 목표 날짜 (YYYY-MM-DD 형식)
 * @returns D-day 숫자 (음수면 지난 날짜)
 */
export function calculateDday(targetDate: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const target = new Date(targetDate)
  target.setHours(0, 0, 0, 0)

  const diffTime = target.getTime() - today.getTime()
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

  return diffDays
}

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
 * 금액을 천 단위 콤마로 포맷팅
 * @param amount - 금액
 * @returns 포맷팅된 금액 (예: "156,000")
 */
export function formatAmount(amount: number): string {
  return amount.toLocaleString("ko-KR")
}

/**
 * BNPL 프로필에서 은행명 추출
 * @param profile - BNPL 프로필
 * @returns 은행명 또는 기본값
 */
export function getBankName(profile: BnplProfileDto): string {
  return profile.details?.paymentCompanyName || "은행"
}

/**
 * BNPL 프로필에서 마스킹된 계좌번호 추출
 * @param profile - BNPL 프로필
 * @returns 마스킹된 계좌번호
 */
export function getMaskedAccountNumber(profile: BnplProfileDto): string {
  return profile.details?.paymentNumber || "****-****-****"
}
