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
  if (!accountNumber || accountNumber.length < 4) return accountNumber
  return `****-****-${accountNumber.slice(-4)}`
}

/**
 * PIN 보안 정책 유틸리티
 *
 * 취약한 PIN 패턴을 감지합니다.
 */
export class PinPolicyUtil {
  /**
   * PIN이 보안 정책을 만족하는지 검증합니다.
   * @param pin 6자리 숫자 PIN
   * @returns 정책 위반 시 false
   */
  static isValid(pin: string): boolean {
    // 1. 숫자만 허용 및 6자리 확인
    if (!/^\d{6}$/.test(pin)) {
      return false
    }

    // 2. 동일 숫자 반복 체크 (예: 111111, 000000)
    if (this.isRepetitive(pin)) {
      return false
    }

    // 3. 연속된 숫자 체크 (예: 123456, 987654)
    if (this.isSequential(pin)) {
      return false
    }

    return true
  }

  /**
   * 동일 숫자 반복 여부 확인
   */
  private static isRepetitive(pin: string): boolean {
    const firstDigit = pin[0]
    return pin.split("").every((digit) => digit === firstDigit)
  }

  /**
   * 연속된 숫자 여부 확인 (오름차순/내림차순)
   */
  private static isSequential(pin: string): boolean {
    const ascending = "01234567890"
    const descending = "09876543210"

    return ascending.includes(pin) || descending.includes(pin)
  }
}
