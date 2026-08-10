"use client"

import { useEffect, useMemo, useState } from "react"
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
  isPopupDismissed,
  matchesPath,
  resolvePopupSize,
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
 * 여러 개가 동시에 해당돼도 모달을 겹쳐 띄우지 않고 순서대로 하나씩 보여준다 —
 * 모달이 쌓이면 닫기 버튼이 어느 팝업 것인지 알 수 없다.
 */
export function SitePopupStack({ popups, countryCode }: Props) {
  const t = useTranslations("notice.popup")
  const pathname = usePathname()
  const isDesktop = useIsDesktop()
  const path = stripCountryCode(pathname, countryCode)

  const candidates = useMemo(
    () => popups.filter((popup) => matchesPath(popup, path)),
    [popups, path]
  )

  // localStorage 는 서버에 없다. 첫 렌더는 아무것도 띄우지 않고, 마운트 후
  // 숨김 여부를 확인해 남은 것만 보여준다(하이드레이션 불일치 방지).
  const [queue, setQueue] = useState<SitePopup[]>([])

  useEffect(() => {
    setQueue(candidates.filter((popup) => !isPopupDismissed(popup)))
  }, [candidates])

  const current = queue[0]
  if (!current) return null

  const closeCurrent = () => setQueue((prev) => prev.slice(1))

  const handleDismiss = () => {
    dismissPopup(current)
    closeCurrent()
  }

  const { width, height } = resolvePopupSize(current, isDesktop)

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
      // 팝업이 바뀌면 내부 상태를 새로 시작한다.
      key={current.id}
      open
      onOpenChange={(open) => {
        if (!open) closeCurrent()
      }}
    >
      <DialogContent
        className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
        // 크기는 관리자가 px 로 정하는 값이라 클래스로 표현할 수 없다.
        // 화면보다 넓게 지정돼도 화면 안에 들어오도록 maxWidth 로 막는다.
        style={{
          width,
          maxWidth: "calc(100vw - 2rem)",
          height: height ?? undefined,
        }}
      >
        <DialogHeader className="shrink-0 space-y-0 px-6 pt-6 pb-3 text-left">
          <DialogTitle className="text-foreground text-[19px] leading-snug font-bold tracking-tight">
            {current.title}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <PopupBodyLink popup={current} onNavigate={closeCurrent}>
            {body}
          </PopupBodyLink>
        </div>

        <div className="border-border flex shrink-0 items-center justify-between gap-3 border-t px-6 py-4">
          {current.dismissMode === "none" ? (
            <span />
          ) : (
            <button
              type="button"
              onClick={handleDismiss}
              className="text-muted-foreground hover:text-foreground text-[13px] transition-colors"
            >
              {current.dismissMode === "today"
                ? t("hideForToday")
                : t("hideForDays", { days: current.dismissDays ?? 1 })}
            </button>
          )}

          <div className="flex items-center gap-2">
            {current.noticeId && (
              <Button variant="outline" asChild>
                <LocalizedClientLink
                  href={`/cs?tab=notice&noticeId=${current.noticeId}`}
                  onClick={closeCurrent}
                >
                  {t("viewDetail")}
                </LocalizedClientLink>
              </Button>
            )}
            <Button type="button" onClick={closeCurrent} className="px-6">
              {t("close")}
            </Button>
          </div>
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
