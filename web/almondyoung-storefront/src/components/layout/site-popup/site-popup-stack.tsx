"use client"

import { useEffect, useState } from "react"
import { ChevronLeft, ChevronRight, X } from "lucide-react"
import { usePathname } from "next/navigation"
import { useTranslations } from "next-intl"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { SitePopup } from "@/lib/types/ui/site-popup"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { sanitizeNoticeHtml } from "@/lib/utils/sanitize-html"
import {
  dismissPopup,
  isExternalLink,
  resolvePopupStackSize,
  selectVisiblePopups,
  stripCountryCode,
} from "./site-popup.helpers"

type Props = {
  popups: SitePopup[]
  countryCode: string
}

const DESKTOP_QUERY = "(min-width: 768px)"

/**
 * 노출 대상까지 걸러진 팝업 목록을 받아 실제로 띄운다.
 *
 * 여러 개가 해당돼도 모달 하나에서 넘겨 보고, 닫기는 전부 닫는다.
 */
export function SitePopupStack({ popups, countryCode }: Props) {
  const t = useTranslations("notice.popup")
  const pathname = usePathname()
  const isDesktop = useIsDesktop()
  const path = stripCountryCode(pathname, countryCode)

  // 이번 방문에서 닫은 팝업. 레이아웃이 페이지 이동에도 살아있으므로 여기 모아두지
  // 않으면 경로가 바뀔 때마다 방금 닫은 팝업이 다시 뜬다.
  const [closedIds, setClosedIds] = useState<ReadonlySet<string>>(
    () => new Set<string>()
  )

  // localStorage 는 서버에 없다. 첫 렌더는 아무것도 띄우지 않고, 마운트 후
  // 숨김 여부를 확인해 남은 것만 보여준다(하이드레이션 불일치 방지).
  const [queue, setQueue] = useState<SitePopup[]>([])
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    setQueue(selectVisiblePopups(popups, path, closedIds))
  }, [popups, path, closedIds])

  const index = Math.min(activeIndex, queue.length - 1)
  const current = queue[index]
  if (!current) return null

  const closeCurrent = () =>
    setClosedIds((prev) => new Set(prev).add(current.id))
  const closeAll = () =>
    setClosedIds((prev) => {
      const closed = new Set(prev)
      queue.forEach((popup) => closed.add(popup.id))
      return closed
    })

  const handleDismiss = () => {
    dismissPopup(current)
    closeCurrent()
  }

  const { width, height } = resolvePopupStackSize(popups, path, isDesktop)

  const isText = current.contentType !== "image"
  const body = isText ? (
    <div
      className="rich-text-content text-foreground px-5 pb-5 text-[15px] leading-7 break-keep"
      dangerouslySetInnerHTML={{
        __html: sanitizeNoticeHtml(current.content ?? ""),
      }}
    />
  ) : (
    <PopupImage popup={current} isDesktop={isDesktop} />
  )
  const closeLabel = queue.length > 1 ? t("closeAll") : t("close")

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeAll()
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[90vh] flex-col gap-0 overflow-hidden rounded-2xl border-0 p-0 shadow-xl sm:max-w-none"
        // 크기는 관리자가 px 로 정하는 값이라 클래스로 표현할 수 없다.
        // 화면보다 넓게 지정돼도 화면 안에 들어오도록 maxWidth 로 막는다.
        style={{ width, maxWidth: "calc(100vw - 2rem)" }}
      >
        <DialogHeader className="shrink-0 flex-row items-start gap-2 space-y-0 px-5 pt-5 pb-3 text-left">
          <DialogTitle className="text-foreground flex-1 text-lg leading-snug font-bold break-keep">
            {current.title}
          </DialogTitle>
          {queue.length > 1 && (
            <div className="text-muted-foreground flex shrink-0 items-center">
              <button
                type="button"
                aria-label={t("previous")}
                onClick={() =>
                  setActiveIndex((index + queue.length - 1) % queue.length)
                }
                className="hover:bg-secondary focus-visible:ring-ring flex size-8 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-none"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="text-xs tabular-nums" aria-live="polite">
                {index + 1} / {queue.length}
              </span>
              <button
                type="button"
                aria-label={t("next")}
                onClick={() => setActiveIndex((index + 1) % queue.length)}
                className="hover:bg-secondary focus-visible:ring-ring flex size-8 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-none"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          )}
          <button
            type="button"
            aria-label={closeLabel}
            onClick={closeAll}
            className="text-muted-foreground hover:bg-secondary focus-visible:ring-ring -mt-1 -mr-2 flex size-8 shrink-0 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-none"
          >
            <X className="size-5" />
          </button>
        </DialogHeader>

        <div
          key={current.id}
          className="min-h-0 flex-1 overflow-y-auto"
          // 이미지는 관리자가 정한 높이를 지키고, 글은 내용만큼만 차지한다.
          style={isText ? { maxHeight: height } : { height }}
        >
          <PopupBodyLink popup={current} onNavigate={closeAll}>
            {body}
          </PopupBodyLink>
        </div>

        <div className="flex shrink-0 flex-col gap-3 px-5 pt-3 pb-4">
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="h-12 flex-1 rounded-xl text-base"
              onClick={closeAll}
            >
              {closeLabel}
            </Button>
            {current.noticeId && (
              <Button className="h-12 flex-1 rounded-xl text-base" asChild>
                <LocalizedClientLink
                  href={`/cs?tab=notice&noticeId=${current.noticeId}`}
                  onClick={closeAll}
                >
                  {t("viewDetail")}
                </LocalizedClientLink>
              </Button>
            )}
          </div>
          {current.dismissMode !== "none" && (
            <button
              type="button"
              onClick={handleDismiss}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring self-center rounded px-1 text-sm underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
            >
              {current.dismissMode === "today"
                ? t("hideThisForToday")
                : t("hideThisForDays", { days: current.dismissDays ?? 1 })}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** 링크가 걸린 팝업이면 본문 전체를 클릭 영역으로 감싼다. */
function PopupBodyLink({
  popup,
  onNavigate,
  children,
}: {
  popup: SitePopup
  onNavigate: () => void
  children: React.ReactNode
}) {
  if (!popup.linkUrl) return <>{children}</>

  if (isExternalLink(popup.linkUrl)) {
    return (
      <a
        href={popup.linkUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block"
        aria-label={popup.title}
        onClick={onNavigate}
      >
        {children}
      </a>
    )
  }

  return (
    <LocalizedClientLink
      href={popup.linkUrl}
      className="block"
      aria-label={popup.title}
      onClick={onNavigate}
    >
      {children}
    </LocalizedClientLink>
  )
}

function PopupImage({
  popup,
  isDesktop,
}: {
  popup: SitePopup
  isDesktop: boolean
}) {
  // 모바일 이미지를 따로 올리지 않았으면 PC 이미지를 함께 쓴다.
  const fileId = isDesktop
    ? (popup.pcImageFileId ?? popup.mobileImageFileId)
    : (popup.mobileImageFileId ?? popup.pcImageFileId)

  if (!fileId) return null

  return (
    // file-service 공개 URL 을 그대로 쓰므로 next/image 대신 img 사용
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={getThumbnailUrl(fileId)}
      alt={popup.imageAlt ?? popup.title}
      className="block w-full"
    />
  )
}

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(true)

  useEffect(() => {
    const media = window.matchMedia(DESKTOP_QUERY)
    const sync = () => setIsDesktop(media.matches)
    sync()
    media.addEventListener("change", sync)
    return () => media.removeEventListener("change", sync)
  }, [])

  return isDesktop
}
