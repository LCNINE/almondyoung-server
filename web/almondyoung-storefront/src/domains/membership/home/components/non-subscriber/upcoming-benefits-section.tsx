"use client"

import BenefitListItem from "./benefit-list-item"
import { UPCOMING_BENEFITS } from "./benefits-data"

export default function UpcomingBenefitsSection() {
  return (
    <section className="py-12">
      <div className="mb-8 flex flex-col items-center gap-4">
        <h2 className="text-center text-2xl font-bold md:text-3xl">
          <span className="text-white">곧 만날 </span>
          <span className="text-[#f29219]">출시 예정 혜택</span>
        </h2>
        <p className="text-center text-sm text-white/60">
          더 많은 혜택이 준비되어 있습니다
        </p>
      </div>

      <div className="space-y-2">
        {UPCOMING_BENEFITS.map((benefit) => (
          <BenefitListItem key={benefit.id} benefit={benefit} />
        ))}
      </div>
    </section>
  )
}
