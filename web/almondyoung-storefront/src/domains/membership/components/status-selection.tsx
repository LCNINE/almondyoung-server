import React from "react"
import Image from "next/image"
// --- 1. 비가입자용 프로모션 배너 (이전 리팩토링) ---
function MembershipPromoBanner() {
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

      {/* 1-3. Billing Toggle (UI) */}
      <div
        className="flex items-center rounded-full bg-gray-200 p-1"
        role="group"
        aria-label="결제 주기 선택"
      >
        <button
          className={`rounded-full px-4 py-1.5 text-xs font-medium ${!isYearly ? "bg-white text-black shadow-sm" : "text-gray-700"}`}
          aria-pressed={!isYearly}
        >
          월간
        </button>
        <button
          className={`flex items-baseline gap-1 rounded-full px-4 py-1.5 ${isYearly ? "bg-white shadow-sm" : "text-gray-700"}`}
          aria-pressed={isYearly}
        >
          <span
            className={`text-xs font-medium ${isYearly ? "text-black" : "text-gray-700"}`}
          >
            연간
          </span>
          <span className="text-[10px] font-medium text-pink-600">
            1달 무료
          </span>
        </button>
      </div>
    </section>
  )
}

function MemberDetails() {
  // -- 대시보드용 StatCard (Helper Component) --
  function StatCard({
    label,
    value,
    unit,
  }: {
    label: string
    value: string
    unit: string
  }) {
    return (
      <article className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl bg-amber-50 py-4">
        <h3 className="text-center text-xs font-normal text-gray-800">
          {label}
        </h3>
        <div className="flex items-baseline justify-center gap-1">
          <span className="text-lg font-bold text-black">{value}</span>
          <span className="text-xs leading-4 text-gray-900">{unit}</span>
        </div>
      </article>
    )
  }
  // -- 대시보드용 데이터 --
  const secondaryStats = [
    {
      id: "coupons",
      label: "이번달 발급받은 쿠폰",
      value: "3",
      unit: "개 발급받았어요",
    },
    {
      id: "referrals",
      label: "이번달 추천인 적립금",
      value: "1,430",
      unit: "원",
    },
  ]

  // -- 렌더링 --
  return (
    <div className="flex w-full flex-col items-center gap-4">
      {/* 1. 계정 상태 및 플랜 관리 */}
      <figcaption className="text-center font-['Pretendard'] text-sm font-normal text-black">
        다음 결제 예정일은 <strong>2025년 6월 8일</strong> 입니다
      </figcaption>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-md bg-yellow-100 px-2 py-1">
            <span className="text-xs font-bold text-yellow-700">
              (멤버십 태그)
            </span>
          </div>
          <div className="flex h-5 items-center justify-center rounded-md bg-indigo-100 px-2">
            <span className="text-xs leading-3 font-bold text-indigo-500">
              PRO
            </span>
          </div>
        </div>
        <button
          type="button"
          className="text-xs font-medium text-amber-500 underline"
        >
          변경
        </button>
      </div>

      {/* 2. 구분선 */}
      <hr className="w-full border-t border-gray-200" />

      {/* 3. 통계 대시보드 (이제 이 컴포넌트의 일부) */}
      <article className="flex w-full flex-col justify-center gap-2 rounded-xl bg-amber-50 py-6">
        <h3 className="text-center text-sm font-normal text-gray-800">
          이번달 멤버십으로 절약한 금액
        </h3>
        <div className="flex items-end justify-center gap-1">
          <span className="text-2xl font-bold text-black">50,430</span>
          <span className="text-xs leading-5 text-gray-900">원</span>
        </div>
      </article>

      <div className="flex w-full flex-col items-stretch gap-4 md:flex-row">
        {secondaryStats.map((stat) => (
          <StatCard key={stat.id} {...stat} />
        ))}
      </div>
    </div>
  )
}

export default function MembershipStatusSection() {
  const isMember = false // (상태값)

  return (
    <section className="flex flex-col items-center gap-8 self-stretch rounded-xl border-gray-200 py-10 md:border md:px-6">
      {/* 공통 UI: 로고 */}
      <header className="flex flex-col items-center gap-3 text-center">
        <figure className="flex flex-col items-center gap-2">
          <Image
            src="/icons/membership-logo.svg"
            alt="멤버십 로고"
            width={64}
            height={64}
          />
        </figure>
      </header>

      {/* 조건부 렌더링 */}
      {isMember ? <MemberDetails /> : <MembershipPromoBanner />}
    </section>
  )
}
