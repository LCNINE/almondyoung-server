"use client"

import { CustomButton } from "@components/common/custom-buttons"
import { CustomInput } from "@components/common/inputs/custom-input"
import { Spinner } from "@components/common/spinner"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@components/common/ui/form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForgetPw } from "domains/auth/hooks/use-forget-pw"
import { IdCardLanyard, Mail } from "lucide-react"
import { useForm } from "react-hook-form"
import z from "zod"

const findPwSchema = z.object({
  loginId: z.string().min(1, "아이디를 입력해주세요"),
  email: z.string().email("올바른 이메일을 입력해주세요"),
})

type FindPwFormData = z.infer<typeof findPwSchema>

export function AccountFindPwForm() {
  const { forgetPw, isLoading, isSent } = useForgetPw()

  const form = useForm<FindPwFormData>({
    resolver: zodResolver(findPwSchema),
    mode: "onChange",
    defaultValues: {
      loginId: "",
      email: "",
    },
  })

  const onSubmit = async (data: FindPwFormData) => {
    const result = await forgetPw(data.email, data.loginId)

    if (!result.success) {
      if (
        result.error.message.includes("이메일") ||
        result.error.message.includes("아이디")
      ) {
        form.setError("root", {
          message: "입력하신 정보가 일치하지 않습니다.",
        })
      } else {
        form.setError("root", {
          message: "오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
        })
      }
    }
  }

  return (
    <section className="flex min-h-lvh w-full max-w-[375px] flex-col justify-center px-4">
      <div className="mb-6 text-center">
        <h2 className="text-2xl font-bold">비밀번호찾기</h2>
        <p className="text-muted-foreground mt-2 text-sm tracking-tighter">
          가입 시 등록한 이메일로 비밀번호를 재설정할 수 있습니다.
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <div className="relative">
                    <CustomInput
                      {...field}
                      placeholder="가입시 등록한 이메일을 입력해주세요"
                      disabled={isLoading}
                      autoComplete="email"
                      className="pr-10"
                      hasValue={!!field.value}
                      onClear={() => form.setValue("email", "")}
                      error={!!form.formState.errors.email}
                      icon={<Mail className="text-muted-foreground h-4 w-4" />}
                    />
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="loginId"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <div className="relative">
                    <CustomInput
                      {...field}
                      placeholder="가입시 등록한 아이디를 입력해주세요"
                      disabled={isLoading}
                      autoComplete="username"
                      className="pr-10"
                      hasValue={!!field.value}
                      onClear={() => form.setValue("loginId", "")}
                      error={!!form.formState.errors.loginId}
                      icon={
                        <IdCardLanyard className="text-muted-foreground h-4 w-4" />
                      }
                    />
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* 제출 버튼 */}
          <CustomButton
            type="submit"
            className="w-full"
            disabled={isLoading}
            size="lg"
          >
            {isLoading ? (
              <Spinner size="sm" color="white" />
            ) : isSent ? (
              <>재전송</>
            ) : (
              <>
                <Mail className="mr-2 h-4 w-4" />
                인증메일 전송
              </>
            )}
          </CustomButton>

          {form.formState.errors.root && (
            <p className="mt-2 text-center text-sm text-red-500">
              {form.formState.errors.root.message}
            </p>
          )}

          {/* 안내 문구 */}
          {isLoading ? (
            <div className="space-y-2">
              <p className="text-muted-foreground text-center text-xs">
                이메일 전송중...
              </p>
            </div>
          ) : isSent ? (
            <div className="rounded-lg p-4">
              <p className="text-center text-sm">
                <strong>이메일을 확인해주세요!</strong>
              </p>
              <p className="text-muted-foreground mt-2 text-center text-xs">
                아이디 정보가 이메일로 전송되었습니다.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-muted-foreground text-center text-xs">
                가입 시 등록한 이메일로 아이디를 전송해드립니다.
              </p>
            </div>
          )}
        </form>
      </Form>
    </section>
  )
}
