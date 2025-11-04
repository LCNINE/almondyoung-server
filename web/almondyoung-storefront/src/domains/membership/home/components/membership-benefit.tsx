import { ChevronRight } from "lucide-react"

interface MembershipBenefit {
  id: string
  icon: string
  title: string
}

const MEMBERSHIP_BENEFITS: MembershipBenefit[] = [
  {
    id: "1",
    icon: "image.png",
    title: "원가에 가까운 최저가, 멤버십 할인가",
  },
  {
    id: "2",
    icon: "image-2.png",
    title: "무조건 100원 웰컴 딜!",
  },
  {
    id: "3",
    icon: "image-5.png",
    title: "무료 디지털 템플릿 제공",
  },
  {
    id: "4",
    icon: "image-3.png",
    title: "매월 이달의 쿠폰 제공",
  },
  {
    id: "5",
    icon: "image-4.png",
    title: "예약관리 어플 '다뷰' 무료 사용 및 연동",
  },
  {
    id: "6",
    icon: "image-6.png",
    title: "내 구매주기 완벽 분석, 자동 주문",
  },
  {
    id: "7",
    icon: "image-7.png",
    title: "아몬드영플레이 콘텐츠 무료 시청",
  },
  {
    id: "8",
    icon: "image-8.png",
    title: "이벤트 및 프로모션 추가 혜택 제공",
  },
]

/**
 * MembershipBenefitsHorizontal - 멤버십 혜택 (가로 레이아웃)
 *
 * 시맨틱 구조:
 * - section: 혜택 영역
 * - ul: 혜택 목록
 * - li: 각 혜택 아이템
 *  멤버십이 신청되어있는 상태이고 데스크탑시에 뜨는 레이아웃
 */
export default function MembershipBenefitsHorizontal() {
  return (
    <section className="rounded-[10px] border border-gray-200 p-8">
      {/* Benefits List - Grid 레이아웃 */}
      <ul className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {MEMBERSHIP_BENEFITS.map((benefit) => (
          <li key={benefit.id}>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 rounded-lg p-2 transition-colors hover:bg-gray-50"
            >
              {/* Icon + Title */}
              <div className="flex items-center gap-3">
                <figure className="shrink-0">
                  <img
                    src={benefit.icon}
                    alt=""
                    className="h-[26px] w-[26px] object-cover"
                  />
                </figure>
                <span className="text-left text-base text-black">
                  {benefit.title}
                </span>
              </div>

              {/* Arrow Icon */}
              <ChevronRight
                className="h-6 w-6 shrink-0 text-[#1e1e1e]"
                strokeWidth={1.5}
              />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * 대안: Flex-wrap 버전 (고정 너비 유지)
 */
export function MembershipBenefitsFlexWrap() {
  return (
    <section className="rounded-[10px] border border-gray-200 px-20 py-8">
      <ul className="flex flex-wrap justify-center gap-6">
        {MEMBERSHIP_BENEFITS.map((benefit) => (
          <li key={benefit.id} className="w-full max-w-[310px]">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 rounded-lg p-2 transition-colors hover:bg-gray-50"
            >
              <div className="flex items-center gap-3">
                <figure className="shrink-0">
                  <img
                    src={benefit.icon}
                    alt=""
                    className="h-[26px] w-[26px] object-cover"
                  />
                </figure>
                <span className="text-left text-base text-black">
                  {benefit.title}
                </span>
              </div>

              <ChevronRight
                className="h-6 w-6 shrink-0 text-[#1e1e1e]"
                strokeWidth={1.5}
              />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * 대안: 스크롤 가능한 가로 목록
 */
export function MembershipBenefitsScrollable() {
  return (
    <section className="rounded-[10px] border border-gray-200 px-8 py-8">
      <div className="overflow-x-auto">
        <ul className="flex gap-6 pb-4">
          {MEMBERSHIP_BENEFITS.map((benefit) => (
            <li key={benefit.id} className="max-w-[310px] min-w-[280px]">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-lg p-2 transition-colors hover:bg-gray-50"
              >
                <div className="flex items-center gap-3">
                  <figure className="shrink-0">
                    <img
                      src={benefit.icon}
                      alt=""
                      className="h-[26px] w-[26px] object-cover"
                    />
                  </figure>
                  <span className="text-left text-base text-black">
                    {benefit.title}
                  </span>
                </div>

                <ChevronRight
                  className="h-6 w-6 shrink-0 text-[#1e1e1e]"
                  strokeWidth={1.5}
                />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
