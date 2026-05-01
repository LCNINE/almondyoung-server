"use client"

import { CustomButton } from "@/components/shared/custom-buttons/custom-button"
import { CustomInput } from "@/components/shared/inputs/custom-input"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  changePasswordAction,
  type PasswordActionState,
} from "../actions/password"
import { useActionState, useCallback, useEffect } from "react"
import { useForm } from "react-hook-form"
import {
  changePasswordSchema,
  type ChangePasswordSchema,
} from "../../schemas/password-schema"

export function PasswordChange() {
  const [state, formAction, isPending] = useActionState<
    PasswordActionState,
    FormData
  >(changePasswordAction, null)

  const form = useForm<ChangePasswordSchema>({
    resolver: zodResolver(changePasswordSchema),
    mode: "onChange",
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      newPasswordConfirm: "",
    },
  })

  const currentPassword = form.watch("currentPassword")
  const newPassword = form.watch("newPassword")
  const newPasswordConfirm = form.watch("newPasswordConfirm")

  // 서버 에러를 react-hook-form에 동기화
  useEffect(() => {
    if (state?.success === false && state?.field) {
      form.setError(state.field, { message: state.error })
    }
  }, [state, form])

  const handleClearCurrent = useCallback(() => {
    form.setValue("currentPassword", "", { shouldValidate: true })
  }, [form])

  const handleClearNew = useCallback(() => {
    form.setValue("newPassword", "", { shouldValidate: true })
  }, [form])

  const handleClearConfirm = useCallback(() => {
    form.setValue("newPasswordConfirm", "", { shouldValidate: true })
  }, [form])

  return (
    <div className="mx-auto w-full max-w-md py-2 md:py-6">
      <p className="text-muted-foreground mb-4 text-sm">
        비밀번호를 변경하려면 현재 비밀번호와 새 비밀번호를 입력해주세요.
      </p>

      <Form {...form}>
        <form action={formAction} className="space-y-4">
          <FormField
            control={form.control}
            name="currentPassword"
            render={({ field, fieldState }) => (
              <FormItem>
                <FormControl>
                  <CustomInput
                    {...field}
                    type="password"
                    label="현재 비밀번호"
                    autoComplete="current-password"
                    hasValue={!!currentPassword}
                    onClear={handleClearCurrent}
                    error={!!fieldState.error}
                  />
                </FormControl>
                <FormMessage className="text-destructive" />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="newPassword"
            render={({ field, fieldState }) => (
              <FormItem>
                <FormControl>
                  <CustomInput
                    {...field}
                    type="password"
                    label="새 비밀번호"
                    autoComplete="new-password"
                    hasValue={!!newPassword}
                    onClear={handleClearNew}
                    error={!!fieldState.error}
                  />
                </FormControl>
                <FormMessage className="text-destructive" />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="newPasswordConfirm"
            render={({ field, fieldState }) => (
              <FormItem>
                <FormControl>
                  <CustomInput
                    {...field}
                    type="password"
                    label="새 비밀번호 확인"
                    autoComplete="new-password"
                    hasValue={!!newPasswordConfirm}
                    onClear={handleClearConfirm}
                    error={!!fieldState.error}
                  />
                </FormControl>
                <FormMessage className="text-destructive" />
              </FormItem>
            )}
          />

          <CustomButton
            type="submit"
            fullWidth
            size="lg"
            isLoading={isPending}
            disabled={!form.formState.isValid}
          >
            비밀번호 변경
          </CustomButton>

          <p className="text-muted-foreground text-center text-xs">
            변경 완료 시 자동으로 로그아웃되며, 새 비밀번호로 다시
            로그인해주세요.
          </p>
        </form>
      </Form>
    </div>
  )
}
