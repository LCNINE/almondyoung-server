import z from "zod"

/**
 * 개업일자가 달력에 실제로 존재하는 과거 날짜인가.
 *
 * 8자리 검사만으로는 83월·1015년·미래 날짜가 통과해 국세청 진위확인에서 떨어지는데,
 * 그 결과가 사용자에게는 그냥 "심사중" 으로만 보여 오타를 영영 못 고친다.
 */
const isRealStartDate = (yyyymmdd: string) => {
  const year = Number(yyyymmdd.slice(0, 4))
  const month = Number(yyyymmdd.slice(4, 6))
  const day = Number(yyyymmdd.slice(6, 8))
  if (year < 1900) return false

  const parsed = new Date(Date.UTC(year, month - 1, day))
  const isRealDate =
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  if (!isRealDate) return false

  // KST 가 UTC 보다 9시간 앞서 "오늘 개업" 이 미래로 보일 수 있다 — 하루 여유를 둔다.
  return parsed.getTime() <= Date.now() + 24 * 60 * 60 * 1000
}

/** 사업자등록번호 체크섬 — 마지막 자리가 앞 9자리로 계산되는 검증숫자다. */
const BUSINESS_NUMBER_WEIGHTS = [1, 3, 7, 1, 3, 7, 1, 3, 5]

const isBusinessNumberChecksumValid = (value: string) => {
  if (!/^\d{10}$/.test(value)) return false

  const digits = value.split("").map(Number)
  let sum = digits
    .slice(0, 9)
    .reduce((acc, d, i) => acc + d * BUSINESS_NUMBER_WEIGHTS[i], 0)
  sum += Math.floor((digits[8] * 5) / 10)

  return (10 - (sum % 10)) % 10 === digits[9]
}

export const buildBusinessDtoSchema = (messages: {
  businessNumberRequired: string
  representativeNameRequired: string
  startDateRequired: string
  startDateInvalid: string
  startDateNotReal: string
  businessNumberInvalid: string
}) =>
  z
    .object({
      businessNumber: z.string(),
      representativeName: z.string(),
      // 개업일자(YYYYMMDD). 국세청 진위확인에 사업자번호·대표자명과 함께 반드시 필요하다.
      startDate: z.string(),
      fileUrl: z.string().url().optional(),
      file: z.instanceof(File).optional(),
    })
    .superRefine((data, ctx) => {
      // 파일 첨부 모드면 번호/대표자명/개업일자는 필요 없다.
      if (data.file || data.fileUrl) return

      const businessNumber = data.businessNumber?.replace(/\D/g, "") ?? ""
      if (businessNumber.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: messages.businessNumberRequired,
          path: ["businessNumber"],
        })
      } else if (!isBusinessNumberChecksumValid(businessNumber)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: messages.businessNumberInvalid,
          path: ["businessNumber"],
        })
      }
      if (!data.representativeName || data.representativeName.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: messages.representativeNameRequired,
          path: ["representativeName"],
        })
      }

      const startDate = data.startDate?.replace(/\D/g, "") ?? ""
      if (startDate.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: messages.startDateRequired,
          path: ["startDate"],
        })
      } else if (!/^\d{8}$/.test(startDate)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: messages.startDateInvalid,
          path: ["startDate"],
        })
      } else if (!isRealStartDate(startDate)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: messages.startDateNotReal,
          path: ["startDate"],
        })
      }
    })

export type BusinessDtoSchema = z.infer<
  ReturnType<typeof buildBusinessDtoSchema>
>
