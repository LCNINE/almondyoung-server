"use client"

import React, { useState, useRef, useEffect } from "react"
import {
  ChevronLeft,
  ChevronDown,
  Check,
  ChevronRight,
  RotateCcw,
} from "lucide-react"
import { BankFormData } from "./add-bank-form"
import { PhoneFormData } from "domains/verify/phone/index"
import { WALLET_SERVICE_BASE_URL } from "@lib/api/api.config"

interface PaymentAgreementProps {
  onBack?: () => void
  onComplete?: () => void
  bankData: BankFormData | null
  phoneData: PhoneFormData | null
}
//나중결제 정기결제 동의서 컴포넌트
// 공통 Input 스타일 컴포넌트 (Shadcn UI 느낌 + 디자인 커스텀)
const CustomInput = ({
  value,
  readOnly = false,
  className = "",
}: {
  value: string
  readOnly?: boolean
  className?: string
}) => (
  <div className="relative w-full">
    <input
      type="text"
      value={value}
      readOnly={readOnly}
      className={`w-full bg-[#f4f4f4] px-4 py-3 text-xs text-[#d9d9d9] placeholder:text-[#d9d9d9] focus:outline-none ${className}`}
    />
    {/* 디자인상의 하단 밑줄 구현 */}
    <div className="absolute bottom-0 left-0 h-[1px] w-full bg-[#8e8e93]" />
  </div>
)

// 정보 행 컴포넌트
const InfoRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-start justify-between py-1">
    <span className="w-[100px] shrink-0 text-xs text-black">{label}</span>
    <span className="flex-1 text-left text-xs font-normal break-all text-[#1e1e1e]">
      {value}
    </span>
  </div>
)

// 체크박스 아이템 컴포넌트
const CheckboxItem = ({ label }: { label: string }) => (
  <div className="flex items-center gap-2.5">
    <div className="flex h-4 w-4 items-center justify-center rounded-[2px] bg-[#F29219]">
      <Check className="h-3 w-3 stroke-[3] text-white" />
    </div>
    <span className="text-xs text-[#1c1c1e]">{label}</span>
  </div>
)

// 약관 동의 리스트 아이템
const AgreementItem = ({ label }: { label: string }) => (
  <button className="flex w-full items-center justify-between py-2">
    <div className="flex items-center gap-2.5">
      <div className="h-4 w-4 rounded-sm border border-[#1c1c1e]" />
      <span className="text-[13px] text-[#1c1c1e]">{label}</span>
    </div>
    <ChevronDown className="h-5 w-5 text-[#1E1E1E]" />
  </button>
)

// 은행 코드 매핑 (실제 은행명 -> 코드)
const BANK_CODE_MAP: Record<string, string> = {
  우리은행: "011",
  KB국민은행: "004",
  신한은행: "088",
  하나은행: "081",
  NH농협은행: "011",
}

