import Link from "next/link"
import React from "react"

interface SectionHeaderProps {
  title: string
  description?: string
  showMoreLink?: string
  showMoreText?: string
}

export default function SectionHeader({
  title,
  description,
  showMoreLink,
  showMoreText = "더보기",
}: SectionHeaderProps) {
  return (
    <div className="mb-3 flex items-center justify-between lg:mb-8">
      <div>
        <h2 className="text-base font-bold text-gray-900 lg:text-3xl">
          {title}
        </h2>
        {description && (
          <p className="mt-2 text-sm text-gray-600 lg:text-base">
            {description}
          </p>
        )}
      </div>
      {showMoreLink && (
        <Link
          href={showMoreLink}
          className="text-sm font-medium text-gray-600 hover:text-gray-900"
        >
          {showMoreText}
        </Link>
      )}
    </div>
  )
}
