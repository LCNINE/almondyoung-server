"use client"

import { ChevronDown } from "lucide-react"
import { useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import "intl-tel-input/styles"

const IntlTelInput = dynamic(() => import("intl-tel-input/reactWithUtils"), {
  ssr: false,
})

interface PhoneVerifyFormProps {
  onComplete?: () => void
}

export default function PhoneVerifyForm({ onComplete }: PhoneVerifyFormProps) {
  const router = useRouter()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // 비즈니스 로직은 추후 구현
    if (onComplete) {
      onComplete()
    } else {
      // 독립적으로 사용될 때
      alert("본인인증이 완료되었습니다 (임시)")
      router.push("/kr/mypage/payment-methods")
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-12 pt-24 pb-8">
      {/* Title Section */}
      <section className="px-8">
        <h1 className="text-center font-['Pretendard'] text-xl leading-7 font-bold text-black">
          안전한 결제를 위해
          <br />
          고객님의 정보를 확인할게요.
        </h1>
      </section>

      {/* Benefit Section */}
      <section className="px-8">
        <p className="text-center font-['Pretendard'] text-xl leading-7 font-bold text-black">
          혜택노출
        </p>
      </section>

      {/* Form Section */}
      <section className="px-8">
        <div className="flex flex-col gap-8">
          {/* Name Input */}
          <div className="flex flex-col">
            <input
              type="text"
              placeholder="이름"
              className="border-b border-neutral-400 bg-transparent px-4 py-3 font-['Noto_Sans_KR'] text-xs leading-5 text-neutral-400 outline-none focus:border-black focus:text-black"
            />
          </div>

          {/* Birthday Inputs */}
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <input
                type="text"
                placeholder="생년월일(6자리)"
                maxLength={6}
                className="w-full border-b border-neutral-400 bg-transparent px-4 py-3 font-['Noto_Sans_KR'] text-xs leading-5 text-neutral-400 outline-none focus:border-black focus:text-black"
              />
            </div>
            <span className="font-['Noto_Sans_KR'] text-xs leading-5 text-black">
              -
            </span>
            <div className="flex-1">
              <input
                type="text"
                placeholder="0 * * * * * *"
                maxLength={7}
                className="w-full border-b border-neutral-400 bg-transparent px-4 py-3 font-['Noto_Sans_KR'] text-xs leading-5 text-neutral-400 outline-none focus:border-black focus:text-black"
              />
            </div>
          </div>

          {/* Carrier Select */}
          <div className="relative">
            <select className="text-Text-Default-Default border-Border-Default-Default w-full appearance-none border bg-white py-3 pr-10 pl-4 font-['Pretendard'] text-xs leading-4 outline-none">
              <option>통신사 선택</option>
              <option>SKT</option>
              <option>KT</option>
              <option>LG U+</option>
            </select>
            <ChevronDown
              size={16}
              className="text-Icon-Default-Default pointer-events-none absolute top-1/2 right-3 -translate-y-1/2"
            />
          </div>

          {/* Phone Input */}
          <div className="flex flex-col">
            <IntlTelInput
              initialValue=""
              inputProps={{
                placeholder: "휴대폰번호 (숫자만 입력하세요)",
                className:
                  "w-full border-b border-neutral-400 bg-transparent px-4 py-3 font-['Noto_Sans_KR'] text-xs leading-5 text-neutral-400 outline-none focus:border-black focus:text-black",
              }}
              initOptions={{
                initialCountry: "kr",
              }}
            />
          </div>
        </div>
      </section>

      {/* Submit Button Section */}
      <section className="px-8">
        <button
          type="submit"
          className="w-full rounded-[5px] bg-amber-500/40 px-4 py-3 text-center font-['Noto_Sans_KR'] text-sm leading-5 text-white"
        >
          인증 요청
        </button>
      </section>
    </form>
  )
}