export default function LaterPaymentRegularConfirm({
  onBack,
  onComplete,
  bankData,
  phoneData,
}: PaymentAgreementProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [payerNumber, setPayerNumber] = useState("")
  const [signatureFile, setSignatureFile] = useState<File | null>(null)

  // Step 1, 2 데이터가 없으면 에러 처리
  if (!bankData || !phoneData) {
    return (
      <div className="min-h-screen w-full bg-white text-[#1e1e1e]">
        <div className="mx-auto flex max-w-md flex-col px-4 pt-2 pb-8">
          <p className="text-center text-red-500">
            필수 정보가 누락되었습니다. 처음부터 다시 진행해주세요.
          </p>
          {onBack && (
            <button
              onClick={onBack}
              className="mt-4 w-full rounded-[5px] bg-amber-500 py-3 text-sm font-semibold text-white"
            >
              돌아가기
            </button>
          )}
        </div>
      </div>
    )
  }

  const handleSubmit = async (signatureFile: File | null) => {
    setIsSubmitting(true)
    try {
      // 서명이 없으면 에러
      if (!signatureFile) {
        alert("서명을 완료해주세요.")
        setIsSubmitting(false)
        return
      }

      // payerNumber는 사업자등록번호 10자리 (직접 입력)
      if (!payerNumber || payerNumber.length !== 10) {
        alert("사업자등록번호를 10자리로 입력해주세요.")
        setIsSubmitting(false)
        return
      }

      // 파일이 비어있지 않은지 확인
      if (signatureFile.size === 0) {
        alert("서명 파일이 비어있습니다. 다시 서명해주세요.")
        setIsSubmitting(false)
        return
      }

      // Step 1, 2, 3 데이터를 모두 수집하여 API 호출
      const formData = new FormData()

      // Step 1 데이터 (계좌 정보)
      // userId는 JWT 토큰에서 자동으로 추출되므로 FormData에 포함하지 않음
      formData.append("payerName", phoneData.name)
      formData.append("phone", phoneData.phoneNumber.replace(/\D/g, ""))
      formData.append("paymentCompany", BANK_CODE_MAP[bankData.bank] || "011")
      formData.append("paymentNumber", bankData.accountNumber)
      formData.append("payerNumber", payerNumber.replace(/\D/g, ""))

      // Step 3 데이터 (서명 이미지 파일)
      // 백엔드에서 req.file()로 파싱하므로 필드명은 'file'이어야 함
      formData.append(
        "file",
        signatureFile,
        signatureFile.name || "signature.png"
      )

      // 디버깅: FormData 내용 확인
      console.log("FormData 전송:", {
        payerName: formData.get("payerName"),
        phone: formData.get("phone"),
        paymentCompany: formData.get("paymentCompany"),
        paymentNumber: formData.get("paymentNumber"),
        payerNumber: formData.get("payerNumber"),
        file: signatureFile.name,
        fileSize: signatureFile.size,
        fileType: signatureFile.type,
      })

      // FormData에 파일이 제대로 포함되었는지 확인
      const fileInFormData = formData.get("file")
      if (!fileInFormData || !(fileInFormData instanceof File)) {
        alert("서명 파일이 FormData에 제대로 추가되지 않았습니다.")
        setIsSubmitting(false)
        return
      }

      // API 호출
      // 백엔드 엔드포인트: POST /payments/hms-bnpl/onboard
      const apiUrl = `${WALLET_SERVICE_BASE_URL}/payments/hms-bnpl/onboard`

      const response = await fetch(apiUrl, {
        method: "POST",
        body: formData,
        credentials: "include", // 쿠키 기반 인증 (JWT 토큰)
        // Content-Type은 FormData를 사용하면 자동으로 설정되므로 명시하지 않음
      })

      if (!response.ok) {
        let errorMessage = "등록에 실패했습니다."

        try {
          const errorData = await response.json()
          // 백엔드 에러 응답 형식에 맞게 파싱
          errorMessage =
            errorData.message ||
            errorData.error?.message ||
            `요청 실패 (${response.status})`
        } catch {
          // JSON 파싱 실패 시 기본 메시지 사용
          errorMessage = `요청 실패 (${response.status}: ${response.statusText})`
        }

        throw new Error(errorMessage)
      }

      const result = await response.json()
      console.log("BNPL 등록 성공:", result)

      // 성공 응답 확인
      if (result.success && result.profileId && result.memberId) {
        // 성공 시 페이지 새로고침하여 최신 데이터 표시
        window.location.reload()
      } else {
        throw new Error("등록은 완료되었지만 응답 형식이 올바르지 않습니다.")
      }
    } catch (error) {
      console.error("BNPL 등록 오류:", error)
      alert(
        error instanceof Error ? error.message : "등록 중 오류가 발생했습니다."
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  // 계좌번호 마스킹
  const maskAccountNumber = (accountNumber: string) => {
    if (accountNumber.length <= 8) return accountNumber
    const start = accountNumber.slice(0, 4)
    const end = accountNumber.slice(-2)
    return `${start}-${"*".repeat(accountNumber.length - 6)}-${end}`
  }

  // 전화번호 포맷팅
  const formatPhoneNumber = (phone: string) => {
    const cleaned = phone.replace(/\D/g, "")
    if (cleaned.length === 11) {
      return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7)}`
    }
    return phone
  }

  return (
    <div className="min-h-screen w-full bg-white text-[#1e1e1e]">
      {/* Container: 모바일 뷰 유지를 위한 최대 너비 설정 및 중앙 정렬 */}
      <div className="mx-auto flex max-w-md flex-col px-4 pt-2 pb-8">
        {/* Header */}
        <header className="mb-6 flex items-center gap-2">
          {onBack && (
            <button
              onClick={onBack}
              className="-ml-2 rounded-full p-1 transition-colors hover:bg-gray-100"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
          )}
          <h1 className="text-2xl font-bold">정기결제 동의서</h1>
        </header>

        {/* Content Area */}
        <main className="flex flex-col gap-6">
          {/* Section 1: 기본 정보 (Grid Layout 대신 Flex 사용으로 간격 제어) */}
          <section className="flex flex-col gap-3">
            <InfoRow label="결제 신청인" value={phoneData.name || ""} />
            <InfoRow label="회사명" value="블랙속눈썹" />
            <InfoRow
              label="결제자 휴대폰 번호"
              value={formatPhoneNumber(phoneData.phoneNumber)}
            />
            <InfoRow
              label="계좌번호"
              value={`${bankData.bank} ${maskAccountNumber(bankData.accountNumber)}`}
            />
            <InfoRow label="예금주(소유주)명" value={bankData.accountHolder} />

            <div className="mt-1 flex flex-col gap-2">
              <span className="text-xs text-black">결제자 생년월일</span>
              <CustomInput value={phoneData.birthDate || ""} readOnly />
            </div>

            <div className="mt-1 flex flex-col gap-2">
              <span className="text-xs text-black">사업자등록번호</span>
              <div className="relative w-full">
                <input
                  type="text"
                  value={payerNumber}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, "").slice(0, 10)
                    setPayerNumber(value)
                  }}
                  placeholder="사업자등록번호 10자리 입력"
                  maxLength={10}
                  className="w-full bg-[#f4f4f4] px-4 py-3 text-xs text-[#1e1e1e] placeholder:text-[#d9d9d9] focus:outline-none"
                />
                {/* 디자인상의 하단 밑줄 구현 */}
                <div className="absolute bottom-0 left-0 h-[1px] w-full bg-[#8e8e93]" />
              </div>
            </div>
          </section>

          {/* Section 2: 결제일 설정 */}
          <section className="flex flex-col gap-2">
            <span className="text-xs text-black">결제일</span>
            <button className="flex w-full items-center justify-between border border-[#d9d9d9] bg-white px-4 py-3">
              <span className="text-xs text-[#1e1e1e]">매월 10일</span>
              <ChevronDown className="h-4 w-4 text-[#1E1E1E]" />
            </button>
          </section>

          {/* Section 3: 현금영수증 */}
          {/* <section className="flex flex-col gap-4">
            <span className="text-[11px] text-black">현금영수증 신청</span>

            <div className="flex flex-col gap-2">
              <CheckboxItem label="은행자동 이체 시 자동 발행" />
              <CheckboxItem label="사업자번호 동일" />
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs text-black">현금영수증 수신 email</span>
              <CustomInput value="example@gmail.com" readOnly />
            </div>
          </section> */}

          {/* Section 4: 약관 동의 */}
          <section className="mt-4 flex flex-col gap-1">
            <AgreementItem label="[필수] 개인정보 수집 및 이용 동의" />
            <AgreementItem label="[필수] 개인정보 제3자 제공 동의" />
          </section>

          {/* Footer Area */}
          <section className="mt-6 flex flex-col gap-6">
            <p className="text-center text-[13px] text-[#1c1c1e]">
              위와 같이 정기결제 신청에 동의합니다.
            </p>

            <SignaturePad
              onSignatureComplete={(file) => {
                setSignatureFile(file)
              }}
            />
            <button
              onClick={() => {
                if (!signatureFile) {
                  alert("서명을 완료해주세요.")
                  return
                }
                handleSubmit(signatureFile)
              }}
              disabled={isSubmitting || !signatureFile}
              className="w-full rounded-[5px] bg-[#f29219] py-3 text-sm font-semibold text-white transition-colors hover:bg-[#d98215] active:bg-[#bf7312] disabled:opacity-50"
            >
              {isSubmitting ? "등록 중..." : "정기결제 신청"}
            </button>
          </section>
        </main>
      </div>
    </div>
  )
}

interface SignaturePadProps {
  onSignatureComplete?: (file: File | null) => void
}

function SignaturePad({ onSignatureComplete }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasSignature, setHasSignature] = useState(false)
  const [isConfirmed, setIsConfirmed] = useState(false)

  // Canvas 초기화
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // Canvas 크기 설정
    const setCanvasSize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1

      // 실제 Canvas 크기 (고해상도 지원)
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr

      // 표시 크기
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`

      // Context 스케일 조정
      ctx.scale(dpr, dpr)

      // 배경색 채우기
      ctx.fillStyle = "#fff7e5"
      ctx.fillRect(0, 0, rect.width, rect.height)
    }

    setCanvasSize()

    // Canvas 스타일 설정
    ctx.strokeStyle = "#000000"
    ctx.lineWidth = 2
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
  }, [])

  // 그리기 시작
  const startDrawing = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    setIsDrawing(true)
    setHasSignature(true)

    const rect = canvas.getBoundingClientRect()
    // ctx.scale이 적용되어 있으므로 원래 좌표 사용
    const x =
      "touches" in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left
    const y =
      "touches" in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top

    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  // 그리기 중
  const draw = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    if (!isDrawing) return

    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const rect = canvas.getBoundingClientRect()
    // ctx.scale이 적용되어 있으므로 원래 좌표 사용
    const x =
      "touches" in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left
    const y =
      "touches" in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top

    ctx.lineTo(x, y)
    ctx.stroke()
  }

  // 그리기 종료
  const stopDrawing = () => {
    setIsDrawing(false)
  }

  // 서명 초기화
  const clearSignature = () => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasSignature(false)
    setIsConfirmed(false)
    if (onSignatureComplete) {
      onSignatureComplete(null)
    }
  }

  // 서명 확인 및 이미지 변환
  const confirmSignature = () => {
    const canvas = canvasRef.current
    if (!canvas || !hasSignature) {
      alert("서명을 먼저 작성해주세요.")
      return
    }

    try {
      // Canvas가 비어있는지 확인
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        alert("Canvas 컨텍스트를 가져올 수 없습니다.")
        return
      }

      // Canvas를 PNG 이미지로 변환
      canvas.toBlob(
        (blob) => {
          if (blob && blob.size > 0) {
            const file = new File([blob], "signature.png", {
              type: "image/png",
            })
            console.log("서명 파일 생성:", {
              name: file.name,
              size: file.size,
              type: file.type,
            })
            setIsConfirmed(true)
            if (onSignatureComplete) {
              onSignatureComplete(file)
            }
          } else {
            console.error("Blob이 비어있거나 생성 실패:", blob)
            alert("서명 이미지 변환에 실패했습니다.")
          }
        },
        "image/png",
        1.0
      )
    } catch (error) {
      console.error("서명 이미지 변환 오류:", error)
      alert("서명 이미지 변환 중 오류가 발생했습니다.")
    }
  }

  return (
    // Card Container: 반응형 너비(max-w) 및 그림자 적용
    <div
      className="flex w-full max-w-[303px] flex-col gap-4 rounded-[10px] bg-white p-5 md:p-6"
      style={{ boxShadow: "0px 4px 4px 0 rgba(0,0,0,0.25)" }}
    >
      {/* Signature Canvas Area */}
      <div className="relative h-[156px] w-full overflow-hidden rounded-[5px] bg-[#fff7e5]">
        {/* Canvas */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />

        {/* Placeholder Text */}
        {!hasSignature && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="text-[13px] text-[#c0c0c0]">여기에 서명하세요</p>
          </div>
        )}

        {/* Reset Button: 서명 초기화 아이콘 */}
        {hasSignature && !isConfirmed && (
          <button
            type="button"
            onClick={clearSignature}
            aria-label="서명 초기화"
            className="absolute right-3 bottom-3 z-10 rounded-full bg-white/90 p-1.5 shadow-md transition-colors hover:bg-white"
          >
            <RotateCcw className="h-5 w-5 text-[#A86500]" strokeWidth={2} />
          </button>
        )}

        {/* 확인 완료 표시 */}
        {isConfirmed && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-green-50/50">
            <p className="text-[13px] font-medium text-green-600">
              서명이 완료되었습니다
            </p>
          </div>
        )}
      </div>

      {/* Confirm Button */}
      {!isConfirmed && (
        <button
          type="button"
          onClick={confirmSignature}
          disabled={!hasSignature}
          className="flex w-full items-center justify-center rounded-[5px] bg-[#f29219] py-2.5 text-xs font-medium text-white transition-colors hover:bg-[#d98215] active:bg-[#bf7312] disabled:cursor-not-allowed disabled:opacity-50"
        >
          확인
        </button>
      )}
    </div>
  )
}
