"use client"

import { SignupSchema } from "domains/auth/schemas/signup-schema"
import { CustomInput } from "@/components/shared/inputs/custom-input"
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
  FormDescription,
} from "@/components/ui/form"
import { UseFormReturn } from "react-hook-form"
import { Info } from "lucide-react"

interface SignupFormFieldsProps {
  form: UseFormReturn<SignupSchema>
}

// 섹션별로 필드를 그룹화
const FORM_SECTIONS = [
  {
    title: "계정 정보",
    fields: [
      {
        name: "loginId" as const,
        placeholder: "아이디",
        type: "text",
        autoFocus: true,
        description: "영문, 숫자 조합 6자 이상",
      },
      {
        name: "email" as const,
        placeholder: "이메일",
        type: "email",
        description: "비밀번호 찾기 시 사용됩니다",
        autoFocus: false,
      },
    ],
  },
  {
    title: "개인 정보",
    fields: [
      {
        name: "username" as const,
        placeholder: "이름",
        type: "text",
        autoFocus: false,
      },
      {
        name: "birthday" as const,
        placeholder: "생년월일",
        type: "text",
        description: "YYYYMMDD 형식 (예: 19900101)",
        autoFocus: false,
      },
      {
        name: "nickname" as const,
        placeholder: "닉네임",
        type: "text",
        description: "다른 사용자에게 표시됩니다",
        autoFocus: false,
      },
    ],
  },
  {
    title: "비밀번호 설정",
    fields: [
      {
        name: "password" as const,
        placeholder: "비밀번호",
        type: "password",
        description: "영문, 숫자, 특수문자 포함 8자 이상",
        autoFocus: false,
      },
      {
        name: "passwordConfirm" as const,
        placeholder: "비밀번호 확인",
        type: "password",
        autoFocus: false,
      },
    ],
  },
]

export function SignupFormFields({ form }: SignupFormFieldsProps) {
  return (
    <div className="space-y-8">
      {FORM_SECTIONS.map((section, sectionIndex) => (
        <div key={section.title} className="space-y-4">
          {/* 섹션 제목 */}
          <div className="flex items-center gap-2">
            <div className="bg-primary text-primary-foreground flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold">
              {sectionIndex + 1}
            </div>
            <h3 className="text-foreground text-sm font-semibold">
              {section.title}
            </h3>
          </div>

          {/* 섹션 필드들 */}
          <div className="space-y-4 pl-8">
            {section.fields.map((fieldConfig) => (
              <FormField
                key={fieldConfig.name}
                control={form.control}
                name={fieldConfig.name}
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <CustomInput
                        label={fieldConfig.placeholder}
                        type={fieldConfig.type}
                        onClear={() => form.setValue(fieldConfig.name, "")}
                        hasValue={!!field.value}
                        error={!!form.formState.errors[fieldConfig.name]}
                        autoFocus={fieldConfig.autoFocus}
                        {...field}
                      />
                    </FormControl>
                    {fieldConfig.description &&
                      !form.formState.errors[fieldConfig.name] && (
                        <FormDescription className="flex items-start gap-1.5 text-xs">
                          <Info className="text-muted-foreground mt-0.5 h-3 w-3 shrink-0" />
                          <span>{fieldConfig.description}</span>
                        </FormDescription>
                      )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
