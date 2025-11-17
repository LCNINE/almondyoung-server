import React from "react"

/**
 * 멤버십 가입자 상세 정보
 *
 * 가입자에게 보여지는 정보:
 * - 다음 결제 예정일
 * - 멤버십 태그 및 플랜
 * - 이번달 절약 금액
 * - 통계 정보
 */
export default function MemberDetails() {
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
