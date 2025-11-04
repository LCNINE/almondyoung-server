"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useForgetUserId } from "@components/auth/hooks/use-forget-userid"
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
import { Mail } from "lucide-react"
import { useForm } from "react-hook-form"
import z from "zod"

const findIdSchema = z.object({
  email: z.string().email("올바른 이메일을 입력해주세요"),
})

type FindIdFormData = z.infer<typeof findIdSchema>

export function AccountFindIdForm() {
  const { forgetUserId, isLoading, isSent } = useForgetUserId()

  const form = useForm<FindIdFormData>({
    resolver: zodResolver(findIdSchema),
    mode: "onChange",
    defaultValues: {
      email: "",
    },
  })

  const onSubmit = async (data: FindIdFormData) => {
    const result = await forgetUserId(data.email)

    if (!result.success) {
      form.setError("email", {
        message: result.error.message,
      })
    }
  }

  return (
    <section className="flex min-h-lvh w-full max-w-[375px] flex-col justify-center px-4">
      <div className="mb-6 text-center">
        <h2 className="text-2xl font-bold">아이디찾기</h2>
        <p className="text-muted-foreground mt-2 text-sm">
          가입 시 등록한 이메일로 아이디를 찾을 수 있습니다.
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
                      placeholder="example@almondyoung.com"
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
                아이디찾기
              </>
            )}
          </CustomButton>

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
