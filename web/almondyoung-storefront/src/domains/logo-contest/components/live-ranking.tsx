"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { listLogoContestEntries } from "@/lib/api/ugc/logo-contest"
import type { LogoContestEntry } from "@/lib/types/ui/logo-contest"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { PopoverClose } from "@radix-ui/react-popover"
import { X } from "lucide-react"
import Image from "next/image"
import { useTranslations } from "next-intl"
import { useEffect, useState } from "react"
import { logoContestVoteOff, logoContestVoteOn } from "../banner-assets"
import { useStickerSrc } from "./use-sticker-src"

const RANK_FILTERS = [
  "",
  "grayscale brightness-110",
  "sepia saturate-150 hue-rotate-[-15deg] brightness-90",
]

const RANK_ROWS = [
  "-rotate-1",
  "rotate-[0.5deg]",
  "-rotate-[0.5deg]",
  "opacity-40 [mask-image:linear-gradient(to_bottom,black_40%,rgba(0,0,0,0.35))]",
]

const RANK_CARDS = [
  "border-[#ffc555] border-t-[#fff0b8] bg-gradient-to-r from-[#ffc53d] via-[#ffb52e] to-[#ff9d1c] text-white shadow-[inset_0_10px_14px_-8px_rgba(255,255,255,0.6),inset_0_-4px_10px_rgba(214,110,0,0.25),0_10px_28px_rgba(255,150,20,0.35)]",
  "border-[#dde2e8] bg-gradient-to-r from-[#fbfcfd] to-[#eef1f5] text-[#24343d] shadow-[inset_0_1px_0_#fff,0_4px_14px_rgba(80,95,110,0.12)]",
  "border-[#efd9c6] bg-gradient-to-r from-[#fffaf5] to-[#f8eadf] text-[#24343d] shadow-[inset_0_1px_0_#fff,0_4px_14px_rgba(150,90,40,0.12)]",
  "border-[#e3e7eb] bg-white text-[#607585]",
]

export function LiveRanking({
  initialEntries,
}: {
  initialEntries: LogoContestEntry[]
}) {
  const t = useTranslations("logoContest")
  const [entries, setEntries] = useState(initialEntries)
  const { stickerSrcById, prepareSticker } = useStickerSrc()

  useEffect(() => setEntries(initialEntries), [initialEntries])
  useEffect(() => {
    const refresh = () => {
      if (document.hidden) return
      void listLogoContestEntries({ sort: "popular", limit: 4 })
        .then((result) => setEntries(result.data))
        .catch(() => {})
    }
    const timer = window.setInterval(refresh, 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const ranked = entries.filter((entry) => entry.voteCount > 0)
  if (ranked.length === 0) return null

  return (
    <section
      className="mx-auto mb-10 max-w-xl lg:max-w-none"
      aria-label={t("ranking.title")}
    >
      <div className="mb-3 flex items-center gap-1.5">
        <h2 className="text-base font-bold text-[#24343d]">
          {t("ranking.title")}
        </h2>
        <Popover>
          <PopoverTrigger
            aria-label={t("ranking.helpLabel")}
            className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#aeb4c6] text-[11px] leading-none font-bold text-white data-[state=open]:bg-[#3971ff]"
          >
            ?
          </PopoverTrigger>
          <PopoverContent
            side="bottom"
            align="start"
            alignOffset={-14}
            sideOffset={10}
            className="relative w-80 max-w-[calc(100vw-32px)] rounded-lg p-4 pr-8 text-sm leading-5 text-[#24343d]"
          >
            <PopoverClose
              aria-label={t("ranking.close")}
              className="absolute top-2 right-2 cursor-pointer text-[#607585]"
            >
              <X className="size-4" />
            </PopoverClose>
            <ul className="space-y-2 break-keep">
              {(["votes", "tie", "refresh"] as const).map((key) => (
                <li
                  key={key}
                  className="relative pl-3 before:absolute before:top-2.5 before:left-0 before:h-px before:w-1 before:bg-[#607585]"
                >
                  {t(`ranking.help.${key}`)}
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      </div>
      <ol className="space-y-3.5 px-2 lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0 lg:px-0 xl:grid-cols-4">
        {ranked.map((entry, index) => (
          <li key={entry.id} className={`${RANK_ROWS[index]} lg:rotate-0`}>
            <LocalizedClientLink
              href={`/logo-contest/${entry.id}`}
              className={`relative flex h-16 items-center gap-3 rounded-2xl border px-4 transition-transform hover:scale-[1.02] ${RANK_CARDS[index]}`}
            >
              {index === 0 && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-0"
                >
                  <span className="absolute -top-8 left-1/2 h-14 w-64 -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(255,160,30,0.75),rgba(255,170,40,0.25)_55%,transparent)] blur-md" />
                  <span className="absolute inset-x-[4%] -top-px h-[1.5px] bg-gradient-to-r from-transparent via-white to-transparent" />
                  <span className="absolute -top-[3px] left-1/2 h-[5px] w-52 -translate-x-1/2 rounded-full bg-gradient-to-r from-transparent via-white to-transparent blur-[1.5px]" />
                  <span className="absolute -top-3 left-1/2 h-6 w-24 -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,#fff,#fff_25%,rgba(255,226,140,0.85)_50%,transparent)] blur-[2px]" />
                </span>
              )}
              <span className="flex w-11 shrink-0 items-center gap-1">
                <Image
                  src={index < 3 ? logoContestVoteOn : logoContestVoteOff}
                  alt=""
                  width={28}
                  height={28}
                  unoptimized
                  className={RANK_FILTERS[index]}
                />
                <span className="text-sm font-bold">{index + 1}</span>
              </span>
              {entry.mediaFileIds[0] &&
                (index === 0 ? (
                  <span className="relative size-10 shrink-0 overflow-hidden rounded-full bg-white ring-2 ring-[#fff3cf]">
                    <Image
                      src={getThumbnailUrl(entry.mediaFileIds[0])}
                      alt=""
                      fill
                      sizes="80px"
                      className="object-contain p-1"
                    />
                  </span>
                ) : (
                  <span className="relative size-10 shrink-0">
                    <Image
                      src={
                        stickerSrcById[entry.mediaFileIds[0]] ??
                        getThumbnailUrl(entry.mediaFileIds[0])
                      }
                      alt=""
                      fill
                      sizes="80px"
                      className="object-contain"
                      unoptimized={!!stickerSrcById[entry.mediaFileIds[0]]}
                      onLoad={(event) =>
                        prepareSticker(
                          event.currentTarget,
                          entry.mediaFileIds[0]
                        )
                      }
                    />
                  </span>
                ))}
              <span
                className={`min-w-0 flex-1 truncate text-sm font-semibold ${index === 0 ? "text-[#9a4700]" : ""}`}
              >
                {entry.title}
              </span>
              <span className="shrink-0 text-sm font-bold">
                {t("voteCount", { count: entry.voteCount })}
              </span>
            </LocalizedClientLink>
          </li>
        ))}
      </ol>
    </section>
  )
}
