"use client"

import { ScrollRow } from "@/components/shared/scroll-row"
import { cn } from "@/lib/utils"
import { useState } from "react"
import { BrandTile } from "./brand-tile"

export interface BrandStripBrand {
  id: string
  name: string
  href: string
  thumbnailUrl: string | null
}

export interface BrandStripGroup {
  id: string
  /** 무명 그룹(직계 브랜드 묶음)이면 null — 탭 라벨은 allLabel 을 쓴다 */
  name: string | null
  brands: BrandStripBrand[]
}

interface BrandStripProps {
  groups: BrandStripGroup[]
  /** 그룹이 있어 탭을 보여줘야 하는가 (selectBrandTiles.hasGroups) */
  showTabs: boolean
  labels: { prev: string; next: string; ariaLabel: string; all: string }
}

/**
 * 브랜드 타일 가로 스트립. 브랜드관이 중간 그룹(래쉬브랜드관…)을 갖는 구조면
 * 그룹 칩 탭으로 전환하고, 지금처럼 flat 구조면 탭 없이 한 줄만 보여준다.
 */
export function BrandStrip({ groups, showTabs, labels }: BrandStripProps) {
  const [activeId, setActiveId] = useState(groups[0]?.id ?? "")
  const active = groups.find((g) => g.id === activeId) ?? groups[0]

  if (!active) return null

  return (
    <div>
      {showTabs && groups.length > 1 && (
        <div className="scrollbar-hide mb-4 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {groups.map((group) => (
            <button
              key={group.id}
              type="button"
              onClick={() => setActiveId(group.id)}
              className={cn(
                "h-8 shrink-0 rounded-full px-3 text-[13px] font-medium transition-colors",
                group.id === active.id
                  ? "bg-foreground text-white"
                  : "bg-secondary text-foreground"
              )}
            >
              {group.name ?? labels.all}
            </button>
          ))}
        </div>
      )}

      <ScrollRow
        ariaLabel={labels.ariaLabel}
        labels={{ prev: labels.prev, next: labels.next }}
        className="grid auto-cols-max grid-flow-col gap-3 px-0.5 py-1 md:gap-5"
      >
        {active.brands.map((brand) => (
          <BrandTile
            key={brand.id}
            name={brand.name}
            href={brand.href}
            thumbnailUrl={brand.thumbnailUrl}
          />
        ))}
      </ScrollRow>
    </div>
  )
}
