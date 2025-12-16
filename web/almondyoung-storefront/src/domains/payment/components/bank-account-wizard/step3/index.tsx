"use client"

import { Spinner } from "@components/common/spinner"
import { Button } from "@components/common/ui/button"
import { Checkbox } from "@components/common/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@components/common/ui/dialog"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@components/common/ui/drawer"
import { Input } from "@components/common/ui/input"
import { Label } from "@components/common/ui/label"
import { ScrollArea } from "@components/common/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/common/ui/select"
import { agreements } from "@lib/data/agreements"
import { UserDetail } from "@lib/types/ui/user"
import { format } from "date-fns"
import { Check, ChevronRight, PenLine, RotateCw } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Controller, useFormContext } from "react-hook-form"
import { formatPhoneNumber } from "react-phone-number-input"
import SignatureCanvas from "react-signature-canvas"
import { v4 as uuidv4 } from "uuid"
import { maskAccountNumber } from "../../utils/mask-account-number"
import { PaymentMethodFormSchema } from "../schema"

/**
 * 정기결제 동의서 컴포넌트
 */
export default function BankAgreementStep({
  user,
  isFormSubmitting,
}: {
  user: UserDetail
  isFormSubmitting: boolean
}) {
  const form = useFormContext<PaymentMethodFormSchema>()

  // 전자서명 모달 오픈
  const [isSignatureModalOpen, setIsSignatureModalOpen] =
    useState<boolean>(false)

  // 1일부터 28일까지 선택 옵션 생성
  const dayOptions = Array.from({ length: 28 }, (_, i) => i + 1)

  return (
    <div className="flex flex-col gap-4">
      <section className="flex">
        <div className="flex-1 space-y-2">
          <div>
            <Label className="text-sm font-medium">결제 신청인</Label>
          </div>

          <div>
            <Label className="text-sm font-medium">결제자 휴대폰 번호</Label>
          </div>

          <div>
            <Label className="text-sm font-medium">계좌번호</Label>
          </div>

          <div>
            <Label className="text-sm font-medium">예금주(소유주)명</Label>
          </div>
        </div>

        <div className="flex-2 space-y-2">
          {/* 유저이름 */}
          <p className="text-sm font-medium">{user.username}</p>

          {/* 유저 전화번호 */}
          <p className="text-sm font-medium">
            {formatPhoneNumber(user.profile?.phoneNumber || "")}
          </p>

          {/* 계좌번호 */}
          <p className="text-sm font-medium">
            {form.watch("bankName")}{" "}
            {maskAccountNumber(form.watch("accountNumber"))}
          </p>

          {/* 예금주(소유주)명 */}
          <p className="text-sm font-medium">
            {form.watch("accountHolderName")}
          </p>
        </div>
      </section>
      <section className="mt-4 flex gap-4 py-2">
        <div className="flex-1 space-y-2">
          <Label className="text-sm font-medium">생년월일</Label>
          <Input
            type="text"
            placeholder="YYYY-MM-DD"
            required
            value={form.watch("birthDate")}
            onChange={(e) => form.setValue("birthDate", e.target.value)}
            className="bg-gray-10"
          />
        </div>

        <div className="flex-1 space-y-2">
          <Label className="text-sm font-medium">결제일</Label>
          <Select
            value={form.watch("billingDate")}
            onValueChange={(value) => form.setValue("billingDate", value)}
          >
            <SelectTrigger className="w-full rounded-none border-2 bg-white shadow-none">
              <SelectValue
                placeholder="매월 10일"
                defaultValue={form.watch("billingDate") || "10"}
              />
            </SelectTrigger>
            <SelectContent className="max-h-60">
              {dayOptions.map((day) => (
                <SelectItem key={day} value={String(day)}>
                  매월 {day}일
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      {/* 약관 동의 섹션 */}
      <section className="mt-4">
        {agreements.slice(2, 5).map((agreement) => (
          <AgreementForm
            key={agreement.id}
            agreement={agreement}
            checked={
              !!form.watch(agreement.id as keyof PaymentMethodFormSchema)
            }
            onCheckedChange={(checked) =>
              form.setValue(
                agreement.id as keyof PaymentMethodFormSchema,
                checked
              )
            }
          />
        ))}
      </section>


      <section className="mt-5 space-y-4 border-t pt-5">
        {Object.keys(form.formState.errors).length > 0 ? (
          <p className="text-xs text-red-500">
            {
              form.formState.errors[
                Object.keys(
                  form.formState.errors
                )[0] as keyof PaymentMethodFormSchema
              ]?.message
            }
          </p>
        ) : (
          <p className="text-xs font-normal">
            위와 같이 정기결제 신청에 동의합니다.
          </p>
        )}

        <div className="fixed right-0 bottom-0 left-0 space-y-2 bg-white p-4">
          {/* 전자서명 영역 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">
                전자서명 <span className="text-red-500">*</span>
              </Label>
              {form.watch("signature") && (
                <span className="flex items-center gap-1 text-xs text-green-600">
                  <Check className="size-3.5" />
                  서명 완료
                </span>
              )}

              {!form.watch("signature") && (
                <p className="text-center text-xs text-gray-500">
                  전자서명을 완료해주세요
                </p>
              )}
            </div>

            <Button
              type="button"
              variant={"outline"}
              size="lg"
              className={`w-full cursor-pointer transition-all hover:bg-yellow-50 hover:text-white ${
                form.formState.errors.signature
                  ? "animate-pulse border-red-500 bg-red-50"
                  : ""
              }`}
              onClick={() => {
                setIsSignatureModalOpen(true)
              }}
            >
              <PenLine className="mr-2 size-4" />
              {form.watch("signature") ? "서명 다시하기" : "전자서명 하기"}
            </Button>
          </div>

          {/* 신청 버튼 */}
          <Button
            type="submit"
            variant={"default"}
            size="lg"
            className="bg-primary hover:bg-primary/90 w-full cursor-pointer font-semibold"
            disabled={!form.watch("signature") || isFormSubmitting}
          >
            {isFormSubmitting ? (
              <Spinner size="sm" color="white" />
            ) : (
              "정기결제 신청하기"
            )}
          </Button>
        </div>
      </section>

      <SignaturePad
        user={user}
        isOpen={isSignatureModalOpen}
        onClose={() => setIsSignatureModalOpen(false)}
        onComplete={(signatureFile) => {
          form.setValue("signature", signatureFile)
        }}
      />
    </div>
  )
}

function AgreementForm({
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
  const form = useFormContext<PaymentMethodFormSchema>()

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3 rounded-lg p-0">
        <Controller
          control={form.control}
          name={agreement.id as keyof PaymentMethodFormSchema}
          render={({ field }) => (
            <>
              <Checkbox
                id={agreement.id}
                checked={!!field.value}
                onCheckedChange={(checked) => {
                  field.onChange(checked)

                  field?.name &&
                    form.trigger([
                      "electronicTransaction",
                      "privacyPolicy",
                      "thirdPartySharing",
                    ])
                }}
                className={
                  form.formState.errors[
                    agreement.id as keyof PaymentMethodFormSchema
                  ]
                    ? "border-red-500"
                    : ""
                }
              />
              <Label
                htmlFor={agreement.id}
                className={`flex flex-1 cursor-pointer items-center ${form.formState.errors[agreement.id as keyof PaymentMethodFormSchema] ? "text-red-500" : ""}`}
              >
                <span className="flex-1 text-sm">{agreement.name}</span>
              </Label>
            </>
          )}
        />

        {agreement.content && (
          <Drawer>
            <DrawerTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="cursor-pointer hover:bg-transparent hover:text-gray-50"
              >
                <ChevronRight className="size-4" />
              </Button>
            </DrawerTrigger>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>{agreement.name}</DrawerTitle>
                <DrawerDescription>필수 동의 항목입니다.</DrawerDescription>
              </DrawerHeader>
              <ScrollArea className="h-[60vh] px-4">
                <div className="pb-4 text-sm leading-relaxed whitespace-pre-wrap">
                  {agreement.content}
                </div>
              </ScrollArea>
              <DrawerFooter>
                <DrawerClose asChild>
                  <Button variant="outline">닫기</Button>
                </DrawerClose>
              </DrawerFooter>
            </DrawerContent>
          </Drawer>
        )}
      </div>
    </div>
  )
}

interface SignaturePadProps {
  user: UserDetail
  onComplete: (signatureFile: File) => void
  isOpen: boolean
  onClose: () => void
}

// 서명 패드 컴포넌트
export function SignaturePad({
  user,
  onComplete,
  isOpen,
  onClose,
}: SignaturePadProps) {
  const form = useFormContext<PaymentMethodFormSchema>()

  const sigCanvas = useRef<SignatureCanvas>(null)
  const [isEmpty, setIsEmpty] = useState(true)
  const [isLoading, setIsLoading] = useState(false)

  const clear = () => {
    sigCanvas.current?.clear()
    setIsEmpty(true)
  }

  const generateFileName = () => {
    const timestamp = format(new Date(), "yyyyMMdd-HHmmss")
    const uuid = uuidv4().slice(0, 4)
    return `signature-${user.id ?? "unknown"}-${timestamp}-${uuid}.png`
  }

  const save = () => {
    if (sigCanvas.current?.isEmpty()) {
      alert("서명을 입력해주세요")
      return
    }

    const fileName = generateFileName()

    // Canvas → Blob → File 변환
    sigCanvas.current?.getCanvas().toBlob((blob) => {
      if (blob) {
        const file = new File([blob], fileName, { type: "image/png" })

        form.clearErrors("signature")
        onComplete(file)
        onClose()
      }
    }, "image/png")
  }

  // 기존 서명을 캔버스에 로드
  useEffect(() => {
    if (!isOpen) return

    const loadSignature = async () => {
      const signature = form.watch("signature")

      // 서명이 없으면 캔버스 초기화
      if (!signature) {
        if (sigCanvas.current) {
          sigCanvas.current.clear()
          setIsEmpty(true)
        }
        return
      }

      // 서명이 있으면 로드
      setIsLoading(true)
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = (e) => {
            const result = e.target?.result as string
            if (result) resolve(result)
            else reject(new Error("Failed to read file"))
          }
          reader.onerror = reject
          reader.readAsDataURL(signature)
        })

        // 이미지가 완전히 로드된 후 캔버스에 그리기
        await new Promise<void>((resolve) => {
          const img = new Image()
          img.onload = () => {
            if (sigCanvas.current) {
              // 약간의 딜레이를 주어 캔버스가 완전히 준비되도록 함
              setTimeout(() => {
                if (sigCanvas.current) {
                  sigCanvas.current.clear()
                  sigCanvas.current.fromDataURL(dataUrl)
                  setIsEmpty(false)
                  resolve()
                }
              }, 100)
            }
          }
          img.src = dataUrl
        })
      } catch (error) {
        console.error("Failed to load signature:", error)
      } finally {
        setIsLoading(false)
      }
    }

    loadSignature()
  }, [isOpen, form])

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>전자서명</DialogTitle>
          <DialogDescription>
            아래 영역에 서명을 입력해주세요.
          </DialogDescription>
        </DialogHeader>

        <div className="bg-yellow-10 relative rounded-lg">
          {isLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/50">
              <p className="text-sm text-gray-600">서명 불러오는 중...</p>
            </div>
          )}

          <SignatureCanvas
            ref={sigCanvas}
            canvasProps={{
              width: 500,
              height: 200,
              className: "w-full",
              style: { touchAction: "none" }, // 모바일 터치 스크롤 방지
            }}
            onBegin={() => setIsEmpty(false)}
          />

          {isEmpty && !isLoading && (
            <p className="text-gray-40 pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-xs font-medium">
              여기에 서명하세요
            </p>
          )}

          <div className="absolute right-4 bottom-4">
            <RotateCw
              className="size-5 cursor-pointer"
              onClick={clear}
              color="#A86500"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            onClick={save}
            disabled={isEmpty || isLoading}
            className="w-full sm:w-auto"
          >
            서명 완료
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
