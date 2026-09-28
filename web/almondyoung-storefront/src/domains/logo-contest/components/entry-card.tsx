"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { PhotoSwipeFrame } from "@/components/shared/photo-swipe-frame"
import { logoContestVoteOff, logoContestVoteOn } from "../banner-assets"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import type { LogoContestEntry } from "@/lib/types/ui/logo-contest"
import { Trophy } from "lucide-react"
import { useTranslations } from "next-intl"
import Image from "next/image"
import { useRef, useState, type MouseEvent } from "react"
import { VoteButton } from "./vote-button"
import { useStickerSrc } from "./use-sticker-src"

interface EntryCardProps {
  entry: LogoContestEntry
  countryCode: string
  canVote: boolean
  isClosed: boolean
  isOwnEntry: boolean
  votedEntryId: string | null
  upcomingNotice?: string
  priority?: boolean
  enableSwipe?: boolean
}

export function EntryCard({
  entry,
  countryCode,
  canVote,
  isClosed,
  isOwnEntry,
  votedEntryId,
  upcomingNotice,
  priority = false,
  enableSwipe = true,
}: EntryCardProps) {
  const t = useTranslations("logoContest")
  const [previewIndex, setPreviewIndex] = useState(0)
  const [singleDragX, setSingleDragX] = useState(0)
  const [isDraggingSingle, setIsDraggingSingle] = useState(false)
  const touchStartX = useRef<number | null>(null)
  const suppressClick = useRef(false)
  const { stickerSrcById, prepareSticker } = useStickerSrc()

  return (
    <article className="border-border relative h-[124px] overflow-hidden rounded-2xl border bg-white lg:aspect-square lg:h-auto lg:rounded-xl">
      <LocalizedClientLink
        href={`/logo-contest/${entry.id}`}
        className="absolute inset-0 block"
        onClickCapture={(event: MouseEvent<HTMLAnchorElement>) => {
          if (suppressClick.current) event.preventDefault()
          suppressClick.current = false
        }}
      >
        <span
          className="absolute right-6 bottom-1 h-3 w-14 rounded-full bg-black/20 blur-lg lg:hidden"
          aria-hidden="true"
        />
        {entry.mediaFileIds.length > 0 && (
          <span className="logo-sticker-tilt absolute top-2 right-3 size-24 lg:inset-0 lg:size-auto">
            {entry.mediaFileIds.length === 1 ? (
              <span
                className={`relative block h-full w-full touch-pan-y ${isDraggingSingle ? "transition-none" : "transition-transform duration-300 ease-out"}`}
                style={{ transform: `translateX(${singleDragX}px)` }}
                onTouchStart={(event) => {
                  touchStartX.current = event.touches[0].clientX
                  setIsDraggingSingle(true)
                }}
                onTouchMove={(event) => {
                  if (touchStartX.current === null) return
                  const distance =
                    event.touches[0].clientX - touchStartX.current
                  setSingleDragX(Math.max(-24, Math.min(24, distance * 0.35)))
                  if (Math.abs(distance) > 12) suppressClick.current = true
                }}
                onTouchEnd={() => {
                  touchStartX.current = null
                  setIsDraggingSingle(false)
                  setSingleDragX(0)
                  window.setTimeout(() => {
                    suppressClick.current = false
                  }, 350)
                }}
                onTouchCancel={() => {
                  touchStartX.current = null
                  setIsDraggingSingle(false)
                  setSingleDragX(0)
                }}
              >
                <Image
                  src={
                    stickerSrcById[entry.mediaFileIds[0]] ??
                    getThumbnailUrl(entry.mediaFileIds[0])
                  }
                  alt={entry.title}
                  fill
                  sizes="(min-width: 1280px) 20vw, (min-width: 1024px) 25vw, 96px"
                  className="object-contain lg:p-3"
                  priority={priority}
                  unoptimized={!!stickerSrcById[entry.mediaFileIds[0]]}
                  onLoad={(event) =>
                    prepareSticker(event.currentTarget, entry.mediaFileIds[0])
                  }
                />
              </span>
            ) : (
              <PhotoSwipeFrame
                count={entry.mediaFileIds.length}
                enableSwipe={enableSwipe}
                onSelect={setPreviewIndex}
                hideDots
                itemClassName="h-24 lg:aspect-square lg:h-auto"
                renderImage={(index) => {
                  const fileId = entry.mediaFileIds[index]
                  return (
                    <Image
                      src={stickerSrcById[fileId] ?? getThumbnailUrl(fileId)}
                      alt={`${entry.title} ${index + 1}`}
                      fill
                      sizes="(min-width: 1280px) 20vw, (min-width: 1024px) 25vw, 96px"
                      className="object-contain lg:p-3"
                      priority={priority && index === 0}
                      unoptimized={!!stickerSrcById[fileId]}
                      onLoad={(event) =>
                        prepareSticker(event.currentTarget, fileId)
                      }
                    />
                  )
                }}
              />
            )}
          </span>
        )}
        {entry.isWinner && (
          <span className="bg-primary absolute top-2 right-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold text-white lg:right-auto lg:left-2">
            <Trophy className="h-3 w-3" aria-hidden="true" />
            {t("winner")}
          </span>
        )}
        {entry.mediaFileIds.length > 1 && (
          <span
            className="pointer-events-none absolute inset-x-0 bottom-11 z-20 hidden justify-center lg:flex"
            aria-label={`${previewIndex + 1}/${entry.mediaFileIds.length}`}
          >
            <span className="flex items-center gap-1 rounded-full bg-[#24343d]/55 px-1.5 py-1">
              {entry.mediaFileIds.map((fileId, index) => (
                <span
                  key={fileId}
                  className={`h-1 rounded-full bg-white transition-all ${index === previewIndex ? "w-4" : "w-1 opacity-60"}`}
                />
              ))}
            </span>
          </span>
        )}
        <div className="absolute inset-y-0 left-0 flex w-[calc(100%-112px)] flex-col px-4 pt-3 text-[#24343d] lg:inset-x-0 lg:top-auto lg:w-auto lg:justify-center lg:bg-gradient-to-t lg:from-black/55 lg:via-black/12 lg:to-transparent lg:pt-8 lg:pr-16 lg:pb-2 lg:pl-3 lg:text-white">
          <h3 className="line-clamp-2 text-sm font-semibold lg:truncate">
            {entry.title}
          </h3>
          <p className="mt-1 truncate text-xs opacity-70 lg:mt-0 lg:opacity-90">
            {entry.authorName}
          </p>
        </div>
      </LocalizedClientLink>
      <div className="absolute bottom-1 left-3 z-10 lg:right-2 lg:bottom-2 lg:left-auto">
        {isClosed ? (
          <span className="inline-flex h-10 items-center gap-0.5 px-1 text-xs font-bold text-[#24343d] lg:text-white">
            <Image
              src={
                votedEntryId === entry.id
                  ? logoContestVoteOn
                  : logoContestVoteOff
              }
              alt=""
              width={32}
              height={32}
              unoptimized
            />
            {entry.voteCount}
          </span>
        ) : (
          <VoteButton
            countryCode={countryCode}
            entryId={entry.id}
            isOwnEntry={isOwnEntry}
            votedEntryId={votedEntryId}
            voteCount={entry.voteCount}
            canVote={canVote}
            upcomingNotice={upcomingNotice}
            variant="tile"
          />
        )}
      </div>
    </article>
  )
}
