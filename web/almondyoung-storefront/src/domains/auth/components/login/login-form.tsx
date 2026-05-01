"use client"

import { CustomCheckbox } from "@/components/shared/checkbox"
import { CustomButton } from "@/components/shared/custom-buttons"
import { CustomInput } from "@/components/shared/inputs/custom-input"
import { Spinner } from "@/components/shared/spinner"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form"
import { Label } from "@/components/ui/label"
import { getBackendBaseUrl } from "@/lib/config/backend"
import { zodResolver } from "@hookform/resolvers/zod"
import { login } from "@lib/api/users/login"
import { useAuthStorage } from "domains/auth/hooks"
import { signinSchema, SigninSchema } from "domains/auth/schemas/signin-schema"
import { useParams, useSearchParams } from "next/navigation"
import { useActionState, useEffect } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { getSocialErrorMessage } from "../../utils/set-form-error"
import { LegacyAccountMigrationCard } from "../legacy-account-migration-card"
import { SocialLoginBtn } from "./social-login-btn"

export function LoginForm() {
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get("redirect_to") || "/"
  const errorMessage = searchParams.get("errorMessage")
  const { countryCode } = useParams() as { countryCode: string }

  const { saveCredentials, loadCredentials } = useAuthStorage()
  const [state, formAction, isPending] = useActionState(login, null)

  const form = useForm<SigninSchema>({
    resolver: zodResolver(signinSchema),
    mode: "onChange",
    defaultValues: {
      loginId: "",
      password: "",
      rememberMe: false,
      loginIdRemember: false,
    },
  })

  useEffect(() => {
    const credentials = loadCredentials()
    if (
      credentials.loginId ||
      credentials.rememberMe ||
      credentials.loginIdRemember
    ) {
      form.reset({
        loginId: credentials.loginId,
        password: "",
        rememberMe: credentials.rememberMe,
        loginIdRemember: credentials.loginIdRemember,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 소셜 로그인 에러 처리
  useEffect(() => {
    if (errorMessage) {
      form.setError("root", {
        message: getSocialErrorMessage(errorMessage),
      })
    }
  }, [errorMessage, form])

  useEffect(() => {
    // 로그인 성공 시 redirect가 throw되므로 state는 에러일 때만 업데이트됨
    if (state && !state.success) {
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
    }
  }, [state])

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
        {form.formState.errors.root && (
          <p className="text-center text-sm text-red-500">
            {form.formState.errors.root.message}
          </p>
        )}

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
        </div>

        <div className="flex w-full flex-col gap-2">
          <div className="relative w-full">
            <SocialLoginBtn
              label="kakao"
              handleLogin={() => {
                const baseUrl = getBackendBaseUrl("users")

                if (!baseUrl) {
                  console.error("User service base URL is not configured")
                  return
                }

                window.location.href = `${baseUrl}/auth/kakao/signin`
              }}
              src={"/images/kakao_login-large.png"}
            />
          </div>

          <div className="relative w-full">
            <SocialLoginBtn
              label="naver"
              handleLogin={() => {
                const baseUrl = getBackendBaseUrl("users")

                if (!baseUrl) {
                  console.error("User service base URL is not configured")
                  return
                }

                window.location.href = `${baseUrl}/auth/naver/signin`
              }}
              src={"/images/NAVER_login_Light_KR_green_center_H48.png"}
            />
          </div>

          <LegacyAccountMigrationCard variant="login" />
        </div>
      </form>
    </Form>
  )
}
