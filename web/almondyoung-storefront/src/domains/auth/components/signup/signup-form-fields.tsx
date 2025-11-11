"use client"

import { SignupSchema } from "domains/auth/schemas/signup-schema"
import { CustomInput } from "@components/common/inputs/custom-input"
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@components/common/ui/form"
import { UseFormReturn } from "react-hook-form"

interface SignupFormFieldsProps {
  form: UseFormReturn<SignupSchema>
}

// 각 필드의 설정을 정의
const FORM_FIELDS = [
  {
    name: "loginId" as const,
    placeholder: "아이디",
    type: "text",
    autoFocus: true,
  },
  {
    name: "email" as const,
    placeholder: "이메일",
    type: "email",
  },
  {
    name: "username" as const,
    placeholder: "이름",
    type: "text",
  },
  {
    name: "nickname" as const,
    placeholder: "닉네임",
    type: "text",
  },
  {
    name: "password" as const,
    placeholder: "비밀번호",
    type: "password",
  },
  {
    name: "passwordConfirm" as const,
    placeholder: "비밀번호 확인",
    type: "password",
  },
]

export function SignupFormFields({ form }: SignupFormFieldsProps) {
  return (
    <>
      {FORM_FIELDS.map((fieldConfig) => (
        <FormField
          key={fieldConfig.name}
          control={form.control}
          name={fieldConfig.name}
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <CustomInput
                  type={fieldConfig.type}
                  placeholder={fieldConfig.placeholder}
                  onClear={() => form.setValue(fieldConfig.name, "")}
                  hasValue={!!form.getValues(fieldConfig.name)}
                  error={!!form.formState.errors[fieldConfig.name]}
                  autoFocus={fieldConfig.autoFocus}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      ))}
    </>
  )
}
