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
import { useTranslations } from "next-intl"
import { useActionState, useEffect, useMemo } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { profileSchema, type ProfileSchema } from "../../schemas/profile-schema"
import {
  updateProfileAction,
  type ProfileActionState,
} from "../actions/profile"
import { AddressBookSection } from "./address-book-section"
import { InterestCategoriesSection } from "./interest-categories-section"
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
  identitiesState: SocialIdentitiesState
}

export function ProfileEdit({
  userData,
  identitiesState,
}: ProfileEditProps) {
  const t = useTranslations("mypage.account")

  const initialValues = useMemo(() => {
    const birthDateStr = userData.profile?.birthDate
    const birthdayStr = birthDateStr
      ? String(birthDateStr).replace(/-/g, "").slice(0, 8)
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
      toast.success(t("profile.savedSuccess"))
    }
  }, [state, t])

  return (
    <div className="space-y-6 py-2 md:py-4">
      {/* 기본 정보 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("profile.sectionTitle")}</CardTitle>
          <CardDescription>{t("profile.sectionDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form action={formAction} className="space-y-5">
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <RequiredLabel>{t("labels.name")}</RequiredLabel>
                    <FormControl>
                      <Input
                        {...field}
                        autoComplete="name"
                        placeholder={t("profile.namePlaceholder")}
                        className={INPUT_CLASSNAME}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* 아이디 (읽기 전용) */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("labels.id")}</Label>
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
                <Label className="text-sm font-medium">
                  {t("labels.email")}
                </Label>
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
                    <RequiredLabel>{t("labels.nickname")}</RequiredLabel>
                    <FormControl>
                      <Input
                        {...field}
                        autoComplete="nickname"
                        placeholder={t("profile.nicknamePlaceholder")}
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
                    <Label className="text-sm font-medium">
                      {t("labels.birthdate")}
                    </Label>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder={t("profile.birthdayPlaceholder")}
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
                    {isPending ? t("profile.saving") : t("profile.save")}
                  </CustomButton>
                </div>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* 소셜 계정 연동 */}
      {/* <SocialLinkSection identitiesState={identitiesState} /> */}

      {/* 휴대폰 번호 변경 */}
      <PhoneSection
        initialPhoneNumber={userData.profile?.phoneNumber ?? null}
      />

      {/* 관심 카테고리 */}
      <InterestCategoriesSection
        initialKeys={userData.profile?.interestCategoryKeys ?? []}
      />

      <Separator />

      {/* 배송지 관리 */}
      <AddressBookSection />
    </div>
  )
}
