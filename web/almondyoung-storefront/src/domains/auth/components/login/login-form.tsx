"use client"

import { CustomButton } from "@components/common/custom-buttons"
import { CustomCheckbox } from "@components/common/checkbox"
import { CustomInput } from "@components/common/inputs/custom-input"
import { Spinner } from "@components/common/spinner"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@components/common/ui/form"
import { Label } from "@components/common/ui/label"
import { zodResolver } from "@hookform/resolvers/zod"
import { login } from "@lib/api/users/login"
import { useParams, useSearchParams } from "next/navigation"
import { useActionState, useEffect } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { KakaoLoginBtn } from "./kakao-login-btn"
import { useAuthStorage } from "domains/auth/hooks"
import { signinSchema, SigninSchema } from "domains/auth/schemas/signin-schema"

export function LoginForm() {
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get("redirect_to") || "/"
  const { countryCode } = useParams() as { countryCode: string }

  const { saveCredentials, loadCredentials } = useAuthStorage()
  const [state, formAction, isPending] = useActionState(login, null)

  useEffect(() => {
    if (!state) return

    // 로그인 성공 시 리다이렉트
    if (state.success) {
      window.location.href = state.redirectTo
      return
    }

    // 로그인 실패 처리
    if (state?.code === "INVALID_CREDENTIALS") {
      form.setError("loginId", {})
      form.setError("password", {
        message: "아이디 또는 비밀번호를 확인해주세요",
      })

      return
    } else if (state?.code === "UNAUTHORIZED") {
      form.setError("loginId", {})
      form.setError("password", {
        message: "아이디 또는 비밀번호가 일치하지 않습니다",
      })

      return
    } else if (state?.code === "TOO_MANY_ATTEMPTS") {
      toast.error("너무 많은 시도가 있었습니다. 잠시 후 다시 시도해주세요")

      return
    } else if (state?.code === "NETWORK_ERROR") {
      toast.error("서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요")

      return
    } else if (state?.code === "TOKEN_PROCESS_ERROR") {
      toast.error("인증 토큰 처리 중 오류가 발생했습니다")

      return
    }

    toast.error(`${state?.error}`)
  }, [state])

  const form = useForm<SigninSchema>({
    resolver: zodResolver(signinSchema),
    mode: "onChange",
    defaultValues: {
      loginId: loadCredentials().loginId || "",
      password: "",
      rememberMe: loadCredentials().rememberMe || false,
      loginIdRemember: loadCredentials().loginIdRemember || false,
    },
  })

  const loginId = form.watch("loginId")
  const loginIdRemember = form.watch("loginIdRemember")
  const rememberMe = form.watch("rememberMe")

  const handleSubmit = (formData: FormData) => {
    saveCredentials(loginIdRemember, loginId, rememberMe)
    formData.append("redirect_to", redirectTo)
    formData.append("countryCode", countryCode)
    formAction(formData)
  }

  return (
    <Form {...form}>
      <form action={handleSubmit} className="flex flex-col gap-4">
        <FormField
          control={form.control}
          name="loginId"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <CustomInput
                  type="text"
                  required
                  label="아이디"
                  onClear={() => {
                    form.setValue("loginId", "")
                    form.clearErrors("loginId")
                  }}
                  hasValue={!!field.value}
                  error={!!form.formState.errors.loginId}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <CustomInput
                  type="password"
                  required
                  label="비밀번호"
                  onClear={() => {
                    form.setValue("password", "")
                    form.clearErrors("password")
                  }}
                  hasValue={!!field.value}
                  error={!!form.formState.errors.password}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex items-center gap-[15px]">
          <FormField
            control={form.control}
            name="rememberMe"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <div className="flex items-center gap-2">
                    <CustomCheckbox
                      checked={field.value}
                      onCheckedChange={(checked) => {
                        // 자동 로그인 체크 시, 아이디 저장도 자동으로 체크
                        if (checked) {
                          form.setValue("loginIdRemember", true)
                        }
                        field.onChange(checked)
                      }}
                      id="rememberMe"
                    />
                    <Label htmlFor="rememberMe">자동 로그인</Label>
                  </div>
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="loginIdRemember"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <div className="flex items-center gap-2">
                    <CustomCheckbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      id="loginIdRemember"
                      disabled={form.watch("rememberMe")}
                    />
                    <Label htmlFor="loginIdRemember">아이디저장</Label>
                  </div>
                </FormControl>
              </FormItem>
            )}
          />
        </div>

        <div className="flex w-full flex-col gap-2">
          <CustomButton type="submit" fullWidth size="lg" disabled={isPending}>
            {isPending ? <Spinner size="sm" color="white" /> : "로그인"}
          </CustomButton>
          <div className="relative w-full">
            <KakaoLoginBtn />
          </div>
        </div>
      </form>
    </Form>
  )
}
