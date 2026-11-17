"use client"

import { TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel"
import { cn } from "@/lib/utils"

interface TabItem {
  id: string
  name: string
}

interface ResponsiveTabListProps {
  items: readonly TabItem[]
  activeId: string
  onTabChange: (id: string) => void
}

const CAROUSEL_OPTIONS = {
  align: "start",
  dragFree: true,
  containScroll: "trimSnaps",
} as const

export function ResponsiveTabList({
  items,
  activeId,
  onTabChange,
}: ResponsiveTabListProps) {
  return (
    <div className="mb-8">
      {/* 모바일: Carousel */}
      <Carousel opts={CAROUSEL_OPTIONS} className="w-full md:hidden">
        <CarouselContent className="-ml-2">
          {items.map((item, index) => (
            <CarouselItem
              key={item.id}
              className={cn("basis-auto", index === 0 ? "pl-0" : "pl-2")}
            >
              <TabButton
                isActive={activeId === item.id}
                onClick={() => onTabChange(item.id)}
              >
                {item.name}
              </TabButton>
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>

      {/* 데스크톱: TabsList */}
      <TabsList variant="line" className="mx-auto hidden w-fit gap-2 md:flex">
        {items.map((item) => (
          <TabsTrigger
            key={item.id}
            value={item.id}
            className="text-muted-foreground data-[state=active]:after:bg-primary px-2 py-1 text-sm font-medium data-[state=active]:text-black"
          >
            {item.name}
          </TabsTrigger>
        ))}
      </TabsList>
    </div>
  )
}

function TabButton({
  isActive,
  onClick,
  children,
}: {
  isActive: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative px-2 py-1 text-sm font-medium transition-colors",
        isActive
          ? "after:bg-primary text-black after:absolute after:inset-x-0 after:bottom-0 after:h-0.5"
          : "text-muted-foreground"
      )}
    >
      {children}
    </button>
  )
}
