"use client"

import { Badge } from "@/components/ui/badge"
import BenefitListItem from "./benefit-list-item"
import { CURRENT_BENEFITS } from "./benefits-data"

interface BenefitOverviewSectionProps {
  onBenefitClick?: (benefitId: string) => void
}

export default function BenefitOverviewSection({
  onBenefitClick,
}: BenefitOverviewSectionProps) {
  return (
    <section className="py-12">
      <div className="mb-8 flex flex-col items-center gap-4">
        <Badge
          variant="outline"
          className="border-white/40 bg-transparent px-3 py-1 text-xs text-white"
        >
          MEMBERSHIP BENEFITS
        </Badge>
        <h2 className="text-center text-2xl font-bold md:text-3xl">
          <span className="text-white">한 눈에 보는 </span>
          <span className="text-[#f29219]">멤버십 혜택</span>
        </h2>
        <p className="text-center text-sm text-white/60">
          각 혜택명을 클릭하시면
          <br />
          상세 혜택을 보실 수 있습니다.
        </p>
        <span className="text-lg text-white/40">▽</span>
      </div>

      <div className="space-y-2">
        {CURRENT_BENEFITS.map((benefit) => (
          <BenefitListItem
            key={benefit.id}
            benefit={benefit}
            onClick={() => onBenefitClick?.(benefit.id)}
          />
        ))}
      </div>
    </section>
  )
}
