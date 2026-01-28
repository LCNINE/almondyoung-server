"use client"

import Link from "next/link"

type BreadcrumbItem = {
  label: string
  href?: string
}

type BreadcrumbProps = {
  items?: BreadcrumbItem[]
  className?: string
}

export const Breadcrumb = ({ items, className = "" }: BreadcrumbProps) => {
  const list = items && items.length > 0 ? items : [{ label: "홈", href: "/" }]

  return (
    <nav className={className} aria-label="breadcrumb">
      <ol className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm text-gray-600">
        {list.map((item, index) => {
          const isLast = index === list.length - 1
          return (
            <li
              key={`${item.label}-${index}`}
              className="flex items-center gap-2"
            >
              {item.href && !isLast ? (
                <Link href={item.href} className="hover:text-gray-900">
                  {item.label}
                </Link>
              ) : (
                <span className="text-gray-500">{item.label}</span>
              )}
              {!isLast && <span className="text-gray-300">/</span>}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
