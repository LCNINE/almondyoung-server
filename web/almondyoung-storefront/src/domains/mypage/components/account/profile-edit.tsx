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
import { useActionState, useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { profileSchema, type ProfileSchema } from "../../schemas/profile-schema"
import {
  updateProfileAction,
  type ProfileActionState,
} from "../actions/profile"
import { AddressBookSection } from "./address-book-section"
import { PhoneChangeSection } from "./phone-change-section"

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
}

export function ProfileEdit({ userData }: ProfileEditProps) {
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

  const [currentPhone, setCurrentPhone] = useState(
    userData.profile?.phoneNumber || ""
  )

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

      {/* 휴대폰 번호 변경 */}
      <PhoneChangeSection
        currentPhone={currentPhone}
        onPhoneChanged={setCurrentPhone}
      />

      <Separator />

      {/* 배송지 관리 */}
      <AddressBookSection />
    </div>
  )
}
