"use client"

import { ChevronRight } from "lucide-react"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import type { TopNotice } from "@/lib/types/ui/top-notice"
import { cn } from "@/lib/utils"
import { useEffect, useState } from "react"
import {
  isExternalNoticeLink,
  nextNoticeIndex,
  noticeItemState,
  TOP_NOTICE_INTERVAL_MS,
  TOP_NOTICE_TRANSITION_MS,
  type TopNoticeItemState,
} from "./top-notice-bar.helpers"

// 대기 자리에는 전환을 걸지 않아 위에서 아래로 되돌아가는 모습이 보이지 않게 한다
const STATE_CLASS_NAME: Record<TopNoticeItemState, string> = {
  current:
    "translate-y-0 opacity-100 transition-[transform,opacity] duration-[1200ms] ease-[cubic-bezier(.4,0,.2,1)]",
  leave:
    "-translate-y-full opacity-0 transition-[transform,opacity] duration-[1200ms] ease-[cubic-bezier(.4,0,.2,1)]",
  enter: "translate-y-full opacity-0",
}

const LINK_CLASS_NAME =
  "text-mint flex flex-none items-center font-semibold hover:underline"

type Props = {
  notices: TopNotice[]
  moreLabel: string
}

export function TopNoticeRotator({ notices, moreLabel }: Props) {
  const [{ current, leaving }, setRotation] = useState<{
    current: number
    leaving: number | null
  }>({ current: 0, leaving: null })
  const count = notices.length

  useEffect(() => {
    if (count <= 1) {
      return
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return
    }

    const timer = window.setInterval(() => {
      setRotation((prev) => ({
        current: nextNoticeIndex(prev.current, count),
        leaving: prev.current,
      }))
    }, TOP_NOTICE_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [count])

  useEffect(() => {
    if (leaving === null) {
      return
    }

    const timer = window.setTimeout(
      () => setRotation((prev) => ({ ...prev, leaving: null })),
      TOP_NOTICE_TRANSITION_MS
    )

    return () => window.clearTimeout(timer)
  }, [leaving])

  return (
    <div className="relative mx-auto h-[34px] max-w-[1280px] overflow-hidden md:h-[38px]">
      {notices.map((notice, index) => {
        const state = noticeItemState(index, current, leaving)

        return (
          <div
            key={notice.id}
            aria-hidden={state !== "current"}
            className={cn(
              "absolute inset-0 flex items-center justify-center gap-1 px-4 whitespace-nowrap md:gap-3 md:px-10",
              STATE_CLASS_NAME[state]
            )}
          >
            <span className="min-w-0 overflow-hidden text-ellipsis">
              {notice.text}
            </span>

            {notice.linkUrl && (
              <NoticeLink
                href={notice.linkUrl}
                label={moreLabel}
                focusable={state === "current"}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function NoticeLink({
  href,
  label,
  focusable,
}: {
  href: string
  label: string
  focusable: boolean
}) {
  const tabIndex = focusable ? undefined : -1

  if (isExternalNoticeLink(href)) {
    return (
      <a
        href={href.trim()}
        className={LINK_CLASS_NAME}
        tabIndex={tabIndex}
        aria-label={label}
      >
        <LinkContent label={label} />
      </a>
    )
  }

  const path = href.startsWith("/") ? href : `/${href}`

  return (
    <LocalizedClientLink
      href={path}
      className={LINK_CLASS_NAME}
      tabIndex={tabIndex}
      aria-label={label}
    >
      <LinkContent label={label} />
    </LocalizedClientLink>
  )
}

// 모바일은 폭이 좁아 글자 대신 화살표만 둔다. 공지 문구가 잘리지 않게 하려는 것
function LinkContent({ label }: { label: string }) {
  return (
    <>
      <span className="hidden md:inline">{label}</span>
      <ChevronRight
        className="size-4 md:hidden"
        strokeWidth={2.4}
        aria-hidden
      />
    </>
  )
}
