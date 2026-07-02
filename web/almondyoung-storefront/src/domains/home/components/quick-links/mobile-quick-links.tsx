"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { cn } from "@/lib/utils"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import Image from "next/image"
import { useMemo, useRef, useState } from "react"

export type MobileQuickLinkItem = {
  label: string
  displayLabel?: string
  href: string
  imageUrl: string | null
  external?: boolean
  imageClassName?: string
  imageWrapClassName?: string
}

const PAGE_SIZE = 10

export function MobileQuickLinks({ items }: { items: MobileQuickLinkItem[] }) {
  const [activePage, setActivePage] = useState(0)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const pages = useMemo(() => chunk(items, PAGE_SIZE), [items])

  if (pages.length === 0) return null

  return (
    <div className="md:hidden">
      <div
        ref={scrollerRef}
        onScroll={(event) => {
          const element = event.currentTarget
          const nextPage = Math.round(element.scrollLeft / element.clientWidth)
          setActivePage(Math.min(Math.max(nextPage, 0), pages.length - 1))
        }}
        className="scrollbar-hide flex snap-x snap-mandatory overflow-x-auto scroll-smooth"
      >
        {pages.map((page, pageIndex) => (
          <div
            key={pageIndex}
            className="grid min-w-full snap-start grid-cols-5 grid-rows-2 gap-y-3 px-0.5"
          >
            {page.map((item) => (
              <MobileQuickLink key={`${item.label}-${item.href}`} item={item} />
            ))}
          </div>
        ))}
      </div>

      {pages.length > 1 && (
        <div aria-hidden="true" className="mt-3 flex justify-center gap-1.5">
          {pages.map((_, index) => (
            <span
              key={index}
              className={cn(
                "h-1 rounded-full transition-all",
                activePage === index ? "bg-gray-90 w-5" : "bg-gray-20 w-5"
              )}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function MobileQuickLink({ item }: { item: MobileQuickLinkItem }) {
  const content = (
    <>
      <span
        className={cn(
          "relative aspect-square w-[54px] overflow-hidden rounded-lg border border-gray-100 bg-gray-100 shadow-sm",
          item.imageWrapClassName
        )}
      >
        {item.imageUrl ? (
          <Image
            src={getMobileImageUrl(item.imageUrl)}
            alt={item.label}
            fill
            sizes="54px"
            className={cn("object-cover", item.imageClassName)}
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center px-1 text-center text-[10px] leading-tight text-gray-300">
            {item.label}
          </span>
        )}
      </span>
      <span className="line-clamp-2 min-h-[2.4em] text-center text-[12px] leading-tight font-semibold text-gray-700">
        {(item.displayLabel ?? item.label).split("\n").map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
      </span>
    </>
  )

  if (item.external) {
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noreferrer"
        className="flex min-w-0 flex-col items-center gap-2 rounded-lg px-0.5 py-1"
      >
        {content}
      </a>
    )
  }

  return (
    <LocalizedClientLink
      href={item.href}
      className="flex min-w-0 flex-col items-center gap-2 rounded-lg px-0.5 py-1"
    >
      {content}
    </LocalizedClientLink>
  )
}

function getMobileImageUrl(imageUrl: string) {
  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
    return imageUrl
  }

  return getThumbnailUrl(imageUrl)
}

function chunk<T>(items: T[], size: number) {
  const pages: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    pages.push(items.slice(index, index + size))
  }
  return pages
}
