"use client"

import { Spinner } from "@components/common/spinner"
import { Button } from "@components/common/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@components/common/ui/sheet"
import { setDefaultPaymentProfile } from "@lib/api/wallet/wallet-api"
import type { BnplProfileDto } from "@lib/types/dto/wallet"
import { CheckCircle2, CreditCard } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { useBankAccountModalStore } from "../store/payment-method-modal-store"

interface ChangeAccountSheetProps {
  isOpen: boolean
  onClose: () => void
  bnplProfiles: BnplProfileDto[]
}

export default function ChangeAccountSheet({
  isOpen,
  onClose,
  bnplProfiles,
}: ChangeAccountSheetProps) {
  const router = useRouter()
  const { openModal: openBankAccountModal } = useBankAccountModalStore()
  const [loadingProfileId, setLoadingProfileId] = useState<string | null>(null)

  const handleSelectAccount = async (profileId: string) => {
    setLoadingProfileId(profileId)
    try {
      await setDefaultPaymentProfile(profileId)
      toast.success("기본 출금 계좌가 변경되었습니다")
      router.refresh()
      onClose()
    } catch (error) {
      toast.error("계좌 변경에 실패했습니다")
    } finally {
      setLoadingProfileId(null)
    }
  }

  const handleAddNewAccount = () => {
    onClose()

    openBankAccountModal()
  }

  const getAccountDisplayInfo = (profile: BnplProfileDto) => {
    if (profile.kind === "BANK_ACCOUNT") {
      return {
        title: profile.details?.paymentCompanyName || "은행 계좌",
        subtitle: profile.details?.paymentNumber
          ? `${profile.details.paymentNumber}`
          : "계좌번호 정보 없음",
        holder: profile.details?.payerName || "예금주 정보 없음",
      }
    }

    return {
      title: "결제 수단",
      subtitle: profile.name || "정보 없음",
      holder: "",
    }
  }

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent
        side="bottom"
        className="h-[85vh] p-0 sm:mx-auto sm:h-auto sm:max-h-[85vh] sm:max-w-[540px]"
      >
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle className="text-xl font-bold">출금 계좌 변경</SheetTitle>
          <SheetDescription className="text-sm text-gray-600">
            기본 출금 계좌를 선택해주세요
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 overflow-y-auto px-6 py-4">
          {/* 등록된 계좌 목록 */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">등록된 계좌</h3>

            {bnplProfiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 py-12 text-center">
                <CreditCard className="mb-3 size-12 text-gray-400" />
                <p className="text-sm font-medium text-gray-900">
                  등록된 계좌가 없습니다
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  새로운 계좌를 등록해주세요
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {bnplProfiles.map((profile) => {
                  const displayInfo = getAccountDisplayInfo(profile)
                  const isLoading = loadingProfileId === profile.id
                  const isDefault = profile.isDefault

                  return (
                    <button
                      key={profile.id}
                      onClick={() => handleSelectAccount(profile.id)}
                      disabled={isLoading || isDefault}
                      className={`w-full rounded-lg border p-4 text-left transition-all ${
                        isDefault
                          ? "border-blue-500 bg-blue-50"
                          : "hover:bg-gray-10 border-gray-200 hover:border-gray-300"
                      } ${isLoading ? "opacity-50" : ""}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex flex-1 items-center gap-3">
                          {/* 아이콘 */}
                          <div
                            className={`flex size-12 shrink-0 items-center justify-center rounded-lg ${
                              isDefault ? "bg-blue-500" : "bg-gray-20"
                            }`}
                          >
                            <CreditCard
                              className={`size-6 ${
                                isDefault ? "text-white" : "text-gray-50"
                              }`}
                            />
                          </div>

                          {/* 계좌 정보 */}
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <p
                                className={`text-sm font-semibold ${
                                  isDefault ? "text-blue-900" : "text-gray-900"
                                }`}
                              >
                                {displayInfo.title}
                              </p>
                              {isDefault && (
                                <span className="rounded-full bg-blue-500 px-2 py-0.5 text-xs font-medium text-white">
                                  기본
                                </span>
                              )}
                            </div>
                            <p
                              className={`mt-0.5 text-xs ${
                                isDefault ? "text-blue-700" : "text-gray-600"
                              }`}
                            >
                              {displayInfo.subtitle}
                            </p>
                            {displayInfo.holder && (
                              <p
                                className={`mt-0.5 text-xs ${
                                  isDefault ? "text-blue-600" : "text-gray-500"
                                }`}
                              >
                                예금주: {displayInfo.holder}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* 로딩 또는 체크 아이콘 */}
                        {isLoading ? (
                          <Spinner size="sm" />
                        ) : isDefault ? (
                          <CheckCircle2 className="size-5 text-blue-500" />
                        ) : null}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* 새 계좌 추가 버튼 */}
          <div className="border-t pt-4">
            <Button
              variant="outline"
              className="w-full cursor-pointer"
              onClick={handleAddNewAccount}
            >
              + 새로운 계좌 등록
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
