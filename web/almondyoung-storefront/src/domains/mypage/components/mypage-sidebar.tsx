"use client"

import React, { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronDown, ChevronUp } from "lucide-react"

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

  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >({})

  const toggleSection = (label: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [label]: !prev[label],
    }))
  }
  const normalizedPathname = pathname.replace(/^\/[a-z]{2}(\/|$)/, "/")

  const isActive = (path: string, exact = false) => {
    if (exact || path === "/mypage") {
      return normalizedPathname === path
    }
    return (
      normalizedPathname === path || normalizedPathname.startsWith(`${path}/`)
    )
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
                    className="hover:bg-muted flex w-full items-center justify-between px-6 py-4 text-left transition-colors"
                    onClick={() => toggleSection(item.label)}
                    aria-expanded={isExpanded}
                    aria-controls={`submenu-${item.id}`}
                  >
                    <span className="text-[18px] font-semibold text-gray-800">
                      {item.label}
                    </span>
                    <span className="text-gray-400">
                      {isExpanded ? (
                        <ChevronUp size={20} />
                      ) : (
                        <ChevronDown size={20} />
                      )}
                    </span>
                  </button>
                ) : (
                  item.path && (
                    <Link
                      href={item.path}
                      className={`block px-6 py-4 transition-colors ${
                        isActive(item.path) ? "bg-primary" : "hover:bg-muted"
                      }`}
                    >
                      <span
                        className={`text-[18px] font-semibold ${
                          isActive(item.path) ? "text-white" : "text-gray-800"
                        }`}
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
                    className="bg-muted border-t border-gray-200"
                  >
                    {item.subItems?.map((subItem) => (
                      <li key={subItem.id}>
                        <Link
                          href={subItem.path}
                          className={`block px-8 py-3 transition-colors ${
                            isActive(subItem.path)
                              ? "bg-yellow-50"
                              : "hover:bg-gray-100"
                          }`}
                        >
                          <span
                            className={`text-[16px] ${
                              isActive(subItem.path)
                                ? "font-medium text-yellow-600"
                                : "text-gray-700"
                            }`}
                          >
                            {subItem.label}
                          </span>
                        </Link>
                      </li>
                    ))}
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
