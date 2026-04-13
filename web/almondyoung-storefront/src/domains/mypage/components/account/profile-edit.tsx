"use client"

import { CustomButton } from "@/components/shared/custom-buttons"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { zodResolver } from "@hookform/resolvers/zod"
import type { UserDetail } from "@lib/types/ui/user"
import type { SocialIdentitiesState } from "@/lib/types/ui/social-identity"
import { toLocalizedPath } from "@lib/utils/locale-path"
import { useActionState, useEffect, useMemo, useTransition } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { profileSchema, type ProfileSchema } from "../../schemas/profile-schema"
import {
  updateProfileAction,
  withdrawUserAction,
  type ProfileActionState,
} from "../actions/profile"
import { AddressBookSection } from "./address-book-section"
import { PhoneSection } from "./phone-section"
import { SocialLinkSection } from "./social-link-section"

const INPUT_CLASSNAME =
  "h-11 rounded-md border border-gray-300 px-4 text-sm aria-[invalid=true]:border-red-500"

function RequiredLabel({ children }: { children: React.ReactNode }) {
  return (
    <Label className="text-sm font-medium">
      {children}
      <span className="ml-0.5 text-red-500">*</span>
    </Label>
  )
}

interface ProfileEditProps {
  userData: UserDetail
  countryCode: string
  identitiesState: SocialIdentitiesState
}

export function ProfileEdit({
  userData,
  countryCode,
  identitiesState,
}: ProfileEditProps) {
  const [isWithdrawPending, startWithdrawTransition] = useTransition()

  const initialValues = useMemo(() => {
    const birthDate = userData.profile?.birthDate
      ? new Date(userData.profile.birthDate)
      : null
    const birthdayStr = birthDate
      ? `${birthDate.getFullYear()}${String(birthDate.getMonth() + 1).padStart(2, "0")}${String(birthDate.getDate()).padStart(2, "0")}`
      : ""

    return {
      username: userData.username || "",
      nickname: userData.nickname || "",
      birthday: birthdayStr,
    }
  }, [userData])

  const [state, formAction, isPending] = useActionState<
    ProfileActionState,
    FormData
  >(updateProfileAction, null)

  const form = useForm<ProfileSchema>({
    resolver: zodResolver(profileSchema),
    mode: "onChange",
    defaultValues: initialValues,
  })

  useEffect(() => {
    if (state?.success === false && state?.field) {
      form.setError(state.field, { message: state.error })
    }
  }, [state, form])

  useEffect(() => {
    if (state?.success) {
      toast.success("회원정보가 수정되었습니다.")
    }
  }, [state])

  const handleWithdraw = () => {
    const isConfirmed = window.confirm(
      "정말 회원탈퇴 하시겠습니까? 탈퇴 후 계정 복구가 어려울 수 있습니다."
    )

    if (!isConfirmed) return

    startWithdrawTransition(async () => {
      try {
        await withdrawUserAction()

        window.location.replace(toLocalizedPath(countryCode, "/"))
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : "회원탈퇴 처리 중 오류가 발생했습니다."
        toast.error(message)
      }
    })
  }

  return (
    <div className="space-y-6 py-2 md:py-4">
      {/* 기본 정보 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">기본 정보</CardTitle>
          <CardDescription>
            계정의 기본 정보를 확인하고 수정할 수 있습니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form action={formAction} className="space-y-5">
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <RequiredLabel>이름</RequiredLabel>
                    <FormControl>
                      <Input
                        {...field}
                        autoComplete="name"
                        placeholder="이름을 입력해주세요"
                        className={INPUT_CLASSNAME}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* 아이디 (읽기 전용) */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">아이디</Label>
                <div className="relative">
                  <Input
                    value={userData.loginId || ""}
                    readOnly
                    disabled
                    className="bg-gray-20 h-11 cursor-not-allowed rounded-md border border-gray-200 px-4 text-sm text-black"
                  />
                </div>
              </div>

              {/* 이메일 (읽기 전용) */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">이메일</Label>
                <div className="relative">
                  <Input
                    value={userData.email || ""}
                    readOnly
                    disabled
                    className="bg-gray-20 h-11 cursor-not-allowed rounded-md border border-gray-200 px-4 text-sm text-black"
                  />
                </div>
              </div>

              <FormField
                control={form.control}
                name="nickname"
                render={({ field }) => (
                  <FormItem>
                    <RequiredLabel>닉네임</RequiredLabel>
                    <FormControl>
                      <Input
                        {...field}
                        autoComplete="nickname"
                        placeholder="닉네임을 입력해주세요"
                        className={INPUT_CLASSNAME}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="birthday"
                render={({ field }) => (
                  <FormItem>
                    <Label className="text-sm font-medium">생년월일</Label>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="YYYYMMDD (예: 19900101)"
                        autoComplete="bday"
                        maxLength={8}
                        inputMode="numeric"
                        className={INPUT_CLASSNAME}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-3 pt-2">
                {state?.success === false && !state?.field && (
                  <p className="text-sm text-red-500">{state.error}</p>
                )}

                <div className="flex justify-end">
                  <CustomButton
                    type="submit"
                    disabled={
                      !form.formState.isValid ||
                      !form.formState.isDirty ||
                      isPending
                    }
                    className="px-8"
                  >
                    {isPending ? "저장 중..." : "저장"}
                  </CustomButton>
                </div>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* 소셜 계정 연동 */}
      <SocialLinkSection identitiesState={identitiesState} />

      {/* 휴대폰 번호 변경 */}
      <PhoneSection initialPhoneNumber={userData.profile?.phoneNumber ?? null} />

      <Separator />

      {/* 배송지 관리 */}
      <AddressBookSection />

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleWithdraw}
          disabled={isWithdrawPending}
          className="text-xs text-gray-500 underline underline-offset-2 transition-colors hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isWithdrawPending ? "탈퇴 처리 중..." : "회원탈퇴"}
        </button>
      </div>
    </div>
  )
}
