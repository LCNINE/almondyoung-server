import { ChevronRight } from "lucide-react"

interface MembershipBenefit {
  id: string
  icon?: string
  title: string
}

interface MembershipBenefitsProps {
  benefits: MembershipBenefit[]
}

/**
 * MembershipBenefitsHorizontal - 멤버십 혜택 (가로 레이아웃)
 *
 * 시맨틱 구조:
 * - section: 혜택 영역
 * - ul: 혜택 목록
 * - li: 각 혜택 아이템
 *  멤버십이 신청되어있는 상태이고 데스크탑시에 뜨는 레이아웃
 */
export default function MembershipBenefitsHorizontal({
  benefits,
}: MembershipBenefitsProps) {
  return (
    <section className="rounded-[10px] border border-gray-200 p-8">
      {/* Benefits List - Grid 레이아웃 */}
      <ul className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {benefits.length > 0 ? (
          benefits.map((benefit) => (
            <li key={benefit.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-lg p-2 transition-colors hover:bg-gray-50"
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
          ))
        ) : (
          <li className="text-sm text-gray-500">혜택 정보가 없습니다.</li>
        )}
      </ul>
    </section>
  )
}

/**
 * 대안: Flex-wrap 버전 (고정 너비 유지)
 */
export function MembershipBenefitsFlexWrap({ benefits }: MembershipBenefitsProps) {
  return (
    <section className="rounded-[10px] border border-gray-200 px-20 py-8">
      <ul className="flex flex-wrap justify-center gap-6">
        {benefits.length > 0 ? (
          benefits.map((benefit) => (
            <li key={benefit.id} className="w-full max-w-[310px]">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-lg p-2 transition-colors hover:bg-gray-50"
              >
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
          ))
        ) : (
          <li className="text-sm text-gray-500">혜택 정보가 없습니다.</li>
        )}
      </ul>
    </section>
  )
}

/**
 * 대안: 스크롤 가능한 가로 목록
 */
export function MembershipBenefitsScrollable({
  benefits,
}: MembershipBenefitsProps) {
  return (
    <section className="rounded-[10px] border border-gray-200 px-8 py-8">
      <div className="overflow-x-auto">
        <ul className="flex gap-6 pb-4">
          {benefits.length > 0 ? (
            benefits.map((benefit) => (
              <li key={benefit.id} className="max-w-[310px] min-w-[280px]">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 rounded-lg p-2 transition-colors hover:bg-gray-50"
                >
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
            ))
          ) : (
            <li className="text-sm text-gray-500">혜택 정보가 없습니다.</li>
          )}
        </ul>
      </div>
    </section>
  )
}
