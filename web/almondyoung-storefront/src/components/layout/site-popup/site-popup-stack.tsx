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

  const body =
    current.contentType === "image" ? (
      <PopupImage popup={current} isDesktop={isDesktop} />
    ) : (
      <div
        className="rich-text-content text-muted-foreground px-6 py-5 text-[15px] leading-7"
        dangerouslySetInnerHTML={{
          __html: sanitizeNoticeHtml(current.content ?? ""),
        }}
      />
    )
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeAll()
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[90vh] flex-col gap-0 border-0 bg-transparent p-0 shadow-none sm:max-w-none"
        // 크기는 관리자가 px 로 정하는 값이라 클래스로 표현할 수 없다.
        // 화면보다 넓게 지정돼도 화면 안에 들어오도록 maxWidth 로 막는다.
        style={{
          width,
          maxWidth: "calc(100vw - 2rem)",
        }}
      >
        <div
          className="bg-background flex min-h-0 flex-col overflow-hidden rounded-lg border shadow-lg"
          style={{
            height,
            maxHeight: "calc(90vh - 7rem)",
          }}
        >
          <DialogHeader className="shrink-0 space-y-0 px-5 py-3 text-left">
            <DialogTitle className="text-foreground text-base leading-snug font-bold">
              {current.title}
            </DialogTitle>
          </DialogHeader>

          <div key={current.id} className="min-h-0 flex-1 overflow-y-auto">
            <PopupBodyLink popup={current} onNavigate={closeAll}>
              {body}
            </PopupBodyLink>
          </div>

          {current.noticeId && (
            <div className="border-border flex shrink-0 justify-end border-t px-5 py-3">
              <Button variant="outline" asChild>
                <LocalizedClientLink
                  href={`/cs?tab=notice&noticeId=${current.noticeId}`}
                  onClick={closeAll}
                >
                  {t("viewDetail")}
                </LocalizedClientLink>
              </Button>
            </div>
          )}
        </div>

        <div className="grid shrink-0 grid-cols-[9.5rem_minmax(0,1fr)] grid-rows-2 items-center gap-2 pt-4 sm:grid-cols-[9.5rem_minmax(0,1fr)_7rem] sm:grid-rows-1">
          <div className="bg-background col-start-1 row-start-1 flex h-11 w-[9.5rem] items-center rounded-full shadow-sm">
            <button
              type="button"
              aria-label={t("previous")}
              disabled={queue.length === 1}
              onClick={() =>
                setActiveIndex((index + queue.length - 1) % queue.length)
              }
              className="hover:bg-secondary focus-visible:ring-ring flex size-11 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="size-5" />
            </button>
            <span
              className="min-w-16 text-center text-sm font-medium"
              aria-live="polite"
            >
              {index + 1} / {queue.length}
            </span>
            <button
              type="button"
              aria-label={t("next")}
              disabled={queue.length === 1}
              onClick={() => setActiveIndex((index + 1) % queue.length)}
              className="hover:bg-secondary focus-visible:ring-ring flex size-11 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronRight className="size-5" />
            </button>
          </div>
          {current.dismissMode !== "none" && (
            <button
              type="button"
              onClick={handleDismiss}
              className="bg-background hover:bg-secondary focus-visible:ring-ring col-span-2 col-start-1 row-start-2 h-11 w-full rounded-full px-2 text-xs shadow-sm focus-visible:ring-2 focus-visible:outline-none sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:text-sm"
            >
              {current.dismissMode === "today"
                ? t("hideThisForToday")
                : t("hideThisForDays", { days: current.dismissDays ?? 1 })}
            </button>
          )}
          {current.dismissMode === "none" && (
            <span
              className="col-span-2 col-start-1 row-start-2 h-11 sm:col-span-1 sm:col-start-2 sm:row-start-1"
              aria-hidden="true"
            />
          )}
          <button
            type="button"
            onClick={closeAll}
            className="bg-background hover:bg-secondary focus-visible:ring-ring col-start-2 row-start-1 flex h-11 w-28 items-center justify-center gap-2 justify-self-end rounded-full px-2 text-sm font-medium shadow-sm focus-visible:ring-2 focus-visible:outline-none sm:col-start-3"
          >
            {queue.length > 1 ? t("closeAll") : t("close")}
            <X className="size-4" aria-hidden="true" />
          </button>
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
