import { UseFormReturn } from "react-hook-form"
import { SignupSchema } from "../schemas/signup-schema"

type FieldName = keyof SignupSchema

interface ErrorMapping {
  keyword: string
  field: FieldName
}

const ERROR_MAPPINGS: ErrorMapping[] = [
  { keyword: "이미 존재하는 아이디입니다", field: "loginId" },
  { keyword: "이미 가입된 이메일입니다", field: "email" },
  { keyword: "이미 존재하는 닉네임입니다", field: "nickname" },
]

export const setFormError = (
  message: string,
  form: UseFormReturn<SignupSchema>
) => {
  const mapping = ERROR_MAPPINGS.find(({ keyword }) =>
    message.includes(keyword)
  )

  if (mapping) {
    form.setError(mapping.field, { message })
  }
}

const SOCIAL_ERROR_MESSAGES: Array<{ include: string; text: string }> = [
  {
    include: "userId is required",
    text: "로그인 정보를 불러오지 못했습니다. 다시 시도해주세요.",
  },
  {
    include: "Invalid callback",
    text: "잘못된 접근입니다. 다시 로그인해주세요.",
  },
  { include: "not found", text: "등록되지 않은 사용자입니다." },
  {
    include: "Authentication failed",
    text: "인증에 실패했습니다. 다시 시도해주세요.",
  },
  {
    include: "exists",
    text: "동일한 이메일로 가입된 계정이 존재합니다. 기존 계정으로 로그인 후 소셜 계정을 연동해 주세요.",
  },
]

export function getSocialErrorMessage(message: string): string {
  const decoded = decodeURIComponent(message)
  const matched = SOCIAL_ERROR_MESSAGES.find(({ include }) =>
    decoded.includes(include)
  )
  return matched?.text ?? decoded ?? "로그인 중 오류가 발생했습니다."
}
