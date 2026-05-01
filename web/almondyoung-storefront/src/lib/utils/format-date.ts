import { format, isValid, parseISO } from "date-fns"
import { ko } from "date-fns/locale"

export type DateInput = string | number | Date | null | undefined

/** 자주 쓰는 날짜 포맷 프리셋 (date-fns 토큰) */
export const DATE_FORMATS = {
  /** 2024년 6월 14일 */
  KO_LONG: "yyyy년 M월 d일",
  /** 2024.06.14 */
  KO_DOT: "yyyy.MM.dd",
  /** 2024-06-14 */
  ISO_DATE: "yyyy-MM-dd",
  /** 2024.06.14 14:30 */
  KO_DOT_TIME: "yyyy.MM.dd HH:mm",
  /** 2024년 6월 14일 (금) */
  KO_LONG_WEEKDAY: "yyyy년 M월 d일 (E)",
} as const

export type DateFormatPreset = (typeof DATE_FORMATS)[keyof typeof DATE_FORMATS]

function toDate(input: DateInput): Date | null {
  if (input === null || input === undefined || input === "") return null
  if (input instanceof Date) return isValid(input) ? input : null
  if (typeof input === "number") {
    const d = new Date(input)
    return isValid(d) ? d : null
  }
  const parsed = parseISO(input)
  if (isValid(parsed)) return parsed
  const fallback = new Date(input)
  return isValid(fallback) ? fallback : null
}

/**
 * 날짜를 한국 로케일 문자열로 포맷합니다.
 * @param input ISO 문자열, 타임스탬프, Date, null/undefined
 * @param pattern date-fns 포맷 토큰 (기본: "yyyy년 M월 d일")
 * @param fallback 유효하지 않을 때 반환값 (기본: "-")
 */
export function formatDate(
  input: DateInput,
  pattern: string = DATE_FORMATS.KO_LONG,
  fallback: string = "-"
): string {
  const date = toDate(input)
  if (!date) return fallback
  return format(date, pattern, { locale: ko })
}
