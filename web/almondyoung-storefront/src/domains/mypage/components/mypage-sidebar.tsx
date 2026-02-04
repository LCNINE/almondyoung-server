"use client"

import React, { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronDown } from "lucide-react"

import { SIDEBAR_MENU_ITEMS } from "./constants/mypage-constants"
import type { MenuItem } from "../types/sidebar-types"

export default function MypageSidebar({
  menuItems = SIDEBAR_MENU_ITEMS,
  className = "",
}: {
  menuItems?: MenuItem[]
  className?: string
}) {
  const pathname = usePathname()
  const normalizedPathname = pathname.replace(/^\/[a-z]{2}(\/|$)/, "/")

  const isActive = (path: string, exact = false) => {
    if (exact || path === "/mypage") {
      return normalizedPathname === path
    }
    return (
      normalizedPathname === path || normalizedPathname.startsWith(`${path}/`)
    )
  }

  const hasActiveSubItem = (item: MenuItem) =>
    item.subItems?.some((sub) => isActive(sub.path)) ?? false

  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >(() => {
    const initial: Record<string, boolean> = {}
    menuItems.forEach((item) => {
      if (item.hasSubMenu && item.subItems?.some((sub) => isActive(sub.path))) {
        initial[item.label] = true
      }
    })
    return initial
  })

  const toggleSection = (label: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [label]: !prev[label],
    }))
  }

  return (
    <aside
      className={`hidden w-[260px] shrink-0 rounded-xl border border-gray-200 bg-white md:block ${className}`}
      aria-label="마이페이지 내비게이션"
    >
      <nav>
        <ul className="flex flex-col divide-y divide-gray-200">
          {menuItems.map((item) => {
            const isExpanded = expandedSections[item.label] ?? false
            const hasSub = item.hasSubMenu

            return (
              <li key={item.id}>
                {/* 메인 메뉴 */}
                {hasSub ? (
                  <button
                    type="button"
                    className="group flex w-full items-center justify-between px-6 py-4 text-left transition-colors"
                    onClick={() => toggleSection(item.label)}
                    aria-expanded={isExpanded}
                    aria-controls={`submenu-${item.id}`}
                  >
                    <span
                      className={`group-hover:text-yellow-30 text-[18px] font-semibold transition-colors ${
                        hasActiveSubItem(item)
                          ? "text-yellow-30"
                          : "text-gray-800"
                      }`}
                    >
                      {item.label}
                    </span>
                    <span
                      className={`text-gray-400 transition-transform duration-200 ease-out ${
                        isExpanded ? "rotate-180" : ""
                      }`}
                    >
                      <ChevronDown size={20} />
                    </span>
                  </button>
                ) : (
                  item.path && (
                    <Link
                      href={item.path}
                      className="group block px-6 py-4 transition-colors"
                    >
                      <span
                        className={`text-[18px] font-semibold transition-colors ${
                          isActive(item.path)
                            ? "text-yellow-30"
                            : "text-gray-800"
                        } group-hover:text-yellow-30`}
                      >
                        {item.label}
                      </span>
                    </Link>
                  )
                )}

                {/* 서브 메뉴 */}
                {hasSub && isExpanded && (
                  <ul
                    id={`submenu-${item.id}`}
                    className="border-t border-gray-100 pt-1 pb-2"
                  >
                    {item.subItems?.map((subItem) => {
                      const active = isActive(subItem.path)
                      return (
                        <li key={subItem.id}>
                          <Link
                            href={subItem.path}
                            className={`relative block border-l-2 py-2.5 pr-6 pl-6 transition-colors duration-150 ${
                              active
                                ? "text-yellow-30 border-yellow-500"
                                : "hover:text-yellow-30 border-transparent"
                            }`}
                          >
                            <span
                              className={`text-[15px] leading-snug ${
                                active ? "font-medium" : "font-normal"
                              }`}
                            >
                              {subItem.label}
                            </span>
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      </nav>
    </aside>
  )
}
