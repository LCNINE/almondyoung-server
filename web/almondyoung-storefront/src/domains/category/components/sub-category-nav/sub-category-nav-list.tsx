"use client"

import { motion, useReducedMotion } from "framer-motion"
import { useState } from "react"
import { CategoryThumbnail } from "@/domains/category/components/category-thumbnail"

export interface SubCategoryNavItem {
  id: string
  name: string
  href: string
  imageUrl: string | null
}

export function SubCategoryNavList({ items }: { items: SubCategoryNavItem[] }) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const reduceMotion = useReducedMotion()

  // hover/focus 가 빠질 때 현재 활성 카드만 해제 (다른 카드로 이미 넘어갔으면 유지)
  const clear = (id: string) => setActiveId((cur) => (cur === id ? null : cur))

  return (
    <div className="relative isolate flex flex-wrap gap-1">
      {items.map((item) => (
        <div
          key={item.id}
          onMouseEnter={() => setActiveId(item.id)}
          onMouseLeave={() => clear(item.id)}
          onFocus={() => setActiveId(item.id)}
          onBlur={() => clear(item.id)}
          className="relative rounded-2xl px-4 pt-4 pb-3 transition-transform duration-300 ease-out focus-within:-translate-y-1.5 hover:-translate-y-1.5"
        >
          {/* hover한 카드를 스프링으로 따라가는 글래스 백드롭 */}
          {activeId === item.id && (
            <motion.span
              layoutId="subcategory-hover-glass"
              aria-hidden
              className="absolute inset-0 -z-10 rounded-2xl border border-black/5 bg-gray-100/70 shadow-sm backdrop-blur-[2px]"
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { type: "spring", stiffness: 360, damping: 24, mass: 0.7 }
              }
            />
          )}
          <CategoryThumbnail
            name={item.name}
            href={item.href}
            imageUrl={item.imageUrl}
            variant="circle"
          />
        </div>
      ))}
    </div>
  )
}
