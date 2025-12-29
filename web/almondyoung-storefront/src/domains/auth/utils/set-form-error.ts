import { UseFormReturn } from "react-hook-form"
import { SignupSchema } from "../schemas/signup-schema"

type FieldName = keyof SignupSchema

interface ErrorMapping {
  keyword: string
  field: FieldName
}

const ERROR_MAPPINGS: ErrorMapping[] = [
  { keyword: "이미 가입된 아이디입니다", field: "loginId" },
  { keyword: "이미 가입된 이메일입니다", field: "email" },
  { keyword: "이미 가입된 닉네임입니다", field: "nickname" },
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
