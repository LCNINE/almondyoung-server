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
import { cn } from "@lib/utils"
import { UseFormReturn } from "react-hook-form"
import { Info } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { PhoneVerificationField } from "./phone-verification-field"

type SignupMode = "default" | "cafe24"

type FieldConfig = {
  name:
    | "loginId"
    | "email"
    | "username"
    | "birthday"
    | "nickname"
    | "password"
    | "passwordConfirm"
    | "phoneNumber"
  placeholder: string
  type: string
  autoFocus?: boolean
  description?: string
}

type FormSection = {
  title: string
  type: "fields" | "phone"
  fields: FieldConfig[]
}

interface SignupFormFieldsProps {
  form: UseFormReturn<SignupSchema>
  mode: SignupMode
  prefillAvailable: boolean
  hasIncompletePrefill: boolean
}

const DEFAULT_FORM_SECTIONS: FormSection[] = [
  {
    title: "계정 정보",
    type: "fields",
    fields: [
      {
        name: "loginId",
        placeholder: "아이디",
        type: "text",
        autoFocus: true,
        description: "영문, 숫자 조합 6자 이상",
      },
      {
        name: "email",
        placeholder: "이메일",
        type: "email",
        description: "비밀번호 찾기 시 사용됩니다",
        autoFocus: false,
      },
    ],
  },
  {
    title: "개인 정보",
    type: "fields",
    fields: [
      {
        name: "username",
        placeholder: "이름",
        type: "text",
        autoFocus: false,
      },
      {
        name: "birthday",
        placeholder: "생년월일",
        type: "text",
        description: "YYYYMMDD 형식 (예: 19900101)",
        autoFocus: false,
      },
      {
        name: "nickname",
        placeholder: "닉네임",
        type: "text",
        description: "다른 사용자에게 표시됩니다",
        autoFocus: false,
      },
    ],
  },
  {
    title: "휴대폰 인증",
    type: "phone",
    fields: [],
  },
  {
    title: "비밀번호 설정",
    type: "fields",
    fields: [
      {
        name: "password",
        placeholder: "비밀번호",
        type: "password",
        description: "영문, 숫자, 특수문자 포함 8자 이상",
        autoFocus: false,
      },
      {
        name: "passwordConfirm",
        placeholder: "비밀번호 확인",
        type: "password",
        autoFocus: false,
      },
    ],
  },
]

const CAFE24_FORM_SECTIONS: FormSection[] = [
  {
    title: "계정 정보",
    type: "fields",
    fields: [
      {
        name: "loginId",
        placeholder: "아이디",
        type: "text",
        autoFocus: true,
        description: "영문, 숫자 조합 6자 이상",
      },
      {
        name: "nickname",
        placeholder: "닉네임",
        type: "text",
        description: "다른 사용자에게 표시됩니다",
        autoFocus: false,
      },
    ],
  },
  {
    title: "비밀번호 설정",
    type: "fields",
    fields: [
      {
        name: "password",
        placeholder: "비밀번호",
        type: "password",
        description: "영문, 숫자, 특수문자 포함 8자 이상",
        autoFocus: false,
      },
      {
        name: "passwordConfirm",
        placeholder: "비밀번호 확인",
        type: "password",
        autoFocus: false,
      },
    ],
  },
]

const CAFE24_HIDDEN_FIELDS: FieldConfig[] = [
  {
    name: "email",
    placeholder: "이메일",
    type: "email",
    description: "비밀번호 찾기 시 사용됩니다",
  },
  {
    name: "username",
    placeholder: "이름",
    type: "text",
  },
  {
    name: "birthday",
    placeholder: "생년월일",
    type: "text",
    description: "YYYYMMDD 형식 (예: 19900101)",
  },
  {
    name: "phoneNumber",
    placeholder: "휴대폰 번호",
    type: "text",
    description: "연동 가입에서는 휴대폰 인증이 면제됩니다",
  },
]

const renderInputField = (
  form: UseFormReturn<SignupSchema>,
  fieldConfig: FieldConfig
) => (
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
        {fieldConfig.description && !form.formState.errors[fieldConfig.name] && (
          <FormDescription className="flex items-start gap-1.5 text-xs">
            <Info className="text-muted-foreground mt-0.5 h-3 w-3 shrink-0" />
            <span>{fieldConfig.description}</span>
          </FormDescription>
        )}
        <FormMessage />
      </FormItem>
    )}
  />
)

export function SignupFormFields({
  form,
  mode,
  prefillAvailable,
  hasIncompletePrefill,
}: SignupFormFieldsProps) {
  const isCafe24Mode = mode === "cafe24"
  const [showPrefillEditor, setShowPrefillEditor] = useState(
    !prefillAvailable || hasIncompletePrefill
  )

  const formSections = useMemo(
    () => (isCafe24Mode ? CAFE24_FORM_SECTIONS : DEFAULT_FORM_SECTIONS),
    [isCafe24Mode]
  )

  useEffect(() => {
    if (!isCafe24Mode) return
    setShowPrefillEditor(!prefillAvailable || hasIncompletePrefill)
  }, [isCafe24Mode, prefillAvailable, hasIncompletePrefill])

  return (
    <div className="space-y-8">
      {isCafe24Mode && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-zinc-800">
                기존 아몬드영 계정 정보를 불러왔어요
              </p>
              <p className="text-xs text-zinc-500">
                이메일, 이름, 생년월일, 휴대폰 번호는 숨김 상태로 유지됩니다.
              </p>
            </div>
            <button
              type="button"
              className="text-xs font-medium text-zinc-700 underline underline-offset-4"
              onClick={() => setShowPrefillEditor((prev) => !prev)}
            >
              {showPrefillEditor ? "수정 닫기" : "정보 수정"}
            </button>
          </div>
        </div>
      )}

      {formSections.map((section, sectionIndex) => (
        <div key={section.title} className="space-y-4">
          {/* 섹션 제목 */}
          <div className="flex items-center gap-2">
            <div className="bg-yellow-30 text-primary-foreground flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold">
              {sectionIndex + 1}
            </div>
            <h3 className="text-foreground text-sm font-semibold">
              {section.title}
            </h3>
          </div>

          {/* 섹션 필드들 */}
          <div className="space-y-4 pl-8">
            {section.type === "phone" ? (
              <PhoneVerificationField form={form} />
            ) : (
              section.fields.map((fieldConfig) => renderInputField(form, fieldConfig))
            )}
          </div>
        </div>
      ))}

      {isCafe24Mode && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="bg-yellow-30 text-primary-foreground flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold">
              {formSections.length + 1}
            </div>
            <h3 className="text-foreground text-sm font-semibold">
              기존 아몬드영 정보
            </h3>
          </div>

          <div className="pl-8">
            {!showPrefillEditor ? (
              <p className="text-xs text-zinc-500">
                현재 불러온 정보로 진행합니다. 필요하면 펼쳐서 수정할 수 있습니다.
              </p>
            ) : (
              <div
                className={cn(
                  "space-y-4 rounded-lg border border-dashed border-zinc-200 p-4"
                )}
              >
                {CAFE24_HIDDEN_FIELDS.map((fieldConfig) =>
                  renderInputField(form, fieldConfig)
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
