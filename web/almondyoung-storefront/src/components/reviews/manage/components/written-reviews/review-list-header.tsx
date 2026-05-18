"use client"

import { CircleHelp, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"

interface ReviewListHeaderProps {
  count: number
  showTooltip?: boolean
  children?: React.ReactNode
}

export const ReviewListHeader = ({
  count,
  showTooltip = false,
  children,
}: ReviewListHeaderProps) => {
  const t = useTranslations("mypage.reviews")
  const [isOpen, setIsOpen] = useState(false)
  const tooltipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (
        tooltipRef.current &&
        !tooltipRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [isOpen])

  return (
    <header className="mb-4 flex items-center justify-between">
      <div className="relative flex items-center gap-1" ref={tooltipRef}>
        <h3 className="text-[15px] font-medium text-[#333333]">
          {t("countLabel", { count })}
        </h3>
        {showTooltip && (
          <button
            type="button"
            onClick={() => setIsOpen((prev) => !prev)}
            className="cursor-pointer"
            aria-label={t("tooltipAriaLabel")}
          >
            <CircleHelp className="h-4 w-4 text-[#999999]" />
          </button>
        )}

        {isOpen && showTooltip && (
          <div className="absolute top-full left-0 z-50 mt-2 w-fit rounded-lg border border-gray-200 bg-white p-3 whitespace-nowrap shadow-md">
            <div className="absolute -top-1.5 left-4 h-3 w-3 rotate-45 border-t border-l border-gray-200 bg-white" />
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs text-[#333333]">
                {t.rich("tooltipBody", {
                  strong: () => (
                    <span className="font-medium text-green-600">
                      {t("tooltipHighlight")}
                    </span>
                  ),
                })}
              </p>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="shrink-0 cursor-pointer"
                aria-label={t("tooltipClose")}
              >
                <X className="h-3.5 w-3.5 text-[#999999]" />
              </button>
            </div>
          </div>
        )}
      </div>

      {children}
    </header>
  )
}
