import React from "react"

/**
 * 멤버십 프로모션 배너 (비가입자용)
 *
 * 비가입자에게 보여지는 프로모션 정보:
 * - 멤버십 소개
 * - 결제 주기 선택 (월간/연간)
 */
export default function MembershipPromoBanner() {
  const isYearly = true // (토글 상태는 예시)

  return (
    <section
      className="flex w-full flex-col items-center gap-4 rounded-xl text-center"
      aria-labelledby="promo-title"
    >
      {/* 1-1. Title Group */}
      <div className="flex flex-col">
        <h2
          id="promo-title"
          className="font-['Noto_Sans_KR'] text-lg leading-7 font-bold text-black"
        >
          아몬드영 멤버십
        </h2>
        <p className="font-['Noto_Sans_KR'] text-lg leading-7 text-gray-800">
          지금 가입 시 Pro 2개월 무료 업그레이드
        </p>
      </div>

      {/* 1-2. Description */}
      <p className="text-xs leading-4 font-normal text-gray-700">
        최저가+자동주문으로 운영 스트레스를 덜어보세요
      </p>

      <div
        className="flex items-center rounded-full bg-gray-200 p-1"
        role="group"
        aria-label="결제 주기 선택"
      >
        {/* 월간 */}
        <input
          type="radio"
          id="monthly"
          name="plan"
          className="peer/monthly hidden"
        />
        <label
          htmlFor="monthly"
          className={`cursor-pointer rounded-full px-4 py-1.5 text-xs font-medium text-gray-700 peer-checked/monthly:bg-white peer-checked/monthly:text-black peer-checked/monthly:shadow-sm`}
        >
          월간
        </label>

        {/* 연간 */}
        <input
          type="radio"
          id="yearly"
          name="plan"
          className="peer/yearly hidden"
          defaultChecked
        />
        <label
          htmlFor="yearly"
          className={`flex cursor-pointer items-baseline gap-1 rounded-full px-4 py-1.5 text-gray-700 peer-checked/yearly:bg-white peer-checked/yearly:shadow-sm`}
        >
          <span
            className={`text-xs font-medium peer-checked/yearly:text-black`}
          >
            연간
          </span>
          <span className="text-[10px] font-medium text-pink-600">
            1달 무료
          </span>
        </label>
      </div>
    </section>
  )
}
