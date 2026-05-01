import { ChevronRight } from "lucide-react"

interface MembershipBenefit {
  id: string
  icon?: string
  title: string
}

interface MembershipPlanCardProps {
  planName: string
  price: number
  period: string
  monthlyPrice: string
  discountRate: string
  benefitText?: string
  benefits: MembershipBenefit[]
  /** 헤더 색상 variant */
  variant?: "basic" | "annual" | "pro"
}


/**
 * MembershipPlanCard - 멤버십 플랜 카드
 *
 * 시맨틱 구조:
 * - article: 독립적인 플랜 카드 (최대 너비 333px)
 * - header: 가격 정보 (variant별 색상)
 * - ul/li: 혜택 목록
 *
 * Variant:
 * - basic: 월간 플랜 (bg-[#2c2c2e] 어두운 회색)
 * - annual: 연간 플랜 (bg-[#2c2c2e] 어두운 회색)
 * - pro: Pro 플랜 (bg-[#007aff] 파란색)
 */
export default function MembershipPlanCard({
  planName = "연간",
  price = 54890,
  period = "12개월(연간구독)",
  monthlyPrice = "4,574원",
  discountRate = "약 21% 절감",
  benefitText,
  benefits = [],
  variant = "annual",
}: Partial<MembershipPlanCardProps> = {}) {
  // Pro일 때만 파란색, 나머지는 검은색
  const headerBgColor = variant === "pro" ? "bg-[#007aff]" : "bg-[#2c2c2e]"

  return (
    <article className="mx-auto flex w-full max-w-[473px] flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
      {/* Header - 가격 정보 (연간 버전 레이아웃 기준) */}
      <header className={`flex flex-col gap-2.5 p-5 ${headerBgColor}`}>
        {/* 플랜명 + 가격 */}
        <div className="flex items-center gap-[13px]">
          <h2 className="text-[19px] font-bold text-white">{planName}</h2>
          <p className="text-white">
            <span className="text-lg font-semibold text-white">
              {price.toLocaleString()}
            </span>
            <span className="text-sm text-white">
              {" "}
              원 /{period} 월 {monthlyPrice}{" "}
            </span>
          </p>
        </div>

        {/* 할인 뱃지 + 혜택 안내 */}
        <div className="flex items-center gap-3.5">
          <div className="flex items-center justify-center gap-2.5 rounded-full bg-[#ffa500] px-2 py-0.5">
            <p className="text-sm text-[#2c2c2e]">{discountRate}</p>
          </div>
          {benefitText && <p className="text-sm text-white">{benefitText}</p>}
        </div>
      </header>

      {/* Benefits List */}
      <ul className="flex flex-col gap-[30px] border-t border-gray-200 px-[25px] py-[35px]">
        {benefits.length > 0 ? (
          benefits.map((benefit) => (
            <li key={benefit.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 transition-colors hover:bg-gray-50"
              >
                {/* Icon + Title */}
                <div className="flex items-center gap-3">
                  {benefit.icon ? (
                    <figure className="shrink-0">
                      <img
                        src={benefit.icon}
                        alt=""
                        className="h-[26px] w-[26px] object-cover"
                      />
                    </figure>
                  ) : (
                    <span className="h-[10px] w-[10px] shrink-0 rounded-full bg-gray-300" />
                  )}
                  <span className="text-base text-black">{benefit.title}</span>
                </div>

                {/* Arrow Icon */}
                <ChevronRight
                  className="h-6 w-6 shrink-0 text-[#1e1e1e]"
                  strokeWidth={1.5}
                />
              </button>
            </li>
          ))
        ) : (
          <li className="text-sm text-gray-500">혜택 정보가 없습니다.</li>
        )}
      </ul>
    </article>
  )
}
