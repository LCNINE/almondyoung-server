"use client"

import { ChevronDown, ChevronLeft } from "lucide-react"
import { useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import { useForm } from "react-hook-form"
import { useState, useRef, useEffect } from "react"
import "intl-tel-input/styles"

const IntlTelInput = dynamic(() => import("intl-tel-input/reactWithUtils"), {
  ssr: false,
})

export interface PhoneFormData {
  name: string
  birthDate: string
  phoneNumber: string
  carrier: string
}

interface PhoneVerifyFormProps {
  onComplete?: (data: PhoneFormData) => void
  onBack?: () => void
  initialData?: PhoneFormData | null
}

// 외부 API 호출 함수 (껍데기)
async function verifyPhoneNumber(data: PhoneFormData): Promise<boolean> {
  // TODO: 실제 외부 API 연동 (공공데이터 또는 기타 서비스)
  // 현재는 임시로 성공 처리
  return new Promise((resolve) => {
    setTimeout(() => {
      console.log("휴대폰 인증 API 호출:", data)
      resolve(true)
    }, 500)
  })
}

export default function PhoneVerifyForm({
  onComplete,
  onBack,
  initialData,
}: PhoneVerifyFormProps) {
  const router = useRouter()
  const [phoneNumber, setPhoneNumber] = useState(
    initialData?.phoneNumber || ""
  )
  const phoneInputRef = useRef<any>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setValue,
    watch,
  } = useForm<PhoneFormData>({
    defaultValues: initialData || {
      name: "",
      birthDate: "",
      phoneNumber: "",
      carrier: "",
    },
  })

  // IntlTelInput의 onChange 핸들러
  const handlePhoneChange = (
    isValid: boolean,
    value: string,
    country: any,
    number?: string,
    id?: string,
  ) => {
    // value는 포맷된 값 (예: "010-3333-3333"), number는 국제 형식
    // 숫자만 추출하여 저장
    const cleaned = value.replace(/\D/g, "")
    console.log("Phone change:", { value, cleaned, isValid, number })
    setPhoneNumber(cleaned) // 숫자만 저장
  }

  // phoneNumber state가 변경될 때마다 form에 반영
  useEffect(() => {
    if (phoneNumber) {
      setValue("phoneNumber", phoneNumber, { shouldValidate: true })
    }
  }, [phoneNumber, setValue])

  const onSubmit = async (data: PhoneFormData) => {
    try {
      // IntlTelInput에서 직접 값을 가져오기
      let cleanedPhoneNumber = ""

      if (phoneInputRef.current) {
        // IntlTelInput의 getNumber 메서드로 숫자만 가져오기
        try {
          const number = phoneInputRef.current.getNumber()
          if (number) {
            cleanedPhoneNumber = number.replace(/\D/g, "")
          }
        } catch (e) {
          // getNumber가 없으면 다른 방법 시도
          try {
            const inputElement = phoneInputRef.current.getInput()
            if (inputElement) {
              cleanedPhoneNumber = inputElement.value.replace(/\D/g, "")
            }
          } catch (e2) {
            console.warn("IntlTelInput에서 값을 가져올 수 없습니다:", e2)
          }
        }
      }

      // 여전히 없으면 state나 form data에서 가져오기
      if (!cleanedPhoneNumber) {
        cleanedPhoneNumber = phoneNumber || data.phoneNumber || ""
        cleanedPhoneNumber = cleanedPhoneNumber.replace(/\D/g, "")
      }

      console.log("Submit phone validation:", {
        phoneNumberState: phoneNumber,
        formDataPhone: data.phoneNumber,
        cleanedPhoneNumber,
        length: cleanedPhoneNumber.length,
      })

      const finalData = {
        ...data,
        phoneNumber: cleanedPhoneNumber,
      }

      // phoneNumber 유효성 검사 (한국 휴대폰 번호는 10자리 또는 11자리)
      const phoneLength = cleanedPhoneNumber.length
      if (!cleanedPhoneNumber || (phoneLength !== 10 && phoneLength !== 11)) {
        alert(
          `올바른 휴대폰번호를 입력해주세요. (현재: ${phoneLength}자리, 필요: 10자리 또는 11자리)`,
        )
        return
      }

      // 외부 API 호출 (휴대폰 인증)
      const isValid = await verifyPhoneNumber(finalData)
      if (!isValid) {
        alert("본인인증에 실패했습니다. 정보를 확인해주세요.")
        return
      }

    if (onComplete) {
        onComplete(finalData)
    } else {
      // 독립적으로 사용될 때
      alert("본인인증이 완료되었습니다 (임시)")
      router.push("/kr/mypage/payment-methods")
      }
    } catch (error) {
      console.error("본인인증 오류:", error)
      alert("본인인증 중 오류가 발생했습니다.")
    }
  }

  return (
    <div className="flex min-h-full flex-col bg-white p-4">
      <div className="mb-6 flex items-center gap-2">
        {onBack && (
          <button onClick={onBack} className="p-1 -ml-2">
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        <h1 className="text-2xl font-bold">본인 인증</h1>
      </div>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="flex flex-col gap-12 pt-8 pb-8"
      >
      {/* Title Section */}
        <section className="px-4">
        <h1 className="text-center font-['Pretendard'] text-xl leading-7 font-bold text-black">
          안전한 결제를 위해
          <br />
          고객님의 정보를 확인할게요.
        </h1>
      </section>

      {/* Benefit Section */}
        <section className="px-4">
        <p className="text-center font-['Pretendard'] text-xl leading-7 font-bold text-black">
          혜택노출
        </p>
      </section>

      {/* Form Section */}
        <section className="px-4">
        <div className="flex flex-col gap-8">
          {/* Name Input */}
          <div className="flex flex-col">
            <input
                {...register("name", { required: "이름을 입력해주세요" })}
              type="text"
              placeholder="이름"
              className="border-b border-neutral-400 bg-transparent px-4 py-3 font-['Noto_Sans_KR'] text-xs leading-5 text-neutral-400 outline-none focus:border-black focus:text-black"
            />
              {errors.name && (
                <p className="mt-1 text-xs text-red-500">{errors.name.message}</p>
              )}
          </div>

            {/* Birthday Input */}
            <div className="flex flex-col">
              <input
                {...register("birthDate", {
                  required: "생년월일을 입력해주세요",
                  pattern: {
                    value: /^\d{6}$/,
                    message: "생년월일은 6자리 숫자로 입력해주세요",
                  },
                })}
                type="text"
                placeholder="생년월일(6자리)"
                maxLength={6}
                className="w-full border-b border-neutral-400 bg-transparent px-4 py-3 font-['Noto_Sans_KR'] text-xs leading-5 text-neutral-400 outline-none focus:border-black focus:text-black"
              />
              {errors.birthDate && (
                <p className="mt-1 text-xs text-red-500">
                  {errors.birthDate.message}
                </p>
              )}
          </div>

          {/* Carrier Select */}
          <div className="relative">
              <select
                {...register("carrier", { required: "통신사를 선택해주세요" })}
                className="text-Text-Default-Default border-Border-Default-Default w-full appearance-none border bg-white py-3 pr-10 pl-4 font-['Pretendard'] text-xs leading-4 outline-none"
              >
                <option value="">통신사 선택</option>
                <option value="SKT">SKT</option>
                <option value="KT">KT</option>
                <option value="LG U+">LG U+</option>
            </select>
            <ChevronDown
              size={16}
              className="text-Icon-Default-Default pointer-events-none absolute top-1/2 right-3 -translate-y-1/2"
            />
              {errors.carrier && (
                <p className="mt-1 text-xs text-red-500">
                  {errors.carrier.message}
                </p>
              )}
          </div>

          {/* Phone Input */}
          <div className="flex flex-col">
            <IntlTelInput
                ref={phoneInputRef}
                initialValue={phoneNumber || initialData?.phoneNumber || ""}
              inputProps={{
                placeholder: "휴대폰번호 (숫자만 입력하세요)",
                className:
                  "w-full border-b border-neutral-400 bg-transparent px-4 py-3 font-['Noto_Sans_KR'] text-xs leading-5 text-neutral-400 outline-none focus:border-black focus:text-black",
              }}
              initOptions={{
                initialCountry: "kr",
              }}
                onChange={handlePhoneChange}
            />
              {errors.phoneNumber && (
                <p className="mt-1 text-xs text-red-500">
                  {errors.phoneNumber.message}
                </p>
              )}
          </div>
        </div>
      </section>

      {/* Submit Button Section */}
        <section className="px-4">
        <button
          type="submit"
            disabled={isSubmitting}
            className="w-full rounded-[5px] bg-amber-500 px-4 py-3 text-center font-['Noto_Sans_KR'] text-sm leading-5 text-white disabled:opacity-50"
        >
            {isSubmitting ? "인증 중..." : "인증 요청"}
        </button>
      </section>
    </form>
    </div>
  )
}
