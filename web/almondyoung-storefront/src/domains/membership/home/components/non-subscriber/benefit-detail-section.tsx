"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { CURRENT_BENEFITS } from "./benefits-data"

export default function BenefitDetailSection() {
  return (
    <section className="py-12">
      <div className="flex flex-col items-center gap-4 mb-8">
        <h2 className="text-2xl md:text-3xl font-bold text-center">
          <span className="text-white">상세 </span>
          <span className="text-[#f29219]">혜택 안내</span>
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {CURRENT_BENEFITS.map((benefit) => (
          <Card
            key={benefit.id}
            id={benefit.id}
            className="bg-zinc-800 border-white/10 scroll-mt-24"
          >
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <span className="text-[#f29219] text-lg font-bold">
                  {benefit.number}
                </span>
                <CardTitle className="text-white text-base">
                  {benefit.title}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-white/70 text-sm leading-relaxed">
                {benefit.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}
