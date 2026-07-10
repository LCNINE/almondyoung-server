"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import {
  AlertCircle,
  Cake,
  Check,
  ChevronRight,
  IdCard,
  Lock,
  Mail,
  MailCheck,
  Smartphone,
  Tag,
  User,
} from "lucide-react"
import { useTranslations } from "next-intl"
import Image from "next/image"
import { useParams, useRouter } from "next/navigation"
import {
  formatPhoneNumber,
  getCleanKoreanNumber,
} from "@/lib/utils/format-phone-number"
import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { updateProfileFieldAction } from "../actions/profile"
import { resendVerificationEmailAction } from "../actions/profile"
import { IdentityVerifyDialog } from "./identity-verify-dialog"
import { PhoneChangeDialog } from "./phone-change-dialog"

type EditableField = "username" | "nickname" | "birthday"

interface AccountInfoCardProps {
  email: string
  isEmailVerified: boolean
  phoneNumber: string | null
  username: string
  nickname: string
  birthDate: string | Date | null
  loginId: string
}

function birthDigits(v: string | Date | null): string {
  if (!v) return ""
  return String(v).replace(/\D/g, "").slice(0, 8)
}
function birthDisplay(v: string | Date | null): string {
  const d = birthDigits(v)
  if (d.length !== 8) return ""
  return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}`
}
function birthISO(v: string | Date | null): string {
  const d = birthDigits(v)
  if (d.length !== 8) return ""
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
}

export function AccountInfoCard({
  email,
  isEmailVerified,
  phoneNumber,
  username,
  nickname,
  birthDate,
  loginId,
}: AccountInfoCardProps) {
  const t = useTranslations("mypage.account.accountInfo")
  const router = useRouter()
  const { countryCode } = useParams() as { countryCode: string }
  const [dialogOpen, setDialogOpen] = useState(false)
  const [phoneDialogOpen, setPhoneDialogOpen] = useState(false)
  const [passwordGateOpen, setPasswordGateOpen] = useState(false)
  const [editingField, setEditingField] = useState<EditableField | null>(null)

  const rowClass =
    "group flex w-full cursor-pointer items-center gap-5 px-3 py-5 text-left transition-colors hover:bg-gray-50"

  const editRow = (
    icon: React.ReactNode,
    label: string,
    value: string,
    field: EditableField
  ) => (
    <button
      type="button"
      onClick={() => setEditingField(field)}
      className={rowClass}
    >
      {icon}
      <span className="flex-1 space-y-1">
        <span className="block text-base font-semibold md:text-lg">
          {label}
        </span>
        {value && (
          <span className="block text-sm text-gray-600 md:text-base">
            {value}
          </span>
        )}
      </span>
      <ChevronRight className="text-gray-400 size-5" />
    </button>
  )

  const groupTitleClass =
    "mb-2 px-1 text-sm font-semibold text-gray-500 md:text-base"

  return (
    <>
      {/* 계정 보안 */}
      <section>
        <h3 className={groupTitleClass}>{t("securityGroup")}</h3>
        <Card>
          <CardContent className="px-4 py-2 md:px-6">
            <div className="divide-y divide-gray-100">
              {/* 비밀번호 — 본인확인(문자/이메일 코드) 게이트 후 변경 페이지 이동 */}
              <button
                type="button"
                onClick={() => setPasswordGateOpen(true)}
                className={rowClass}
              >
                <Lock className="text-gray-500 size-6 shrink-0" />
                <span className="flex-1 text-base font-semibold md:text-lg">
                  {t("password")}
                </span>
                <ChevronRight className="text-gray-400 size-5" />
              </button>

              {/* 이메일 */}
              <button
                type="button"
                onClick={() => setDialogOpen(true)}
                className={rowClass}
              >
                <Mail className="text-gray-500 size-6 shrink-0" />
                <span className="flex-1 space-y-1">
                  <span className="block text-base font-semibold md:text-lg">
                    {t("email")}
                  </span>
                  <span className="block text-sm text-gray-600 md:text-base">
                    {email}
                  </span>
                  <span
                    className={cn(
                      "flex items-center gap-1 text-sm",
                      isEmailVerified ? "text-gray-500" : "text-red-500"
                    )}
                  >
                    {isEmailVerified ? (
                      <>
                        <Check className="size-4" />
                        {t("verified")}
                      </>
                    ) : (
                      <>
                        <AlertCircle className="size-4" />
                        {t("verifyNeeded")}
                      </>
                    )}
                  </span>
                </span>
                <ChevronRight className="text-gray-400 size-5" />
              </button>

              {/* 휴대폰 — 본인확인(SMS) → 번호 변경 다이얼로그 */}
              <button
                type="button"
                onClick={() => setPhoneDialogOpen(true)}
                className={rowClass}
              >
                <Smartphone className="text-gray-500 size-6 shrink-0" />
                <span className="flex-1 space-y-1">
                  <span className="block text-base font-semibold md:text-lg">
                    {t("phone")}
                  </span>
                  {phoneNumber && (
                    <span className="block text-sm text-gray-600 md:text-base">
                      {formatPhoneNumber(getCleanKoreanNumber(phoneNumber))}
                    </span>
                  )}
                </span>
                <ChevronRight className="text-gray-400 size-5" />
              </button>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* 내 정보 */}
      <section>
        <h3 className={groupTitleClass}>{t("profileGroup")}</h3>
        <Card>
          <CardContent className="px-4 py-2 md:px-6">
            <div className="divide-y divide-gray-100">
              {/* 아이디 (읽기 전용) */}
              <div className="flex items-center gap-5 px-3 py-5">
                <IdCard className="text-gray-400 size-6 shrink-0" />
                <span className="flex-1 space-y-1">
                  <span className="block text-base font-semibold text-gray-500 md:text-lg">
                    {t("loginId")}
                  </span>
                  <span className="block text-sm text-gray-400 md:text-base">
                    {loginId}
                  </span>
                </span>
              </div>

              {/* 이름 */}
              {editRow(
                <User className="text-gray-500 size-6 shrink-0" />,
                t("name"),
                username,
                "username"
              )}

              {/* 닉네임 */}
              {editRow(
                <Tag className="text-gray-500 size-6 shrink-0" />,
                t("nickname"),
                nickname,
                "nickname"
              )}

              {/* 생년월일 */}
              {editRow(
                <Cake className="text-gray-500 size-6 shrink-0" />,
                t("birthday"),
                birthDisplay(birthDate),
                "birthday"
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      <EmailVerifyDialog
        email={email}
        isEmailVerified={isEmailVerified}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
      <PhoneChangeDialog
        phoneNumber={phoneNumber}
        email={email}
        open={phoneDialogOpen}
        onOpenChange={setPhoneDialogOpen}
      />

      <IdentityVerifyDialog
        phoneNumber={phoneNumber}
        email={email}
        open={passwordGateOpen}
        onOpenChange={setPasswordGateOpen}
        onVerified={() => {
          setPasswordGateOpen(false)
          router.push(`/${countryCode}/mypage/account/password`)
        }}
      />

      <FieldEditDialog
        field={editingField}
        currentValue={
          editingField === "username"
            ? username
            : editingField === "nickname"
              ? nickname
              : editingField === "birthday"
                ? birthISO(birthDate)
                : ""
        }
        onClose={() => setEditingField(null)}
      />
    </>
  )
}

const FIELD_CFG: Record<
  EditableField,
  { labelKey: string; placeholderKey: string }
> = {
  username: {
    labelKey: "labels.name",
    placeholderKey: "profile.namePlaceholder",
  },
  nickname: {
    labelKey: "labels.nickname",
    placeholderKey: "profile.nicknamePlaceholder",
  },
  birthday: {
    labelKey: "labels.birthdate",
    placeholderKey: "profile.birthdayPlaceholder",
  },
}

function FieldEditDialog({
  field,
  currentValue,
  onClose,
}: {
  field: EditableField | null
  currentValue: string
  onClose: () => void
}) {
  const t = useTranslations("mypage.account")
  const tEdit = useTranslations("mypage.account.accountInfo.editField")
  const router = useRouter()
  const [value, setValue] = useState(currentValue)
  const [isPending, startTransition] = useTransition()

  // 다이얼로그가 열릴 때(field 변경) 현재 값으로 초기화
  useEffect(() => {
    if (field) setValue(currentValue)
  }, [field, currentValue])

  if (!field) return null
  const cfg = FIELD_CFG[field]
  const isBirthday = field === "birthday"
  const label = t(cfg.labelKey)
  // date input 은 "YYYY-MM-DD" 를 다루므로 저장 시 8자리로 되돌린다
  const todayIso = new Date().toISOString().slice(0, 10)

  const handleSave = () => {
    const payload = isBirthday ? value.replace(/-/g, "") : value
    startTransition(async () => {
      try {
        const result = await updateProfileFieldAction(field, payload)
        if (result.success) {
          toast.success(tEdit("saved"))
          onClose()
          router.refresh()
        } else {
          const key =
            result.error === "required"
              ? field === "username"
                ? "nameRequired"
                : "nicknameRequired"
              : result.error === "invalid"
                ? "birthdayInvalid"
                : "failed"
          toast.error(tEdit(key))
        }
      } catch (error: unknown) {
        const err = error as Error & { digest?: string }
        if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") {
          throw error
        }
        toast.error(tEdit("failed"))
      }
    })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !isPending && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{tEdit("editTitle", { label })}</DialogTitle>
        </DialogHeader>
        <div className="py-1 space-y-2">
          <Label className="text-sm text-muted-foreground">{label}</Label>
          <Input
            autoFocus={!isBirthday}
            type={isBirthday ? "date" : "text"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t(cfg.placeholderKey)}
            max={isBirthday ? todayIso : undefined}
            min={isBirthday ? "1900-01-01" : undefined}
            maxLength={isBirthday ? undefined : 40}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isPending) handleSave()
            }}
            className="w-full h-11"
          />
        </div>
        <div className="flex gap-2 mt-3">
          <Button
            type="button"
            variant="outline"
            className="flex-1 h-11"
            disabled={isPending}
            onClick={onClose}
          >
            {tEdit("cancel")}
          </Button>
          <Button
            type="button"
            className="flex-1 h-11"
            disabled={isPending}
            onClick={handleSave}
          >
            {isPending ? tEdit("saving") : tEdit("save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function EmailVerifyDialog({
  email,
  isEmailVerified,
  open,
  onOpenChange,
  initialStep = "confirm",
}: {
  email: string
  isEmailVerified: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  initialStep?: "confirm" | "sent"
}) {
  const t = useTranslations("mypage.account.accountInfo.verifyDialog")
  const tInfo = useTranslations("mypage.account.accountInfo")
  const [step, setStep] = useState<"confirm" | "sent">(initialStep)
  const [isPending, startTransition] = useTransition()

  const handleOpenChange = (next: boolean) => {
    if (isPending) return
    onOpenChange(next)
    if (!next) setStep(initialStep)
  }

  const handleSendLink = () => {
    startTransition(async () => {
      const result = await resendVerificationEmailAction(email)
      if (result.success) {
        setStep("sent")
      } else {
        toast.error(result.error || t("sendFailed"))
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        {isEmailVerified ? (
          // 이미 인증된 경우: 상태만 안내
          <DialogHeader className="items-center gap-3 pt-4 text-center sm:text-center">
            <div className="grid rounded-full size-14 place-items-center bg-green-50">
              <MailCheck className="text-green-600 size-7" />
            </div>
            <DialogTitle>{tInfo("verified")}</DialogTitle>
            <DialogDescription className="break-all">{email}</DialogDescription>
          </DialogHeader>
        ) : step === "confirm" ? (
          <>
            <DialogHeader className="items-center gap-3 pt-4 text-center sm:text-center">
              <Image
                src="/images/verify/shield.png"
                alt=""
                width={160}
                height={160}
                className="object-contain size-32 md:size-40"
              />
              <DialogTitle className="text-xl">{t("title")}</DialogTitle>
              <DialogDescription className="leading-relaxed break-keep">
                {t("description", { email })}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2 mt-2">
              <Button
                type="button"
                className="w-full h-11"
                disabled={isPending}
                onClick={handleSendLink}
              >
                {isPending ? t("sendLink") + "..." : t("sendLink")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full h-11"
                disabled={isPending}
                onClick={() => handleOpenChange(false)}
              >
                {t("cancel")}
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader className="items-center gap-3 pt-4 text-center sm:text-center">
              <Image
                src="/images/verify/email-img.png"
                alt=""
                width={160}
                height={160}
                className="object-contain size-32 md:size-40"
              />
              <DialogTitle className="text-xl">{t("sentTitle")}</DialogTitle>
              <DialogDescription className="leading-relaxed break-keep">
                {t("sentDescription", { email })}
              </DialogDescription>
            </DialogHeader>
            <div className="mt-2">
              <Button
                type="button"
                className="w-full h-11"
                onClick={() => handleOpenChange(false)}
              >
                {t("done")}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
