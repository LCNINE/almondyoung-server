"use client"
import { ChevronDown } from "lucide-react"
import { useRouter } from "next/navigation"

export default function UserVerificationForm() {
  const router = useRouter()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // 비즈니스 로직은 추후 구현
    // 임시로 인증 완료 후 결제수단 관리로 돌아감
    alert("본인인증이 완료되었습니다 (임시)")
    router.push("/kr/mypage/payment-methods")
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-12 pt-24 pb-8">
      {/* Avatar Section - 좌우 여백 다름 */}
      <section className="px-14">
        <div className="flex justify-center gap-4">
          <div className="h-12 w-12 overflow-hidden rounded-full bg-gradient-to-b from-zinc-900 to-zinc-950">
            <div className="mt-[30.55px] ml-[7.52px] h-4 w-8 bg-gradient-to-b from-stone-500 to-stone-600" />
            <div className="mt-[2.82px] ml-[7.04px] h-3.5 w-8 bg-slate-950 opacity-40" />
            <div className="-mt-[33.96px] ml-[25.65px] h-2 w-2.5 bg-gradient-to-l from-orange-400 to-orange-400" />
            <div className="mt-[4.30px] ml-[28.40px] h-1 w-1.5 bg-orange-400 opacity-60 mix-blend-multiply" />
            <div className="-mt-[6.69px] ml-[11.13px] h-5 w-6 bg-gradient-to-l from-orange-400 to-orange-400" />
            <div className="mt-[7.65px] ml-[14.74px] h-5 w-4 bg-gradient-to-b from-orange-200 to-red-200" />
            <div className="mt-[12.32px] ml-[20.03px] h-1 w-1.5 origin-top-left -rotate-2 bg-red-300" />
            <div className="mt-[3.90px] ml-[17.92px] h-1.5 w-3 bg-stone-50" />
            <div className="-mt-[27.90px] ml-[24.64px] h-6 w-[5.12px] bg-gradient-to-l from-orange-400 to-orange-400" />
          </div>

          <div className="h-12 w-12 overflow-hidden rounded-full bg-gradient-to-b from-stone-500 to-stone-600">
            <div className="mt-[5.01px] ml-[6.23px] h-7 w-8 origin-top-left rotate-2 bg-gradient-to-b from-zinc-900 to-zinc-950" />
            <div className="-mt-[19.63px] ml-[17.03px] h-6 w-4 bg-gradient-to-b from-orange-400 to-orange-400" />
            <div className="mt-[7.14px] ml-[22.46px] h-1 w-1.5 origin-top-left rotate-2 bg-gradient-to-b from-orange-400 to-orange-400 opacity-70 mix-blend-multiply" />
            <div className="mt-[5.44px] ml-[7.52px] h-4 w-8 bg-gradient-to-l from-orange-200 to-red-200" />
            <div className="-mt-[3.95px] ml-[7.37px] h-4 w-3.5 bg-gradient-to-l from-orange-50 to-stone-50" />
          </div>

          <div className="h-16 w-16 overflow-hidden rounded-full bg-gradient-to-l from-orange-200 to-red-200">
            <div className="mt-[6.93px] ml-[8.50px] h-10 w-10 origin-top-left rotate-2 bg-gradient-to-l from-orange-400 to-orange-400" />
            <div className="-mt-[38.10px] ml-[22.66px] h-4 w-2 bg-gradient-to-b from-zinc-900 to-zinc-950" />
            <div className="mt-[8.29px] ml-[23.07px] h-9 w-5 bg-gradient-to-b from-orange-100 to-orange-100" />
            <div className="mt-[18.17px] ml-[30.42px] h-[5.17px] w-2 origin-top-left rotate-2 bg-red-200 mix-blend-multiply" />
            <div className="mt-[8.91px] ml-[10.18px] h-5 w-11 bg-gradient-to-b from-slate-900 to-slate-950" />
          </div>

          <div className="h-12 w-12 overflow-hidden rounded-full bg-gradient-to-b from-stone-500 to-stone-600">
            <div className="mt-[6.56px] ml-[7.86px] h-10 w-8 bg-white" />
            <div className="mt-[15.74px] ml-[8.15px] h-5 w-9 bg-gradient-to-l from-orange-200 to-red-200" />
            <div className="-mt-[27.17px] ml-[15.39px] h-5 w-4 bg-gradient-to-b from-orange-400 to-orange-300" />
            <div className="mt-[13.18px] ml-[21.84px] h-1 w-1.5 bg-gradient-to-b from-orange-400 to-orange-400 opacity-60 mix-blend-multiply" />
            <div className="mt-[3.99px] ml-[19.41px] h-1.5 w-3.5 bg-gradient-to-b from-slate-900 to-slate-950" />
          </div>

          <div className="h-12 w-12 overflow-hidden rounded-full bg-gradient-to-b from-zinc-900 to-zinc-950">
            <div className="mt-[31.17px] ml-[7.99px] h-5 w-9 bg-gradient-to-l from-orange-400 to-orange-400" />
            <div className="-mt-[24.61px] ml-[11.95px] h-6 w-7 bg-white" />
            <div className="mt-[8.55px] ml-[18.62px] h-5 w-4 bg-gradient-to-b from-orange-300 to-orange-200" />
            <div className="mt-[11.81px] ml-[23.63px] h-1 w-1.5 bg-orange-400" />
            <div className="mt-[4.25px] ml-[19.04px] h-1.5 w-3 bg-gradient-to-l from-orange-50 to-stone-50" />
          </div>
        </div>
      </section>

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
            <input
              type="tel"
              placeholder="휴대폰번호 (숫자만 입력하세요)"
              className="border-b border-neutral-400 bg-transparent px-4 py-3 font-['Noto_Sans_KR'] text-xs leading-5 text-neutral-400 outline-none focus:border-black focus:text-black"
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
