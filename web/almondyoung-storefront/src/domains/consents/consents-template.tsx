"use client"

import { Spinner } from "@/components/shared/spinner"
import { Button } from "@components/common/ui/button"
import { Checkbox } from "@components/common/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@components/common/ui/dialog"
import { ScrollArea } from "@components/common/ui/scroll-area"
import { HttpApiError } from "@lib/api/api-error"
import { createConsents } from "@lib/api/users/consents"
import { agreements } from "@lib/data/agreements"
import { CreateConsentsDto } from "@lib/types/dto/users"
import { toLocalizedPath } from "@/lib/utils/locale-path"
import { useParams, useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"

export function ConsentsTemplate({ redirectTo }: { redirectTo: string }) {
  const router = useRouter()
  const { countryCode } = useParams() as { countryCode?: string }
  const currentCountryCode = countryCode ?? "kr"
  const [isPending, startTransition] = useTransition()

  const [consents, setConsents] = useState<CreateConsentsDto>({
    isOver14: false,
    termsOfService: false,
    electronicTransaction: false,
    privacyPolicy: false,
    thirdPartySharing: false,
    marketingConsent: false,
  })

  // 전체 동의
  const allChecked = Object.values(consents).every((v) => v === true)
  const allRequiredChecked =
    consents.isOver14 &&
    consents.termsOfService &&
    consents.electronicTransaction &&
    consents.privacyPolicy &&
    consents.thirdPartySharing

  const handleAllCheck = (checked: boolean) => {
    setConsents({
      isOver14: checked,
      termsOfService: checked,
      electronicTransaction: checked,
      privacyPolicy: checked,
      thirdPartySharing: checked,
      marketingConsent: checked,
    })
  }

  const handleSubmit = async () => {
    if (!allRequiredChecked) {
      toast.error("필수 약관에 모두 동의해주세요.")
      return
    }

    startTransition(async () => {
      try {
        const res = await createConsents(consents)
        router.replace(toLocalizedPath(currentCountryCode, redirectTo || "/"))
      } catch (error) {
        if (error instanceof HttpApiError) {
          toast.error(error.message)
        } else {
          toast.error("약관 동의 처리 중 오류가 발생했습니다.")
        }
      }
    })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-2xl space-y-6 rounded-lg bg-white p-6 shadow-sm md:p-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold md:text-3xl">
            서비스 이용약관 동의
          </h1>
          <p className="text-muted-foreground text-sm md:text-base">
            아몬드영 서비스 이용을 위해 약관에 동의해주세요
          </p>
        </div>

        <div className="space-y-4">
          {/* 전체 동의 */}
          <label
            htmlFor="all"
            className="border-primary bg-primary/5 hover:bg-primary/10 flex cursor-pointer items-center gap-3 rounded-lg border-2 p-4 transition-colors"
          >
            <Checkbox
              id="all"
              checked={allChecked}
              onCheckedChange={handleAllCheck}
            />
            <span className="flex-1 text-base font-semibold md:text-lg">
              전체 동의하기
            </span>
          </label>

          {/* 약관 목록 */}
          <div className="space-y-3">
            {agreements.map((agreement) => (
              <ConsentItem
                key={agreement.id}
                agreement={agreement}
                checked={consents[agreement.id as keyof CreateConsentsDto]}
                onCheckedChange={(checked) =>
                  setConsents({
                    ...consents,
                    [agreement.id]: checked,
                  })
                }
              />
            ))}
          </div>
        </div>

        <Button
          onClick={handleSubmit}
          disabled={!allRequiredChecked || isPending}
          className="w-full"
          size="lg"
        >
          {isPending ? <Spinner size="sm" color="blue" /> : "동의하고 시작하기"}
        </Button>

        <p className="text-muted-foreground text-center text-xs">
          필수 약관에 동의하지 않으시면 서비스 이용이 제한됩니다.
        </p>
      </div>
    </div>
  )
}

function ConsentItem({
  agreement,
  checked,
  onCheckedChange,
}: {
  agreement: {
    id: string
    name: string
    content: string | null
  }
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const isRequired = agreement.name.includes("[필수]")

  return (
    <div className="hover:bg-gray-10 flex items-center gap-3 rounded-lg border p-4 transition-colors">
      <label
        htmlFor={agreement.id}
        className="flex flex-1 cursor-pointer items-center gap-3"
      >
        <Checkbox
          id={agreement.id}
          checked={checked}
          onCheckedChange={onCheckedChange}
        />
        <span className="flex-1 text-sm font-medium md:text-base">
          {agreement.name}
        </span>
      </label>

      {agreement.content && (
        <Dialog>
          <DialogTrigger asChild>
            <button className="text-muted-foreground hover:text-foreground shrink-0 text-xs underline transition-colors md:text-sm">
              전문보기
            </button>
          </DialogTrigger>
          <DialogContent className="max-h-[80vh] max-w-2xl">
            <DialogHeader>
              <DialogTitle>{agreement.name}</DialogTitle>
              <DialogDescription>
                {isRequired ? "필수 동의 항목입니다." : "선택 동의 항목입니다."}
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="h-[60vh] pr-4">
              <div className="text-sm leading-relaxed whitespace-pre-wrap">
                {agreement.content}
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
